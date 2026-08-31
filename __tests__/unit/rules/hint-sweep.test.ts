import {
  chooseCryptogramRung,
  CryptogramSpentRung,
  cryptogramHintFor,
  MAX_CRYPTOGRAM_RUNG_LENGTH,
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

// THE SWEEP IS WHY THESE RULES MAY LIVE IN src/rules AT ALL. lull-api ships none of these hints, so
// nothing else here executes these files; the directory's condition is that this repo runs them.
// It is a TEST rather than a gate in the generators: a hint that does not ship must never be able to
// cost a player a puzzle, and a redraw triggered by an unhappy hint would do exactly that.
//
// IT RUNS PARTLY-ESTABLISHED PLAYER STATES, NOT JUST EMPTY ONES, and that is the difference between
// a sweep and a formality. Against an empty state these builders provably cannot return null --
// every cipher letter is unmapped, every entry unsolved, and a phrase of at most eighteen letters
// leaves most of the alphabet absent -- so a sweep that only ever passes `{}` asserts three rungs in
// the one state where three are guaranteed. Both of the bugs this file now covers, a barren pool
// killing every later rung and three rungs stacking onto one entry, were invisible to it.
//
// THE FIXTURES SIT AT THE REAL STRUCTURAL CORNERS, read off the committed gates rather than
// invented. Cryptogram: MAX_TEXT_LENGTH 80, MIN_WORDS 2 and MAX_WORDS 6 in services/phrases.ts, plus
// MIN_LETTERS 12 and 6-20 distinct in generators/cryptogram/difficulty.ts. Phrazle: 2-3 words of 3-7
// letters totalling at most 18, in generators/phrazle/difficulty.ts. Themed Anagrams: 5-9 letters in
// generators/themedanagrams/words.ts. An earlier draft swept `ARROW` as a one-word cryptogram and
// `EXTRAORDINARY THING` as a long Phrazle, and neither is a shape either generator can produce.

// worst-case.ts fills every bounded field to its bound INDEPENDENTLY, so its answers are shapes the
// byte budget has to carry rather than puzzles a generator can emit: cryptogram's is a single
// 80-letter word, which MIN_WORDS forbids, and phrazle's is a single 80-letter word, which the
// structural floor forbids twice over. Those rows are swept for everything BUT the cap, which is
// derived over reachable puzzles.
const NO_CAP = Number.POSITIVE_INFINITY

/**
 * Every way a ladder can be wrong, as sentences: one to three rungs, each non-empty, each inside the
 * cap, and no two the same.
 *
 * A FAULT LIST RATHER THAN A BLOCK OF ASSERTIONS, so every row of every table below reads
 * `expect(...).toStrictEqual([])` and a failure names what broke rather than which line it broke on.
 */
const ladderFaults = (texts: string[], cap: number): string[] => [
  ...(texts.length >= 1 && texts.length <= 3 ? [] : [`ladder of ${texts.length} rungs`]),
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

const foldCryptogram = (
  data: { answer: string; ciphertext: string },
  mapping: Record<string, string> = {},
): string[] => {
  const spent: CryptogramSpentRung[] = []
  let next = chooseCryptogramRung(data, { mapping }, spent)
  while (next !== null && spent.length < 3) {
    spent.push(next)
    next = chooseCryptogramRung(data, { mapping }, spent)
  }
  return spent.map((rung) => cryptogramHintFor(data, rung).text)
}

const foldPhrazle = (answer: string, guesses: string[] = []): string[] => {
  const random = seededRandom(answer)
  const spent: PhrazleSpentRung[] = []
  let next = choosePhrazleRung({ answer }, { guesses }, spent, random)
  while (next !== null && spent.length < 3) {
    spent.push(next)
    next = choosePhrazleRung({ answer }, { guesses }, spent, random)
  }
  return spent.map((rung) => phrazleHintFor({ answer }, rung).text)
}

const foldAnagrams = (answers: string[], solved: boolean[] = answers.map(() => false)): string[] => {
  const entries = answers.map((answer) => ({ answer }))
  const spent: ThemedAnagramsSpentRung[] = []
  let next = chooseThemedAnagramsRung(entries, { solved }, spent)
  while (next !== null && spent.length < 3) {
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
      'The 1st answer starts with L and ends with E.',
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
