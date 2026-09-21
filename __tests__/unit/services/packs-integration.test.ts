import { isValidGuess, splitPhrase } from '@rules/is-valid-guess'

import { getDictionary } from '@generators/phrazle/dictionary'
import { addPhrasePuzzles, createPack } from '@services/packs'
import { Familiarity, Phrase, PhraseShape, PhrazleData, Puzzle } from '@types'

// The one suite wiring the REAL registry through createPack; only storage and the random sources
// are stubbed.
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

// A seeded Lehmer generator. createPack takes no random parameter -- the registry hands
// generate() its defaults -- so Math.random and randomBytes are the only seams.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

// A deliberate surplus pool spanning familiarity 1-5: a tight pool leaves Cryptogram no slack and
// a fixture that tests luck. The annotations (letters/unique, derived difficulty) are checked
// against difficulty.ts by hand; nothing executes them.
//
// The last three rows are Phrazle's own, because without them the fixture starves a declared band
// by construction: every other Phrazle-eligible phrase derives to 5, band 5 is contested by
// Cryptogram (which draws first), and band 2 is the bottom of what the dial can return. All three
// are under Cryptogram's twelve-letter floor and short of Missing Vowels' six consonants.
//
// Every word of every Phrazle-eligible row must be in __tests__/fixtures/v1.txt, which
// dictionary-asset.test.ts names -- a missing word rejects a fixture phrase silently.
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
    ['Deep end', 3, 'compact'], //                  7 letters -- BELOW Cryptogram's floor; Phrazle derives 2
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
  // At or after the registry's availableFrom of '2026-08-01', or every contribution is out of
  // range and the assertions below pass vacuously over an empty pack.
  const packDate = '2026-08-15'
  // Fixed seeds: a spread of real draws, and the same spread tomorrow.
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

  // Both halves, as production runs them: the written pack becomes the stored one the second
  // half re-reads.
  const buildFullPack = async () => {
    await createPack(packDate)
    mockGetPackByDate.mockResolvedValue(writtenPack())
    return addPhrasePuzzles(packDate, phrases)
  }

  const writtenPack = () => mockSetPackByDate.mock.calls.at(-1)?.[1]

  it.each(seeds)('builds every self-contained and phrase-backed puzzle from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    // Incomplete is the assertion, not a shortfall: the model lane runs in addModelPuzzles, and
    // both its types apply to this date, so isComplete finds them missing.
    expect(pack.complete).toEqual(false)
    expect(pack.date).toEqual(packDate)
    expect(pack.puzzles).toHaveLength(11)
  })

  it('stores the ids the generator produced rather than re-deriving them', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    // Ids pass through untouched rather than being stamped with a slot number, and the ORDER is
    // load-bearing: the three phrase generators share one mutated pool. randomBytes is stubbed to
    // a counter, so the suffixes run 00 through 0a in build order.
    expect(pack.puzzles.map((puzzle) => puzzle.id)).toEqual([
      `${packDate}:gofigure:abc12300`,
      `${packDate}:gofigure:abc12301`,
      `${packDate}:gofigure:abc12302`,
      `${packDate}:phrazle:abc12303`,
      `${packDate}:phrazle:abc12304`,
      `${packDate}:phrazle:abc12305`,
      `${packDate}:cryptogram:abc12306`,
      `${packDate}:cryptogram:abc12307`,
      `${packDate}:missingvowels:abc12308`,
      `${packDate}:missingvowels:abc12309`,
      `${packDate}:missingvowels:abc1230a`,
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
    // goFigure is the only self-contained type, so the only one covering a band without a phrase.
    expect(difficultiesFor('gofigure')).toEqual([2, 4, 5])
    expect(difficultiesFor('cryptogram')).toEqual([2, 3])
    expect(difficultiesFor('missingvowels')).toEqual([1, 2, 4])
  })

  // The used-phrase set has to hold ACROSS types, since the generators draw from one pool.
  // Filtered on the presence of `answer`, as create-phrase-puzzles.ts builds its own list.
  it.each(seeds)('never repeats a phrase within a pack from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    expect(answers).toHaveLength(8)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  // A lost space is a different phrase; a fixed point is a free letter on an empty board.
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
        // Letters only: spaces sit at the same index in both strings by design.
        ciphertext.split('').some((character, index) => /[A-Z]/.test(character) && character === plain[index]) ||
        // Word shapes, as its own clause: dropping a space and gaining a letter keeps the length.
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

    // The count first: `broken` is empty over a pack with no cryptograms in it too.
    expect(cryptograms).toHaveLength(2)
    expect(broken).toEqual([])
  })

  // A displayed string that lost or gained a consonant is unsolvable rather than hard.
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

    expect(displayedPuzzles).toHaveLength(3)
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

    // The exact count varies by seed; this stops the assertion below passing over an empty list.
    expect(solutions.length).toBeGreaterThanOrEqual(3)
    expect(mismatched).toEqual([])
  })
})

// The allocator fills every declared band end to end. It lives here rather than in
// generators/index.test.ts because generateFromPhrases is not exported, and its only public door
// routes through buildPack and needs storage stubbed. This pool runs a SURPLUS, so it proves the
// bands are fillable, not that the ordering matters -- the tight-pool block below holds that.
describe('addPhrasePuzzles once Phrazle is available', () => {
  // On or after phrazleGenerator.availableFrom, which the block above deliberately precedes.
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

    // The subject first: a run with no Phrazle satisfies a toStrictEqual against an empty array.
    expect(pack.puzzles.filter((puzzle) => puzzle.type === 'phrazle')).toHaveLength(3)
    expect(difficultiesFor(pack, 'phrazle')).toStrictEqual([2, 3, 5])
    // And the two it shares a pool with: filling Phrazle's bands by starving Cryptogram's fails.
    expect(difficultiesFor(pack, 'cryptogram')).toStrictEqual([2, 3])
    expect(difficultiesFor(pack, 'missingvowels')).toStrictEqual([1, 2, 4])
    expect(difficultiesFor(pack, 'gofigure')).toStrictEqual([2, 4, 5])
  })

  // `complete` is false because the model lane runs in a different handler, not because a band
  // came up short -- which the band assertions above distinguish.
  it('builds eleven puzzles from the two lanes this path runs', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    expect(pack.puzzles).toHaveLength(11)
    expect(pack.complete).toEqual(false)
  })

  it.each(seeds)('never repeats a phrase across three phrase types from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    expect(answers).toHaveLength(8)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  it.each(seeds)('ships every Phrazle in canonical form and with no ladder from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const phrazles = pack.puzzles
      .filter((puzzle) => puzzle.type === 'phrazle')
      .map((puzzle) => (puzzle as Puzzle<PhrazleData>).data)

    expect(phrazles).toHaveLength(3)
    // Canonical: uppercase A-Z words separated by single spaces, which is what the board paints
    // and markGuess marks. Anything else is a board whose tiles do not match its own answer.
    expect(phrazles.filter(({ answer }) => !/^[A-Z]+( [A-Z]+)+$/.test(answer))).toStrictEqual([])
    // Two absences over the whole run, catching a field that creeps back onto only some bands.
    expect(phrazles.filter((data) => 'maxGuesses' in data)).toStrictEqual([])
    expect(phrazles.filter((data) => 'hints' in data)).toStrictEqual([])
    // CATEGORY_HIDDEN_BY_DIFFICULTY hides at 3 and 5 and shows at 1, so this is asserted by band;
    // a blanket absence stops describing the type the moment a band changes.
    const categoryByBand = Object.fromEntries(
      pack.puzzles
        .filter((puzzle) => puzzle.type === 'phrazle')
        .map((puzzle) => [puzzle.difficulty, (puzzle as Puzzle<PhrazleData>).data.category]),
    )
    expect(categoryByBand).toStrictEqual({ 2: 'Thing', 3: undefined, 5: undefined })
  })

  // The grid derives from `answer` through the splitter the guess goes through, so this proves
  // the generator's self-check from the outside.
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

// The ordering, held by a pool exactly big enough: eight phrases against eight demands, so one is
// contested and the contest is decided by array order alone. Unlike the surplus fixture above,
// this goes red on a reorder -- moving phrazleGenerator to the end empties Phrazle's band 5,
// because Missing Vowels takes any phrase here, ignores difficulty, and drains the long ones.
describe('the phrase generator ordering, over a pool that is exactly big enough', () => {
  const packDate = '2026-09-02'

  // Who can use each row -- the design of the fixture, and not readable off the strings. Missing
  // Vowels takes every row, so it is stated once here rather than per line.
  //
  //   Time flies like an arrow   20 letters, 5 words  -> Phrazle 5, Cryptogram 2-3
  //   Curiosity killed the cat   21 letters, 4 words  -> Phrazle 5, Cryptogram 3 (familiarity 2)
  //   Split second               11 letters, 2 words  -> Phrazle 2 only. Under Cryptogram's floor.
  //   Sandwich bar               11 letters, 2 words  -> Phrazle 2-3. Under Cryptogram's floor.
  //   Under the weather          15 letters, 3 words  -> Phrazle 2, Cryptogram 2-3
  //   Elephant ear               11 letters, 2 words  -> Phrazle 2 only. Under Cryptogram's floor.
  //   Knock your socks off       17 letters, 4 words  -> Phrazle 2-3, Cryptogram 2-3
  //   Hospital bed               11 letters, 2 words  -> Phrazle 2-3. Under Cryptogram's floor.
  //
  // What actually gets allocated, since bestFitIndex's keys are not readable off the table:
  // Phrazle takes SPLIT SECOND at 2 (breadth 1), SANDWICH BAR at 3 and TIME FLIES at 5;
  // Cryptogram then takes UNDER THE WEATHER at 2 and CURIOSITY at 3 -- the declared-breadth
  // tiebreak, since CURIOSITY fits only band 3. Missing Vowels takes the last three.
  const tightPool: Phrase[] = (
    [
      ['Time flies like an arrow', 3, 'idiom'],
      ['Curiosity killed the cat', 2, 'idiom'],
      // Before the other compacts: these tie on both breadth keys, so bestFitIndex falls through
      // to pool order and UNDER THE WEATHER first spends Cryptogram's only band-2 phrase.
      ['Split second', 4, 'compact'],
      ['Sandwich bar', 3, 'idiom'],
      ['Under the weather', 3, 'idiom'],
      ['Elephant ear', 3, 'idiom'],
      ['Knock your socks off', 3, 'idiom'],
      ['Hospital bed', 3, 'idiom'],
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

    expect(bandsOf('cryptogram')).toStrictEqual([2, 3])
    expect(bandsOf('phrazle')).toStrictEqual([2, 3, 5])
    expect(bandsOf('missingvowels')).toStrictEqual([1, 2, 4])
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)
    expect(new Set(answers).size).toEqual(8)
  })
})
