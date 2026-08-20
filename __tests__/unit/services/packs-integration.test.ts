import { addPhrasePuzzles, createPack } from '@services/packs'
import { Phrase, Puzzle } from '@types'

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

describe('createPack with the real registry', () => {
  const packDate = '2026-06-15'
  // Fixed seeds, not a fresh draw per run. Every difficulty band is reachable from ~99% of banks so
  // any seed builds a full pack; pinning them means this suite covers a spread of real draws
  // without covering a different spread tomorrow.
  const seeds = [7, 11, 23, 41, 97]

  // Long enough that every one clears the six-consonant minimum, and more than a pack needs.
  const phrases: Phrase[] = [
    'The Empire Strikes Back',
    'Raiders of the Lost Ark',
    'Time flies like an arrow',
    'To be or not to be',
    'Pride and Prejudice',
    'Bite the bullet',
    'A stitch in time',
    'The Great Gatsby',
  ].map((text, index) => ({
    category: 'Thing',
    familiarity: 3 as const,
    hints: [`A narrower thing ${index}`, `Where you meet thing ${index}`, `Almost naming thing ${index}`] as [
      string,
      string,
      string,
    ],
    shape: index % 2 === 0 ? ('title' as const) : ('idiom' as const),
    text,
  }))

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
    // Five goFigure plus four Missing Vowels, per the launch distribution.
    expect(pack.puzzles).toHaveLength(9)
  })

  it('stores the ids the generator produced rather than re-deriving them', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    // That the suffix is opaque and carries no position is generate()'s contract, proven against an
    // injected shortId in generator.test.ts. What only this suite can prove is that createPack
    // passes those ids through untouched instead of stamping a slot number on them.
    expect(pack.puzzles.map((puzzle) => puzzle.id)).toEqual([
      `${packDate}:gofigure:abc12300`,
      `${packDate}:gofigure:abc12301`,
      `${packDate}:gofigure:abc12302`,
      `${packDate}:gofigure:abc12303`,
      `${packDate}:gofigure:abc12304`,
      `${packDate}:missingvowels:abc12305`,
      `${packDate}:missingvowels:abc12306`,
      `${packDate}:missingvowels:abc12307`,
      `${packDate}:missingvowels:abc12308`,
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
    expect(difficultiesFor('gofigure')).toEqual([1, 2, 3, 4, 5])
    expect(difficultiesFor('missingvowels')).toEqual([1, 2, 3, 4])
  })

  // The used-id set is what stops one pack shipping the same phrase twice, and it is only
  // observable through a full pack build.
  it.each(seeds)('never repeats a phrase within a pack from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()
    const answers = pack.puzzles
      .filter((puzzle) => puzzle.type === 'missingvowels')
      .map((puzzle) => (puzzle as Puzzle<{ answer: string }>).data.answer)

    expect(new Set(answers).size).toEqual(answers.length)
  })

  // Every letter the player needs, and nothing else. A displayed string that lost or gained a
  // consonant is unsolvable rather than hard.
  it.each(seeds)('displays exactly the answer consonants from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    const broken = pack.puzzles
      .filter((puzzle) => puzzle.type === 'missingvowels')
      .map((puzzle) => (puzzle as Puzzle<{ answer: string; displayed: string }>).data)
      .filter(
        ({ answer, displayed }) =>
          displayed.replace(/ /g, '') !==
          answer
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .replace(/[AEIOU]/g, ''),
      )

    expect(broken).toEqual([])
  })

  it.each(seeds)('emits only positive goals from seed %i', async (seed) => {
    setup(seed)

    const pack = await createPack(packDate)
    const goals = pack.puzzles
      .filter((puzzle) => puzzle.type === 'gofigure')
      .map((puzzle) => (puzzle as Puzzle<{ goal: number }>).data.goal)

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

    const mismatched = pack.puzzles
      .filter((puzzle) => puzzle.type === 'gofigure')
      .flatMap((puzzle) => {
        const { acceptedSolutions, goal } = (puzzle as Puzzle<{ acceptedSolutions: string[]; goal: number }>).data
        return acceptedSolutions.filter((expression) => evaluate(expression) !== goal)
      })

    expect(mismatched).toEqual([])
  })
})
