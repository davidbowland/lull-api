import {
  chooseCryptogramRung,
  CryptogramSpentRung,
  cryptogramHintFor,
  MAX_CRYPTOGRAM_RUNG_LENGTH,
  seededRandom as cryptogramSeededRandom,
  trueMapping,
} from '@rules/hint-cryptogram'
import {
  choosePhrazleRung,
  MAX_PHRAZLE_RUNG_LENGTH,
  phrazleHintFor,
  PhrazleSpentRung,
  seededRandom,
} from '@rules/hint-phrazle'
import {
  chooseThemedAnagramsRung,
  MAX_ANAGRAM_RUNG_LENGTH,
  themedAnagramsHintFor,
  ThemedAnagramsSpentRung,
} from '@rules/hint-themed-anagrams'
import { readFileSync } from 'fs'
import { join } from 'path'

import { MAX_WORD_LETTERS } from '@generators/phrazle/difficulty'
import { MAX_WORD_LENGTH, MIN_WORD_LENGTH } from '@generators/themedanagrams/words'

// THE SWEEP IS WHY THESE RULES MAY LIVE IN src/rules AT ALL. lull-api ships none of these hints, so
// nothing else here executes these files; the directory's condition is that this repo runs them.
// It is a TEST rather than a gate in the generators: a hint that does not ship must never be able to
// cost a player a puzzle, and a redraw triggered by an unhappy hint would do exactly that.
//
// IT RUNS PARTLY-ESTABLISHED PLAYER STATES, NOT JUST EMPTY ONES, and that is the difference between
// a sweep and a formality. Against an empty state these builders provably cannot return null --
// every cipher letter is unmapped, every entry unsolved, and a phrase of at most thirty letters
// leaves most of the alphabet absent -- so a sweep that only ever passes `{}` asserts three rungs in
// the one state where three are guaranteed. Both of the bugs this file now covers, a barren pool
// killing every later rung and three rungs stacking onto one entry, were invisible to it.
//
// THE FIXTURES SIT AT THE REAL STRUCTURAL CORNERS, read off the committed gates rather than
// invented. Cryptogram: MAX_TEXT_LENGTH 80, MIN_WORDS 2 and MAX_WORDS 6 in services/phrases.ts, plus
// MIN_LETTERS 12 and 6-20 distinct in generators/cryptogram/difficulty.ts. Phrazle: 2-6 words of
// 2-11 letters totalling at most 30, in generators/phrazle/difficulty.ts. Themed Anagrams: 5-9
// letters in generators/themedanagrams/words.ts.
//
// EVERY ONE OF THOSE NUMBERS WAS READ OFF THE COMMITTED GATE, because two successive drafts of this
// file guessed instead. The first swept `ARROW` as a one-word cryptogram and `EXTRAORDINARY THING` as
// a long Phrazle, neither of which any generator can produce. The second replaced them with corners
// derived from a Phrazle floor of "2-3 words of 3-7 letters totalling 18" that no version of this
// repo has ever held -- so the ceiling rows sat four letters below the real one, and the rung cap
// they were meant to defend was derived from the same invented number.
//
// TWO OF THOSE GATES ARE IMPORTED AND THE REST ARE READ BY HAND, and the difference is not a detail:
// an imported constant moves this file when the gate moves, and a transcribed one does not. What is
// EXPORTED is Phrazle's MAX_WORD_LETTERS and Themed Anagrams' MIN_WORD_LENGTH and MAX_WORD_LENGTH,
// and those three are imported above and asserted against the fixtures below. Cryptogram's
// MAX_TEXT_LENGTH, MIN_WORDS and MAX_WORDS in services/phrases.ts, its MIN_LETTERS, MIN_UNIQUE and
// MAX_UNIQUE in generators/cryptogram/difficulty.ts, and Phrazle's MIN_WORDS, MIN_WORD_LETTERS and
// MAX_TOTAL_LETTERS are module-private, so the numbers in the comments beside those rows are
// TRANSCRIPTIONS. They were read off the gate; nothing here notices if the gate changes and the
// comment does not. Exporting one to pin it is a change to a generator for a test's benefit, and the
// honest thing is to say which numbers carry which guarantee rather than to imply all of them carry
// the stronger one.

// worst-case.ts fills every bounded field to its bound INDEPENDENTLY, so its answers are shapes the
// byte budget has to carry rather than puzzles a generator can emit: cryptogram's is a single
// 80-letter word, which MIN_WORDS forbids, and phrazle's is a single 80-letter word, which the
// structural floor forbids twice over. Those rows are swept for everything BUT the cap, which is
// derived over reachable puzzles.
const NO_CAP = Number.POSITIVE_INFINITY

// THE LADDER'S CEILING, AND THE FOLDS BELOW DELIBERATELY GO ONE PAST IT. `ladderFaults` checks a
// ladder of one to three rungs, and the upper half of that check was unreachable: every fold stopped
// at three itself, so a builder that offered a fourth rung was truncated by the test harness and the
// bound reported nothing. A cap enforced by the thing measuring it measures itself. So the folds run
// to MAX_LADDER + 1 and let the fault list say what happened -- which is the only arrangement in
// which `texts.length <= 3` is an assertion about the builders rather than about this file.
const MAX_LADDER = 3

/**
 * Every way a ladder can be wrong, as sentences: one to three rungs, each non-empty, each inside the
 * cap, and no two the same.
 *
 * A FAULT LIST RATHER THAN A BLOCK OF ASSERTIONS, so every row of every table below reads
 * `expect(...).toStrictEqual([])` and a failure names what broke rather than which line it broke on.
 */
const ladderFaults = (texts: string[], cap: number): string[] => [
  ...(texts.length >= 1 && texts.length <= MAX_LADDER ? [] : [`ladder of ${texts.length} rungs`]),
  ...texts.filter((text) => text.length === 0).map(() => 'empty rung'),
  ...texts.filter((text) => text.length > cap).map((text) => `${text.length} characters: ${text}`),
  // THE SAME SENTENCE TWICE is the shape this repo names as the worst failure a ladder can have, and
  // it is invisible to a length assertion.
  ...(new Set(texts).size === texts.length ? [] : [`repeated sentence in ${JSON.stringify(texts)}`]),
]

// A fixed substitution, so a fixture's ciphertext cannot drift from its answer by a typo. rot13 is a
// derangement over A-Z, which is the only property trueMapping relies on.
const rot13 = (text: string): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => String.fromCharCode(((letter.charCodeAt(0) - 65 + 13) % 26) + 65))

const cryptogramOf = (answer: string): { answer: string; ciphertext: string } => ({ answer, ciphertext: rot13(answer) })

/** The first `count` cipher letters mapped correctly -- a board the player has partly filled in. */
const partlyMapped = (data: { answer: string; ciphertext: string }, count: number): Record<string, string> =>
  Object.fromEntries(Object.entries(trueMapping(data)).slice(0, count))

// SEEDED FROM THE ANSWER RATHER THAN FROM A PUZZLE ID, because these fixtures are phrases and not
// puzzles. What the seed has to be here is FIXED -- the sweep asserts a ladder has no repeated
// sentence, and an unseeded draw would make that a different question on every run.
const foldCryptogram = (
  data: { answer: string; ciphertext: string },
  mapping: Record<string, string> = {},
): string[] => {
  const random = cryptogramSeededRandom(data.answer)
  const spent: CryptogramSpentRung[] = []
  let next = chooseCryptogramRung(data, { mapping }, spent, random)
  while (next !== null && spent.length <= MAX_LADDER) {
    spent.push(next)
    next = chooseCryptogramRung(data, { mapping }, spent, random)
  }
  return spent.map((rung) => cryptogramHintFor(data, rung).text)
}

const foldPhrazle = (answer: string, guesses: string[] = []): string[] => {
  const random = seededRandom(answer)
  const spent: PhrazleSpentRung[] = []
  let next = choosePhrazleRung({ answer }, { guesses }, spent, random)
  while (next !== null && spent.length <= MAX_LADDER) {
    spent.push(next)
    next = choosePhrazleRung({ answer }, { guesses }, spent, random)
  }
  return spent.map((rung) => phrazleHintFor({ answer }, rung).text)
}

const foldAnagrams = (answers: string[], solved: boolean[] = answers.map(() => false)): string[] => {
  const entries = answers.map((answer) => ({ answer }))
  const spent: ThemedAnagramsSpentRung[] = []
  let next = chooseThemedAnagramsRung(entries, { solved }, spent)
  while (next !== null && spent.length <= MAX_LADDER) {
    spent.push(next)
    next = chooseThemedAnagramsRung(entries, { solved }, spent)
  }
  return spent.map((rung) => themedAnagramsHintFor(entries, rung).text)
}

describe('cryptogram sweep', () => {
  it.each([
    // MIN_LETTERS is 12 and MIN_WORDS is 2, so this is the floor.
    ['the structural floor', cryptogramOf('MORNING GLORY')],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES')],
    // MAX_WORDS is 6.
    ['the widest word count', cryptogramOf('ONE OF THE BEST DAYS EVER')],
    // MAX_UNIQUE is 20, and sixteen of these twenty letters appear exactly once.
    ['the distinct-letter ceiling', cryptogramOf('THE QUICK BROWN FOX JUMPS OVER')],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT')],
    // MAX_TEXT_LENGTH is 80, and MIN_WORDS forces a second word, so a 78-letter first word is the
    // longest one a legal cryptogram can hold. Six distinct letters clears MIN_UNIQUE. This row is
    // the reason MAX_CRYPTOGRAM_RUNG_LENGTH is 99 rather than the 80 it once claimed.
    ['the text ceiling', cryptogramOf(`${'ABCDEF'.repeat(13)} B`)],
  ])('builds a capped ladder for %s on a fresh board', (_case, data) => {
    expect(ladderFaults(foldCryptogram(data), MAX_CRYPTOGRAM_RUNG_LENGTH)).toStrictEqual([])
  })

  it.each([
    ['two letters mapped', 2],
    ['half the alphabet in play', 6],
    ['all but one letter mapped', 11],
  ])('builds a capped ladder with %s', (_case, count) => {
    const data = cryptogramOf('THE EARLY BIRD CATCHES')
    expect(ladderFaults(foldCryptogram(data, partlyMapped(data, count)), MAX_CRYPTOGRAM_RUNG_LENGTH)).toStrictEqual([])
  })

  it('offers nothing at all once the board is solved', () => {
    const data = cryptogramOf('THE EARLY BIRD CATCHES')
    expect(foldCryptogram(data, trueMapping(data))).toStrictEqual([])
  })
})

describe('phrazle sweep', () => {
  it.each([
    // The real floor in generators/phrazle/difficulty.ts is MIN_WORDS 2 and MIN_WORD_LETTERS 2.
    ['the structural floor', 'AT IT'],
    ['a two-word phrase', 'TOE HOLD'],
    // The three ceilings, which are independent and are therefore three rows rather than one:
    // MAX_WORD_LETTERS 11, MAX_WORDS 6, and MAX_TOTAL_LETTERS 30. The first is the one the rung cap
    // is derived against and it lands at 77 of 80.
    ['the longest legal word', 'OUTSTANDING WORK'],
    ['the most words', 'AT IT ON UP BY SO'],
    ['the most letters', 'OUTSTANDING PERFORMANCE SPLENDID'],
    ['heavy repetition', 'BANANA STAND'],
    // Chosen to starve rung 2: its letters are almost all common, so the weakest present letters
    // are still fairly strong and the pool is thin.
    ['common letters only', 'RATIO SENATE'],
  ])('builds a capped ladder for %s on a fresh board', (_case, answer) => {
    expect(ladderFaults(foldPhrazle(answer), MAX_PHRAZLE_RUNG_LENGTH)).toStrictEqual([])
  })

  it.each([
    ['one guess', ['ATE MILD']],
    ['several guesses', ['ATE MILD', 'SUN GRIP', 'FOB WAND']],
    // DOT HELL touches T, O, E, H, L and D -- every letter of TOE HOLD -- so rung 2's pool is empty
    // and the ladder has to skip a kind rather than end.
    ['a guess touching every present letter', ['DOT HELL']],
    ['that guess among others', ['ATE MILD', 'DOT HELL', 'SUN GRIP']],
  ])('builds a capped ladder after %s', (_case, guesses) => {
    expect(ladderFaults(foldPhrazle('TOE HOLD', guesses), MAX_PHRAZLE_RUNG_LENGTH)).toStrictEqual([])
  })

  it('still reaches the word rung after every present letter is known', () => {
    expect(foldPhrazle('TOE HOLD', ['DOT HELL'])).toHaveLength(2)
  })

  it('draws the same ladder twice from one seed', () => {
    expect(foldPhrazle('TOE HOLD')).toStrictEqual(foldPhrazle('TOE HOLD'))
  })
})

describe('themed anagrams sweep', () => {
  it.each([
    // MIN_WORD_LENGTH is 5 and MAX_WORD_LENGTH is 9.
    ['the shortest answers', ['LADLE', 'BASIN', 'WHISK', 'PLATE']],
    ['the longest answers', ['COLANDER', 'SAUCEPAN', 'SPATULAS', 'TOASTERS']],
    ['the worst-case shape', ['AAAAAAAAA', 'BBBBBBBBB', 'CCCCCCCCC', 'DDDDDDDDD']],
    ['mixed lengths', ['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA']],
  ])('builds a capped ladder for %s with none solved', (_case, answers) => {
    expect(ladderFaults(foldAnagrams(answers as string[]), MAX_ANAGRAM_RUNG_LENGTH)).toStrictEqual([])
  })

  it.each([
    ['one solved', [true, false, false, false]],
    ['two solved', [true, true, false, false]],
    ['three solved', [true, true, true, false]],
  ])('builds a capped ladder with %s', (_case, solved) => {
    const texts = foldAnagrams(['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA'], solved as boolean[])
    expect(ladderFaults(texts, MAX_ANAGRAM_RUNG_LENGTH)).toStrictEqual([])
  })

  it.each([
    ['one solved', [true, false, false, false]],
    ['two solved', [true, true, false, false]],
    ['three solved', [true, true, true, false]],
  ])('builds a capped ladder on the shortest answers with %s', (_case, solved) => {
    expect(
      ladderFaults(foldAnagrams(['LADLE', 'BASIN', 'WHISK', 'PLATE'], solved as boolean[]), MAX_ANAGRAM_RUNG_LENGTH),
    ).toStrictEqual([])
  })

  it('shortens to two rather than spell out the one five-letter entry left', () => {
    expect(foldAnagrams(['LADLE', 'BASIN', 'WHISK', 'PLATE'], [false, true, true, true])).toStrictEqual([
      'The 1st answer starts with L.',
      'The 1st answer ends with E.',
    ])
  })

  // THE ROUTINE ENDGAME, SWEPT AS A SENTENCE RATHER THAN AS A SHAPE. Three rows in and one to go,
  // all three rungs stack on the survivor -- and each names only the positions the ones before it did
  // not. `ladderFaults` catches a repeated sentence; it cannot catch three sentences that say the
  // same thing in three lengths, which is what this ladder used to ship.
  it('says three different things when all three rungs stack on one entry', () => {
    expect(foldAnagrams(['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA'], [true, true, true, false])).toStrictEqual([
      'The 4th answer starts with S.',
      'The 4th answer ends with A.',
      "The 4th answer's 2nd and 3rd letters are P and A.",
    ])
  })

  it('spreads three rungs across three entries when all four are unsolved', () => {
    const spent: ThemedAnagramsSpentRung[] = []
    const entries = ['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA'].map((answer) => ({ answer }))
    const state = { solved: [false, false, false, false] }
    let next = chooseThemedAnagramsRung(entries, state, spent)
    while (next !== null && spent.length < 3) {
      spent.push(next)
      next = chooseThemedAnagramsRung(entries, state, spent)
    }
    expect(new Set(spent.map((rung) => rung.entryIndex)).size).toBe(3)
  })
})

describe('worst-case shapes', () => {
  it('survives the cryptogram worst case', () => {
    expect(ladderFaults(foldCryptogram({ answer: 'a'.repeat(80), ciphertext: 'Z'.repeat(80) }), NO_CAP)).toStrictEqual(
      [],
    )
  })

  it('survives the phrazle worst case', () => {
    expect(ladderFaults(foldPhrazle('A'.repeat(80)), NO_CAP)).toStrictEqual([])
  })

  it('survives the themed anagrams worst case within its cap', () => {
    expect(
      ladderFaults(foldAnagrams(['AAAAAAAAA', 'AAAAAAAAA', 'AAAAAAAAA', 'AAAAAAAAA']), MAX_ANAGRAM_RUNG_LENGTH),
    ).toStrictEqual([])
  })
})

// THE CROSS-REPO PIN, and it lives here because this file is the only one that can hold it.
//
// hint-phrazle.test.ts restates MAX_WORD_LETTERS as a literal rather than importing it, because that
// file is copied byte-identical into lull-ui and `@generators/...` resolves in only one of the two
// repos. This file does NOT travel, so it can import the real constant and pin the restatement
// against it. Delete this row and the literal over there is free to drift from the gate it claims to
// describe -- which is exactly how the rung cap came to be derived from a MAX_WORD_LETTERS of 7 that
// no version of this repo has ever held.
//
// IT READS THE VENDORED TEST'S SOURCE, and that is the only way this row can be what it says it is.
// The version it replaced asserted `expect(MAX_WORD_LETTERS).toBe(11)` -- the generator's constant
// against a fresh literal typed here -- which pins nothing about the OTHER file: editing
// hint-phrazle.test.ts's local `MAX_WORD_LETTERS = 11` back to the 7 this comment is a post-mortem of
// left this suite green. Importing the restatement is not open either: an import runs the vendored
// file's `describe` blocks a second time inside this one. So the pin is over the text, which is the
// artifact that actually travels.
const restatedInVendoredTest = (constant: string): number => {
  const source = readFileSync(join(__dirname, 'hint-phrazle.test.ts'), 'utf8')
  return Number(new RegExp(`^const ${constant} = (\\d+)$`, 'm').exec(source)?.[1] ?? NaN)
}

describe('the constants the vendored tests restate', () => {
  it('pins the phrazle word ceiling the vendored test restates against the gate itself', () => {
    expect(restatedInVendoredTest('MAX_WORD_LETTERS')).toBe(MAX_WORD_LETTERS)
  })

  // 41-character frame, eleven letters, nine ", " separators, one ", and ", and the closing period.
  // Recomputed here rather than trusted, because three characters of headroom is not much to lose.
  it('leaves the phrazle word rung inside its cap at that ceiling', () => {
    expect(41 + MAX_WORD_LETTERS + 9 * 2 + 6 + 1).toBeLessThanOrEqual(MAX_PHRAZLE_RUNG_LENGTH)
  })

  /*
   * THE TWO THEMED ANAGRAMS GATES ARE EXPORTED, so this file imports them and asserts the fixtures
   * against them rather than against the numbers in the comment beside those rows. If the word
   * length band moves, the sweep's longest board stops being the longest, and this is what says so.
   *
   * THE FLOOR IS ASSERTED AS `<=` AND THE CEILING AS `===`, and the asymmetry is the point rather
   * than a hedge. This file tests src/rules/, which is VENDORED INTO lull-ui AND RUNS ON THE DEVICE,
   * over whatever a stored pack carries -- and the pack archive is retained forever. When
   * MIN_WORD_LENGTH went 5 -> 6 the generator stopped MAKING five-letter answers; it did not and
   * could not remove them from every pack already written, so the device keeps meeting them for as
   * long as those days are reachable.
   *
   * So the five-letter boards stay. Raising them to six alongside the gate would have kept this row
   * green while deleting the only coverage of a length the device still has to render -- which is
   * the failure this row exists to prevent, inverted. What the sweep owes is the committed band AND
   * anything historical below it; what it must not do is stop short of the ceiling.
   */
  it('sweeps the themed anagrams boards across the committed word band and the historical floor', () => {
    const lengths = ['LADLE', 'BASIN', 'WHISK', 'PLATE', 'AAAAAAAAA', 'BBBBBBBBB'].map((answer) => answer.length)

    expect(Math.min(...lengths)).toBeLessThanOrEqual(MIN_WORD_LENGTH)
    expect(Math.max(...lengths)).toBe(MAX_WORD_LENGTH)
  })
})
