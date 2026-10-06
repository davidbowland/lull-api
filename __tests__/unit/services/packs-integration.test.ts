import { isValidGuess, splitPhrase } from '@rules/is-valid-guess'

import { getDictionary } from '@generators/phrazle/dictionary'
import { addPhrasePuzzles, createPack } from '@services/packs'
import { Phrase, PhraseShape, PhrazleData, Puzzle } from '@types'

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

// A deliberate surplus pool, so a fixture that tests luck cannot pass. Phrazle's band 3 takes a
// derived 2-4 and band 5 a derived 4-5; Missing Vowels takes anything with six consonants.
//
// Every word of every Phrazle-eligible row must be in __tests__/fixtures/v1.txt, which
// dictionary-asset.test.ts names -- a missing word rejects a fixture phrase silently.
const phrases: Phrase[] = (
  [
    ['The Empire Strikes Back', 'title'],
    ['Raiders of the Lost Ark', 'title'],
    ['Time flies like an arrow', 'idiom'],
    ['To be or not to be', 'quote'],
    ['Pride and Prejudice', 'title'],
    ['Bite the bullet', 'idiom'],
    ['A stitch in time', 'idiom'],
    ['The Great Gatsby', 'title'],
    ['Gone with the Wind', 'title'],
    ['Better late than never', 'idiom'],
    ['The Old Man and the Sea', 'title'],
    ['Curiosity killed the cat', 'idiom'],
    ['Brave New World', 'title'],
    ['Under the radar', 'idiom'],
    ['Toe hold', 'compact'],
    ['Split second', 'compact'],
    ['Deep end', 'compact'],
  ] as [string, PhraseShape][]
).map(([text, shape], index) => ({
  category: 'Thing',
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
    expect(pack.puzzles).toHaveLength(8)
  })

  it('stores the ids the generator produced rather than re-deriving them', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    // Ids pass through untouched rather than being stamped with a slot number, and the ORDER is
    // load-bearing: the phrase generators share one mutated pool. randomBytes is stubbed to a
    // counter, so the suffixes run 00 through 07 in build order.
    expect(pack.puzzles.map((puzzle) => puzzle.id)).toEqual([
      `${packDate}:gofigure:abc12300`,
      `${packDate}:gofigure:abc12301`,
      `${packDate}:gofigure:abc12302`,
      `${packDate}:phrazle:abc12303`,
      `${packDate}:phrazle:abc12304`,
      `${packDate}:missingvowels:abc12305`,
      `${packDate}:missingvowels:abc12306`,
      `${packDate}:missingvowels:abc12307`,
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
    expect(difficultiesFor('phrazle')).toEqual([3, 5])
    expect(difficultiesFor('missingvowels')).toEqual([1, 2, 3])
  })

  // The used-phrase set has to hold ACROSS types, since the generators draw from one pool.
  // Filtered on the presence of `answer`, as create-phrase-puzzles.ts builds its own list.
  it.each(seeds)('never repeats a phrase within a pack from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    expect(answers).toHaveLength(5)
    expect(new Set(answers).size).toEqual(answers.length)
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
    expect(pack.puzzles.filter((puzzle) => puzzle.type === 'phrazle')).toHaveLength(2)
    expect(difficultiesFor(pack, 'phrazle')).toStrictEqual([3, 5])
    // And the type it shares a pool with: filling Phrazle's bands by starving Missing Vowels fails.
    expect(difficultiesFor(pack, 'missingvowels')).toStrictEqual([1, 2, 3])
    expect(difficultiesFor(pack, 'gofigure')).toStrictEqual([2, 4, 5])
  })

  // `complete` is false because the model lane runs in a different handler, not because a band
  // came up short -- which the band assertions above distinguish.
  it('builds eight puzzles from the two lanes this path runs', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    expect(pack.puzzles).toHaveLength(8)
    expect(pack.complete).toEqual(false)
  })

  it.each(seeds)('never repeats a phrase across the phrase types from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)

    expect(answers).toHaveLength(5)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  it.each(seeds)('ships every Phrazle in canonical form and with no ladder from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const phrazles = pack.puzzles
      .filter((puzzle) => puzzle.type === 'phrazle')
      .map((puzzle) => (puzzle as Puzzle<PhrazleData>).data)

    expect(phrazles).toHaveLength(2)
    // Canonical: uppercase A-Z words separated by single spaces, which is what the board paints
    // and markGuess marks. Anything else is a board whose tiles do not match its own answer.
    expect(phrazles.filter(({ answer }) => !/^[A-Z]+( [A-Z]+)+$/.test(answer))).toStrictEqual([])
    // Two absences over the whole run, catching a field that creeps back onto only some bands.
    expect(phrazles.filter((data) => 'maxGuesses' in data)).toStrictEqual([])
    expect(phrazles.filter((data) => 'hints' in data)).toStrictEqual([])
    // Asserted by band, so a band that drops it is named.
    const categoryByBand = Object.fromEntries(
      pack.puzzles
        .filter((puzzle) => puzzle.type === 'phrazle')
        .map((puzzle) => [puzzle.difficulty, (puzzle as Puzzle<PhrazleData>).data.category]),
    )
    expect(categoryByBand).toStrictEqual({ 3: 'Thing', 5: 'Thing' })
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

// The ordering, held by a pool exactly big enough: five phrases against five demands, decided by
// array order alone. Unlike the surplus fixture above, this goes red on a reorder -- Missing Vowels
// takes any phrase here, ignores difficulty, and running first it spends Phrazle's only two in
// pool order.
describe('the phrase generator ordering, over a pool that is exactly big enough', () => {
  const packDate = '2026-09-02'

  // Who can use each row -- the design of the fixture, and not readable off the strings. Missing
  // Vowels takes every row, so it is stated once here rather than per line.
  //
  //   Time flies like an arrow   20 letters, 5 words  -> Phrazle 5 only
  //   Knock your socks off       17 letters, 4 words  -> Phrazle 3 only
  //   Split second               11 letters, 2 words  -> derives 1, below Phrazle's band 3
  //   Elephant ear               11 letters, 2 words  -> derives 1, below Phrazle's band 3
  //   Hospital bed               11 letters, 2 words  -> derives 1, below Phrazle's band 3
  const tightPool: Phrase[] = (
    [
      ['Time flies like an arrow', 'idiom'],
      ['Knock your socks off', 'idiom'],
      ['Split second', 'compact'],
      ['Elephant ear', 'idiom'],
      ['Hospital bed', 'idiom'],
    ] as [string, PhraseShape][]
  ).map(([text, shape], index) => ({
    category: 'Thing',
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

    expect(bandsOf('phrazle')).toStrictEqual([3, 5])
    expect(bandsOf('missingvowels')).toStrictEqual([1, 2, 3])
    const answers = pack.puzzles
      .map((puzzle) => (puzzle as Puzzle<{ answer?: string }>).data.answer)
      .filter((answer) => answer !== undefined)
    expect(new Set(answers).size).toEqual(5)
  })
})
