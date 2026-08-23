import { isValidGuess, splitPhrase } from '@rules/is-valid-guess'

import { getDictionary } from '@generators/phrazle/dictionary'
import { addPhrasePuzzles, createPack } from '@services/packs'
import { Familiarity, Phrase, PhraseShape, PhrazleData, Puzzle } from '@types'

// The one test that wires the REAL registry through createPack. Every other suite substitutes a
// fake generator (packs.test.ts) or calls generate directly (generator.test.ts), so without this
// nothing proves the actual generators produce a valid, complete pack -- which is exactly the gap
// a 100%-coverage figure hides. Only the storage layer and the random sources are stubbed.
const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

const mockRandomBytes = jest.fn()
jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
}))

jest.mock('@utils/logging')

// A seeded Lehmer generator, the same source generator.test.ts uses. createPack takes no random
// parameter -- the registry hands generate() its defaults -- so Math.random and randomBytes are the
// seams. Stubbing them is not optional: this suite ran on live randomness and was flaky at 11% of
// runs, because randomBytes(4).toString('hex') is all digits 2.3% of the time and an earlier
// assertion read a digits-only suffix as a positional index.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

// Fourteen, not eight, and spanning familiarity 1-5 rather than sitting on the default. Cryptogram
// takes two and Missing Vowels two after the pack-wide count table rebalance, so the pool now runs
// a wide surplus -- which is the point: eight all-familiarity-3 phrases left cryptogram with zero
// slack, and one rejection came up short, which is a fixture that tests luck.
//
// Annotated with letters/unique, which repetition nudge fires, and the difficulty each derives to,
// so a reader can check that Cryptogram's declared bands 3 and 4 are both reachable without
// running anything. EVERY ANNOTATION HERE WAS RE-MEASURED against difficulty.ts as it stands.
// Eight of the twelve were stale: they described `repeats >= 6` and `unique >= 14`, the absolute
// pair that HIGH_REPETITION/LOW_REPETITION replaced, so each of the eight claimed a repetition
// nudge the ratio rule does not give it, and seven of them named a derived difficulty one band
// easier than the code produces. A fixture annotation nothing executes is exactly the kind that
// rots without turning anything red.
//
// Rows 13 and 14 were added by the foundation branch against a floor that no longer exists as
// described: its comment said they clear "2-3 words, 3-7 letters each, <=18 letters total, AT
// LEAST ONE SHARED LETTER", and Phrazle's structural floor has no cross-word-sharing clause -- the
// premise behind it was false and it was cutting a fifth of the compact supply. Both rows still
// clear the three bounds that do exist, and both derive to 5.
//
// ROWS 15 AND 16 ARE PHRAZLE'S OWN, and they are here because without them the fixture starves one
// of its two declared bands BY CONSTRUCTION rather than by luck:
//
//   * BAND 3 had nothing at all. Every Phrazle-eligible phrase above derives to 5, and +/-1 cannot
//     reach 3 from there. `Toe hold` -- 7 letters, two words, one shared letter -- derives to 3 and
//     is invisible to both other generators: Cryptogram's floor is >= 12 letters, and TOEHOLD has
//     four consonants against Missing Vowels' six.
//   * BAND 5 was contested rather than empty. `Bite the bullet` clears Phrazle's full predicate and
//     derives to 5, and ALSO clears Cryptogram's twelve-letter floor -- and Cryptogram draws first.
//     `Split second` is 11 letters, which is width 5 for Phrazle and one letter under Cryptogram's
//     floor, so it is band-5 supply nothing else can take.
//
// `The Great Gatsby` clears the structural floor and derives to 5 and is STILL invisible: GATSBY is
// a proper noun and ENABLE holds none, so the dictionary clause rejects it. That is the trade
// stated rather than discovered.
//
// Every word of every Phrazle-eligible row here must be in __tests__/fixtures/v1.txt, which is the
// half a reader cannot check from this file and the half that rejects a fixture phrase silently.
// __tests__/unit/services/dictionary-asset.test.ts names them.
const phrases: Phrase[] = (
  [
    ['The Empire Strikes Back', 4, 'title'], //     20/12, neither -> derives 2
    ['Raiders of the Lost Ark', 4, 'title'], //     19/12, neither -> derives 2
    ['Time flies like an arrow', 3, 'idiom'], //    20/13, neither -> derives 3
    ['To be or not to be', 5, 'quote'], //          13/6,  repeats -> derives 1 (clamped)
    ['Pride and Prejudice', 4, 'title'], //         17/10, neither -> derives 2
    ['Bite the bullet', 3, 'idiom'], //             13/7,  neither -> derives 3
    ['A stitch in time', 1, 'idiom'], //            13/9,  neither -> derives 5
    ['The Great Gatsby', 3, 'title'], //            14/9,  neither -> derives 3
    ['Gone with the Wind', 2, 'title'], //          15/9,  neither -> derives 4
    ['Better late than never', 3, 'idiom'], //      19/9,  repeats -> derives 2
    ['The Old Man and the Sea', 3, 'title'], //     18/10, neither -> derives 3
    ['Curiosity killed the cat', 2, 'idiom'], //    21/14, neither -> derives 4
    ['Brave New World', 2, 'title'], //             13/10, sparse  -> derives 5;  5/3/5 words, 13 letters
    ['Under the radar', 3, 'idiom'], //             13/8,  neither -> derives 3;  5/3/5 words, 13 letters
    ['Toe hold', 3, 'compact'], //                  7 letters -- BELOW Cryptogram's floor; Phrazle derives 3
    ['Split second', 4, 'compact'], //             11 letters -- BELOW Cryptogram's floor; Phrazle derives 5
  ] as [string, Familiarity, PhraseShape][]
).map(([text, familiarity, shape], index) => ({
  category: 'Thing',
  familiarity,
  hints: [`A narrower thing ${index}`, `Where you meet thing ${index}`, `Almost naming thing ${index}`] as [
    string,
    string,
    string,
  ],
  shape,
  text,
}))

describe('createPack with the real registry', () => {
  // At or after the real registry's availableFrom of '2026-08-01', which the other packs suites can
  // sidestep by dating their fixtures and this one cannot: it wires the ACTUAL contributions
  // through. On a date before that, all three are out of range, missingDifficulties returns [] for
  // every one of them, and every assertion here runs over an empty pack -- several of which
  // ("no cryptogram has a fixed point", "no goal is negative") pass vacuously over zero puzzles.
  const packDate = '2026-08-15'
  // Fixed seeds, not a fresh draw per run. Every difficulty band is reachable from ~99% of banks so
  // any seed builds a full pack; pinning them means this suite covers a spread of real draws
  // without covering a different spread tomorrow.
  const seeds = [7, 11, 23, 41, 97]

  const setup = (seed: number): void => {
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)

    jest.spyOn(Math, 'random').mockImplementation(seededRandom(seed))
    let shortIdCount = 0
    mockRandomBytes.mockImplementation(() => Buffer.from([0xab, 0xc1, 0x23, shortIdCount++]))
  }

  afterAll(() => {
    jest.restoreAllMocks()
  })

  // Both halves, with the REAL registry. createPack alone can never complete a pack now -- the
  // phrase-backed type is added afterwards by the async builder -- so the integration case has to
  // run the same two steps production does.
  const buildFullPack = async () => {
    await createPack(packDate)
    // The written pack becomes the stored one for the second half, exactly as it does in
    // production where the async builder re-reads what the first half wrote.
    mockGetPackByDate.mockResolvedValue(writtenPack())
    return addPhrasePuzzles(packDate, phrases)
  }

  const writtenPack = () => mockSetPackByDate.mock.calls.at(-1)?.[1]

  it.each(seeds)('builds a complete pack of real puzzles from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    expect(pack.complete).toEqual(true)
    expect(pack.date).toEqual(packDate)
    // Three goFigure, two Cryptogram and two Missing Vowels, per the pack-wide count table.
    expect(pack.puzzles).toHaveLength(7)
  })

  it('stores the ids the generator produced rather than re-deriving them', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    // That the suffix is opaque and carries no position is generate()'s contract, proven against an
    // injected shortId in generator.test.ts. What only this suite can prove is that createPack
    // passes those ids through untouched instead of stamping a slot number on them.
    //
    // The ORDER is the second thing this pins. createPack spends 00-02 on goFigure, and
    // addPhrasePuzzles then walks phraseGenerators in registry order -- cryptogram before Missing
    // Vowels, which is load-bearing, since the two share one mutated pool and the permissive
    // generator picking first would leave the restrictive one nothing it can use. randomBytes is
    // stubbed to a counter, so the suffixes run 00 through 06 in the order the puzzles were built.
    expect(pack.puzzles.map((puzzle) => puzzle.id)).toEqual([
      `${packDate}:gofigure:abc12300`,
      `${packDate}:gofigure:abc12301`,
      `${packDate}:gofigure:abc12302`,
      `${packDate}:cryptogram:abc12303`,
      `${packDate}:cryptogram:abc12304`,
      `${packDate}:missingvowels:abc12305`,
      `${packDate}:missingvowels:abc12306`,
    ])
  })

  it.each(seeds)('covers every declared difficulty of every type exactly once from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    const difficultiesFor = (type: string) =>
      pack.puzzles
        .filter((puzzle) => puzzle.type === type)
        .map((puzzle) => puzzle.difficulty)
        .sort()
    // The three ODD bands: goFigure is the only self-contained type, so it is the only one that can
    // cover a band without spending a phrase.
    expect(difficultiesFor('gofigure')).toEqual([1, 3, 5])
    // Band 4 is Cryptogram's alone and band 5 is left to Phrazle. A cryptogram with nothing
    // pre-filled has a floor of effort a band-1 or band-2 rating would misdescribe.
    expect(difficultiesFor('cryptogram')).toEqual([3, 4])
    expect(difficultiesFor('missingvowels')).toEqual([1, 2])
  })

  // The used-phrase set is what stops one pack shipping the same phrase twice, and it now has to
  // hold ACROSS types: two phrase generators draw from one pool, so a cryptogram and a missing
  // vowels puzzle on the same answer is the failure this proves cannot happen. Filtered on the
  // presence of `answer` rather than on a type literal -- goFigure carries none, which is exactly
  // how create-phrase-puzzles.ts builds its own anti-repetition list.
  it.each(seeds)('never repeats a phrase within a pack from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    // Two cryptograms and two missing vowels, one phrase each.
    expect(answers).toHaveLength(4)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  // Every letter substituted, every space kept, and no letter left standing on itself. A ciphertext
  // that lost a space is a different phrase; one with a fixed point hands the solver a free letter
  // on a board with nothing pre-filled.
  it.each(seeds)('enciphers every cryptogram without a fixed point from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    const cryptograms = pack.puzzles
      .filter((puzzle) => puzzle.type === 'cryptogram')
      .map((puzzle) => (puzzle as Puzzle<{ answer: string; ciphertext: string }>).data)
    const broken = cryptograms.filter(({ answer, ciphertext }) => {
      const plain = answer.toUpperCase()
      return (
        ciphertext.length !== plain.length ||
        // LETTERS only. A space sits at the same index in both strings by design -- that is the
        // word shapes surviving, which is the puzzle -- so comparing every position would call
        // every phrase with a space in it a fixed point.
        ciphertext.split('').some((character, index) => /[A-Z]/.test(character) && character === plain[index]) ||
        // Word shapes preserved, stated as its own clause rather than left to the length check:
        // a cipher that dropped a space and gained a letter would still be 23 characters long.
        ciphertext
          .split('')
          .map((character) => character === ' ')
          .join('') !==
          plain
            .split('')
            .map((character) => character === ' ')
            .join('')
      )
    })

    // The count first. `broken` is empty over a pack with no cryptograms in it too, so without this
    // the assertion below leans on a SIBLING test for its subject -- and a build that stopped
    // producing cryptograms altogether would leave this one green while the test that names the
    // count goes red.
    expect(cryptograms).toHaveLength(2)
    expect(broken).toEqual([])
  })

  // Every letter the player needs, and nothing else. A displayed string that lost or gained a
  // consonant is unsolvable rather than hard.
  it.each(seeds)('displays exactly the answer consonants from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    const displayedPuzzles = pack.puzzles
      .filter((puzzle) => puzzle.type === 'missingvowels')
      .map((puzzle) => (puzzle as Puzzle<{ answer: string; displayed: string }>).data)
    const broken = displayedPuzzles.filter(
      ({ answer, displayed }) =>
        displayed.replace(/ /g, '') !==
        answer
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .replace(/[AEIOU]/g, ''),
    )

    // The subject, before the property. See the cryptogram case above.
    expect(displayedPuzzles).toHaveLength(2)
    expect(broken).toEqual([])
  })

  it.each(seeds)('emits only positive goals from seed %i', async (seed) => {
    setup(seed)

    const pack = await createPack(packDate)
    const goals = pack.puzzles
      .filter((puzzle) => puzzle.type === 'gofigure')
      .map((puzzle) => (puzzle as Puzzle<{ goal: number }>).data.goal)

    expect(goals).toHaveLength(3)
    expect(goals.filter((goal) => goal <= 0)).toEqual([])
  })

  it.each(seeds)('emits accepted solutions that all reach the stated goal from seed %i', async (seed) => {
    setup(seed)

    const pack = await createPack(packDate)

    const evaluate = (expression: string): number => {
      const operands = expression.split(/[+\-*/]/).map(Number)
      const operators = [...expression.matchAll(/[+\-*/]/g)].map((match) => match[0])
      return operators.reduce((total, operator, index) => {
        const operand = operands[index + 1]
        return operator === '+'
          ? total + operand
          : operator === '-'
            ? total - operand
            : operator === '*'
              ? total * operand
              : total / operand
      }, operands[0])
    }

    const solutions = pack.puzzles
      .filter((puzzle) => puzzle.type === 'gofigure')
      .flatMap((puzzle) => {
        const { acceptedSolutions, goal } = (puzzle as Puzzle<{ acceptedSolutions: string[]; goal: number }>).data
        return acceptedSolutions.map((expression) => ({ expression, goal }))
      })
    const mismatched = solutions.filter(({ expression, goal }) => evaluate(expression) !== goal)

    // Three puzzles, each with at least one accepted solution -- the exact count varies by seed, and
    // this is what stops the assertion below passing over a pack that emitted none at all.
    expect(solutions.length).toBeGreaterThanOrEqual(3)
    expect(mismatched).toEqual([])
  })
})

// THE ALLOCATOR FILLS EVERY DECLARED BAND, end to end, with the real registry and the real ordering.
//
// It lands HERE rather than in generators/index.test.ts, and the obvious answer is the wrong one:
// generateFromPhrases is not exported, the only public door is addPhrasePuzzles, and that routes
// through buildPack -> getPackByDate/setPackByDate and therefore needs the storage layer stubbed.
// index.test.ts imports four generator modules and mocks nothing; turning it into a suite that stubs
// DynamoDB would duplicate exactly what this file already does. Exporting a function purely to make
// it easier to test is the trade this repo does not take; moving the test to the suite that already
// owns the seam is free.
//
// WHAT THIS BLOCK PROVES AND WHAT IT DOES NOT, measured rather than claimed. Over the sixteen-phrase
// fixture the pool runs a SURPLUS, so moving phrazleGenerator to the end of phraseGenerators leaves
// every assertion here green -- run, watched, reverted. It proves the bands are FILLABLE end to end
// with the real registry, which is worth having and is not the same claim. The ordering itself is
// order-sensitive only when the pool is tight, and the tight-pool case below is what holds it.
describe('addPhrasePuzzles once Phrazle is available', () => {
  // ON OR AFTER phrazleGenerator.availableFrom, which the block above deliberately sits before: a
  // date earlier than it puts Phrazle out of range, missingDifficulties returns [] for it, and every
  // assertion here would pass vacuously over a pack with no Phrazle in it.
  const packDate = '2026-09-02'
  const seeds = [7, 11, 23, 41, 97]

  const setup = (seed: number): void => {
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)

    jest.spyOn(Math, 'random').mockImplementation(seededRandom(seed))
    let shortIdCount = 0
    mockRandomBytes.mockImplementation(() => Buffer.from([0xab, 0xc1, 0x23, shortIdCount++]))
  }

  afterAll(() => {
    jest.restoreAllMocks()
  })

  const buildFullPack = async () => {
    await createPack(packDate)
    mockGetPackByDate.mockResolvedValue(mockSetPackByDate.mock.calls.at(-1)?.[1])
    return addPhrasePuzzles(packDate, phrases)
  }

  const difficultiesFor = (pack: { puzzles: Puzzle[] }, type: string) =>
    pack.puzzles
      .filter((puzzle) => puzzle.type === type)
      .map((puzzle) => puzzle.difficulty)
      .sort()

  it.each(seeds)('fills every declared band of every phrase type from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    // THE SUBJECT FIRST. An empty list sorts equal to an empty list, so without the count a run that
    // produced no Phrazle at all would satisfy a toStrictEqual against the wrong empty array.
    expect(pack.puzzles.filter((puzzle) => puzzle.type === 'phrazle')).toHaveLength(2)
    expect(difficultiesFor(pack, 'phrazle')).toStrictEqual([3, 5])
    // And the two it shares a pool with, in the same run: filling Phrazle's bands by starving
    // Cryptogram's would be the failure the ordering exists to prevent, not a pass.
    expect(difficultiesFor(pack, 'cryptogram')).toStrictEqual([3, 4])
    expect(difficultiesFor(pack, 'missingvowels')).toStrictEqual([1, 2])
    expect(difficultiesFor(pack, 'gofigure')).toStrictEqual([1, 3, 5])
  })

  // NINE, not thirteen, and the runbook asserts the same number for the same reason: the model lane
  // runs in a different handler, and Themed Anagrams shares this date's availableFrom. `complete` is
  // therefore false, and it is false because the model types are owed rather than because any phrase
  // band came up short -- which the band assertions above are what distinguish.
  it('builds nine puzzles from the two lanes this path runs', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    expect(pack.puzzles).toHaveLength(9)
    expect(pack.complete).toEqual(false)
  })

  it.each(seeds)('never repeats a phrase across three phrase types from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    // Two cryptograms, two Phrazles and two missing vowels, one phrase each.
    expect(answers).toHaveLength(6)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  it.each(seeds)('ships every Phrazle in canonical form with a full ladder from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const phrazles = pack.puzzles
      .filter((puzzle) => puzzle.type === 'phrazle')
      .map((puzzle) => (puzzle as Puzzle<PhrazleData>).data)

    expect(phrazles).toHaveLength(2)
    // Canonical: uppercase A-Z words separated by single spaces, which is what the board paints and
    // what markGuess marks. Anything else is a board whose tiles do not match its own answer string.
    expect(phrazles.filter(({ answer }) => !/^[A-Z]+( [A-Z]+)+$/.test(answer))).toStrictEqual([])
    // Six on the wire, three rungs, every rung tagged, and NO category on either -- the visibility
    // table hides at 3 and 5, which are this type's only two bands.
    expect(phrazles.filter(({ maxGuesses }) => maxGuesses !== 6)).toStrictEqual([])
    expect(phrazles.filter(({ hints }) => hints.length !== 3)).toStrictEqual([])
    expect(
      phrazles.filter(({ hints }) => hints.some((hint) => hint.metadata?.kind !== 'phrazle-reveal')),
    ).toStrictEqual([])
    expect(phrazles.filter(({ category }) => category !== undefined)).toStrictEqual([])
  })

  // The grid derives from `answer` through the same splitter the guess goes through, so there is no
  // wordLengths field to disagree with it -- and every word of every shipped answer is one the
  // committed dictionary holds, which is the generator's own self-check proved from the outside.
  it.each(seeds)('ships answers the guess dictionary accepts from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const rejected = pack.puzzles
      .filter((puzzle) => puzzle.type === 'phrazle')
      .map((puzzle) => (puzzle as Puzzle<PhrazleData>).data.answer)
      .filter((answer) => {
        const words = splitPhrase(answer)
        return !isValidGuess(
          words,
          words.map((word) => word.length),
          getDictionary(),
        )
      })

    expect(rejected).toStrictEqual([])
  })
})

// THE ORDERING, HELD BY A POOL THAT IS EXACTLY BIG ENOUGH. Six phrases against six phrase-puzzle
// demands, chosen so that one phrase is contested and the contest is decided by array order alone.
//
// PROVED TO GO RED: with phraseGenerators as [cryptogram, phrazle, missingvowels] every band fills;
// move phrazleGenerator to the end and Missing Vowels -- which accepts almost anything and ignores
// difficulty entirely -- takes SPLIT SECOND before Phrazle sees it, and Phrazle's band 5 comes up
// empty. That is the failure the array order exists to prevent, and the surplus fixture above cannot
// see it.
describe('the phrase generator ordering, over a pool that is exactly big enough', () => {
  const packDate = '2026-09-02'

  // Each row is annotated with WHO can use it, because that is the whole design of this fixture and
  // it is not readable off the strings:
  //
  //   Time flies like an arrow   20 letters, 5 words  -> Cryptogram only (derives 3)
  //   Curiosity killed the cat   21 letters, 4 words  -> Cryptogram only (derives 4)
  //   Split second               11 letters, 2 words  -> CONTESTED: Phrazle band 5, and Missing
  //                                                      Vowels can use it too (8 consonants).
  //                                                      One letter under Cryptogram's floor.
  //   Sandwich bar               11 letters, SANDWICH is 8 -> Missing Vowels only
  //   Elephant ear               11 letters, ELEPHANT is 8 -> Missing Vowels only (6 consonants,
  //                                                           exactly its floor)
  //   Toe hold                    7 letters, 2 words  -> Phrazle band 3 only. Four consonants, so
  //                                                      Missing Vowels cannot take it whatever the
  //                                                      order -- which is why band 3 survives a bad
  //                                                      order and band 5 does not.
  const tightPool: Phrase[] = (
    [
      ['Time flies like an arrow', 3, 'idiom'],
      ['Curiosity killed the cat', 2, 'idiom'],
      ['Split second', 4, 'compact'],
      ['Sandwich bar', 3, 'idiom'],
      ['Elephant ear', 3, 'idiom'],
      ['Toe hold', 3, 'compact'],
    ] as [string, Familiarity, PhraseShape][]
  ).map(([text, familiarity, shape], index) => ({
    category: 'Thing',
    familiarity,
    hints: [`A narrower thing ${index}`, `Where you meet thing ${index}`, `Almost naming thing ${index}`] as [
      string,
      string,
      string,
    ],
    shape,
    text,
  }))

  afterAll(() => {
    jest.restoreAllMocks()
  })

  it('gives every phrase type its declared bands when nothing is spare', async () => {
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)
    jest.spyOn(Math, 'random').mockImplementation(seededRandom(7))
    let shortIdCount = 0
    mockRandomBytes.mockImplementation(() => Buffer.from([0xab, 0xc1, 0x23, shortIdCount++]))

    await createPack(packDate)
    mockGetPackByDate.mockResolvedValue(mockSetPackByDate.mock.calls.at(-1)?.[1])
    const pack = await addPhrasePuzzles(packDate, tightPool)

    const bandsOf = (type: string) =>
      pack.puzzles
        .filter((puzzle) => puzzle.type === type)
        .map((puzzle) => puzzle.difficulty)
        .sort()

    expect(bandsOf('cryptogram')).toStrictEqual([3, 4])
    expect(bandsOf('phrazle')).toStrictEqual([3, 5])
    expect(bandsOf('missingvowels')).toStrictEqual([1, 2])
    // Every one of the six spent, one per puzzle, never reused within a pack.
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)
    expect(new Set(answers).size).toEqual(6)
  })
})
