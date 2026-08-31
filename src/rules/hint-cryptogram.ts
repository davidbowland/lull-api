// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. The tests travel with the rule so the copy is proved to BEHAVE
// rather than merely to match a diff.
//
// It lives here rather than shipping as data on the puzzle because it runs over the board a player
// has built at play time, which no generator can enumerate in advance. lull-api ships no cryptogram
// hints at all; it executes this file only in __tests__/unit/rules/hint-sweep.test.ts, which is what
// keeps a broken rule from reaching lull-ui unnoticed.
//
// TWO FUNCTIONS, AND THE SPLIT IS THE WHOLE DESIGN. `chooseCryptogramRung` reads live player state
// and picks; `cryptogramHintFor` is pure in the puzzle and renders a frozen choice. If one function
// did both, a ladder recomputed on every render would let a player open rung 1, learn something, and
// watch rung 1 silently upgrade itself into a better hint -- an unbounded supply of rungs for one
// press. Freezing the choice at the moment of purchase is what makes the ladder cost what it says.

export type CryptogramSpentRung = { cipher: string; kind: 'letter' } | { index: number; kind: 'word' }

export interface CryptogramHintData {
  answer: string
  ciphertext: string
}

/** The board as the player has built it: cipher letter to the plain letter they have assigned. */
export interface CryptogramPlayerState {
  mapping: Record<string, string>
}

const RUNG_COUNT = 3
const LOW_PERCENTILE = 0.25
const HIGH_PERCENTILE = 0.75

// This type's own cap, and it is 99 rather than the 80 every other hint on this wire takes, because
// 80 was a claim about a bound that does not exist. CRYPTOGRAM HAS NO PER-WORD LENGTH GATE:
// services/phrases.ts bounds the whole text at MAX_TEXT_LENGTH 80 with MIN_WORDS 2 and
// ALLOWED_CHARACTERS of letters and spaces, and cryptogram/difficulty.ts adds only letter counts --
// 12 or more letters, 6 to 20 distinct. So the longest legal word is 80 less a space and a
// one-letter second word: 78 letters, and 'ABCDEF' repeated thirteen times clears every one of
// those gates. The frame "One of the words is " plus the period is 21 characters, so the longest
// sentence this composer can produce is 99, and a cap of 80 was one a legal puzzle could breach.
//
// NOT CLAMPED, deliberately. Truncating a word sentence produces a hint that names a word the
// puzzle does not contain, which is worse than a long one. Asserted in the test at the exact
// ceiling instead.
export const MAX_CRYPTOGRAM_RUNG_LENGTH = 99

// Letter NAMES that open on a vowel sound -- ay, ee, ef, aitch, eye, el, em, en, oh, ar, es, ex.
// A closed set of twelve rather than a vowel test, because F, H, L, M, N, R, S and X are consonants
// whose names begin with a vowel. "Every G is a E." is the bug this prevents.
const TAKES_AN = 'AEFHILMNORSX'

const lettersOf = (text: string): string[] => text.toUpperCase().match(/[A-Z]/g) ?? []

/** The words of a phrase, uppercased, letters only. Index i here is index i of the answer's words. */
const wordsOf = (text: string): string[] =>
  text
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word.length > 0)

/**
 * Cipher letter to the plain letter it really stands for.
 *
 * Derived by walking the two letter streams in step, which is sound because `encipher` in
 * generators/cryptogram is a positional `replace` over /[A-Z]/ -- it substitutes one letter for one
 * letter and passes everything else through, so the nth letter of the ciphertext is the nth letter
 * of the answer enciphered. A mapping shipped on the wire would be a second copy of a fact the two
 * strings already carry, and the two could disagree.
 */
export const trueMapping = (data: CryptogramHintData): Record<string, string> => {
  const cipher = lettersOf(data.ciphertext)
  const plain = lettersOf(data.answer)
  const truth: Record<string, string> = {}
  const shared = Math.min(cipher.length, plain.length)
  for (let index = 0; index < shared; index += 1) {
    truth[cipher[index]] = plain[index]
  }
  return truth
}

/**
 * Every cipher letter the spent rungs have already handed over.
 *
 * DERIVED FROM `spent`, never stored beside it. The locked set and the rung count are then two
 * readings of one record and cannot disagree -- the mistake goFigure's BoardState comment warns
 * about, avoided here by not having a second field at all.
 */
export const revealedCiphers = (data: CryptogramHintData, spent: CryptogramSpentRung[]): Set<string> => {
  const words = wordsOf(data.ciphertext)
  const revealed = new Set<string>()
  for (const rung of spent) {
    if (rung.kind === 'letter') {
      revealed.add(rung.cipher)
      continue
    }
    for (const letter of words[rung.index] ?? '') {
      revealed.add(letter)
    }
  }
  return revealed
}

const isCorrect = (state: CryptogramPlayerState, truth: Record<string, string>, cipher: string): boolean =>
  state.mapping[cipher] === truth[cipher]

/**
 * The next rung, or null when the ladder is spent or nothing left has anything to say.
 *
 * THE LADDER TAKES THE FIRST RUNG THAT STILL HAS SOMETHING TO SAY, not the rung at position
 * `spent.length`. Each rung draws from its own pool and a positional ladder died at the first empty
 * one, taking every later rung with it -- the same defect the Phrazle builder carried. It is
 * reachable here at rung 2: a player holding every cipher but one, handed that one by rung 1, has no
 * letter candidate left while the word rung still has squares to open.
 *
 * The order is unchanged, so a fresh board produces the ladder it always did: the low-frequency
 * letter, the high-frequency letter, the word. That escalates in what a rung YIELDS rather than in
 * how much it looks like it says -- a rare letter opens few squares, a common letter opens many, and
 * a word locks every distinct letter in it. The giveaway is last.
 *
 * THE WORD RUNG ENDS THE LADDER, and that refusal has to come FIRST rather than after the letter
 * block. Skipping a barren pool is what lets the word rung be reached early -- a player holding every
 * cipher but one, handed that one by rung 1, buys the word at rung 2 -- and the letter pool can then
 * REFILL, because un-mapping a letter they had right puts it back. Under the old order that board
 * sold a letter rung after the word rung: a hint worth one square, offered after the one worth a
 * word, which is the escalation running backwards. There is nothing left to sell once the giveaway
 * is out, and the ladder is two rungs.
 *
 * FREQUENCY IS COUNTED IN THIS PUZZLE'S OWN CIPHERTEXT, not from the shared strength table. A letter
 * appearing six times here is worth more to this player than one that is common in English and
 * appears once, and the ciphertext is on their screen to be counted.
 */
export const chooseCryptogramRung = (
  data: CryptogramHintData,
  state: CryptogramPlayerState,
  spent: CryptogramSpentRung[],
): CryptogramSpentRung | null => {
  // Reachable: stored progress is untrusted, so a malformed record naming one kind repeatedly would
  // otherwise buy a fourth rung below.
  if (spent.length >= RUNG_COUNT) return null
  // The giveaway is out, so the ladder is over -- see the docblock above for why this cannot sit
  // below the letter block, where it used to.
  if (spent.some((rung) => rung.kind === 'word')) return null

  const truth = trueMapping(data)
  const revealed = revealedCiphers(data, spent)

  const letters = lettersOf(data.ciphertext)
  const counts: Record<string, number> = {}
  for (const letter of letters) {
    counts[letter] = (counts[letter] ?? 0) + 1
  }

  const letterRungs = spent.filter((rung) => rung.kind === 'letter')

  if (letterRungs.length < 2) {
    // Ascending by count, ties broken alphabetically so the order is total and two runs agree.
    const candidates = Object.keys(truth)
      .filter((cipher) => !revealed.has(cipher) && !isCorrect(state, truth, cipher))
      .sort((left, right) => counts[left] - counts[right] || (left < right ? -1 : 1))

    if (candidates.length > 0) {
      // A PERCENTILE OF THE SURVIVING POOL, recomputed each time, rather than a fixed index. The
      // pool shrinks as the player maps letters correctly and as rungs reveal them, so an index into
      // it has to be a proportion or it drifts toward the rare end on a board that is nearly solved.
      const percentile = letterRungs.length === 0 ? LOW_PERCENTILE : HIGH_PERCENTILE
      const start = Math.floor((candidates.length - 1) * percentile)

      // THE WALK-UP, and without it rung 2 does not escalate on a real phrase. A percentile over a
      // count-SORTED LIST is not a percentile over frequency, and the corpus is skewed hard enough
      // for the difference to swallow the whole ladder: on a 12-30 letter phrase the letters
      // appearing ONCE are a majority of the distinct set, so the 25th and the 75th index both land
      // inside that one low-count block. Measured over 20 corpus-shaped phrases, rung 1 landed on a
      // 1-occurrence letter 20 times out of 20, rung 2 landed on the most frequent letter 0 times,
      // and 5 of the 20 gave the two rungs IDENTICAL yield -- a hint the player paid for twice.
      //
      // So the percentile stays -- it is what keeps rung 2 off the extreme, which is what was asked
      // for -- and the escalation is made real on top of it: from the percentile candidate, walk UP
      // to the first letter that appears strictly more often than the one rung 1 revealed. When no
      // such letter exists anywhere the pool is flat, and the highest count available is the most
      // this rung can honestly offer.
      const floor = letterRungs.reduce((most, rung) => Math.max(most, counts[rung.cipher] ?? 0), 0)
      const walked = candidates.findIndex((cipher, index) => index >= start && counts[cipher] > floor)
      return { cipher: candidates[walked === -1 ? candidates.length - 1 : walked], kind: 'letter' }
    }
  }

  // The word locking the most DISTINCT cipher letters the player has not yet got right -- not the
  // most cells. Opening a word locks every distinct cipher letter in it and a locked letter pays out
  // across the whole board, so a six-cell word of one letter is worth less than a five-cell word of
  // five. Ties break to the earliest word, so the choice is deterministic without naming the
  // position in the sentence.
  const words = wordsOf(data.ciphertext)
  let best = -1
  let bestUnsolved = 0
  words.forEach((word, index) => {
    const unsolved = new Set([...word].filter((cipher) => !isCorrect(state, truth, cipher))).size
    if (unsolved > bestUnsolved) {
      best = index
      bestUnsolved = unsolved
    }
  })

  return best === -1 ? null : { index: best, kind: 'word' }
}

/**
 * The sentence for a frozen rung. Pure in `data`, so a spent rung reads the same forever.
 *
 * "Every Q is an E" is the direction the player thinks in -- mapping.ts in lull-ui opens by naming
 * it, "this square is an I" -- rather than the generator's direction, which is the cipher.
 *
 * THE WORD RUNG DOES NOT NAME THE WORD'S POSITION. The board fills the squares in, so the position
 * is visible the moment the rung is opened; saying it as well would spend characters on something
 * already on screen.
 */
export const cryptogramHintFor = (data: CryptogramHintData, rung: CryptogramSpentRung): { text: string } => {
  if (rung.kind === 'letter') {
    const plain = trueMapping(data)[rung.cipher] ?? '?'
    return { text: `Every ${rung.cipher} is ${TAKES_AN.includes(plain) ? 'an' : 'a'} ${plain}.` }
  }
  return { text: `One of the words is ${wordsOf(data.answer)[rung.index] ?? '?'}.` }
}
