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

// This type's own cap. The longest rung this composer can produce is the word sentence over the
// longest word a phrase corpus yields, which is far inside 80. Asserted in the test rather than
// enforced here: a composer that cannot reach anything unbounded has nothing to reject.
export const MAX_CRYPTOGRAM_RUNG_LENGTH = 80

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
 * The next rung, or null when the ladder is spent or has nothing left worth saying.
 *
 * WHICH RULE RUNS IS POSITIONAL: rung 0 is the low-frequency letter, rung 1 the high-frequency one,
 * rung 2 the word. That escalates in what a rung YIELDS rather than in how much it looks like it
 * says: a rare letter opens few squares, a common letter opens many, and a word opens a word. The
 * giveaway is last.
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
  if (spent.length >= RUNG_COUNT) return null

  const truth = trueMapping(data)
  const revealed = revealedCiphers(data, spent)

  if (spent.length < 2) {
    const letters = lettersOf(data.ciphertext)
    const counts: Record<string, number> = {}
    for (const letter of letters) {
      counts[letter] = (counts[letter] ?? 0) + 1
    }

    // Ascending by count, ties broken alphabetically so the order is total and two runs agree.
    const candidates = Object.keys(truth)
      .filter((cipher) => !revealed.has(cipher) && !isCorrect(state, truth, cipher))
      .sort((left, right) => counts[left] - counts[right] || (left < right ? -1 : 1))

    if (candidates.length === 0) return null

    // A PERCENTILE OF THE SURVIVING POOL, recomputed each time, rather than a fixed index. The pool
    // shrinks as the player maps letters correctly and as rungs reveal them, so an index into it has
    // to be a proportion or it drifts toward the rare end on a board that is nearly solved.
    const percentile = spent.length === 0 ? LOW_PERCENTILE : HIGH_PERCENTILE
    return { cipher: candidates[Math.floor((candidates.length - 1) * percentile)], kind: 'letter' }
  }

  // The word holding the most squares the player has not yet got right. Ties break to the earliest
  // word, so the choice is deterministic without naming the position in the sentence.
  const words = wordsOf(data.ciphertext)
  let best = -1
  let bestUnsolved = 0
  words.forEach((word, index) => {
    const unsolved = [...word].filter((cipher) => !isCorrect(state, truth, cipher)).length
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
