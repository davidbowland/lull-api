import { addPhrasePuzzles, createPack } from '@services/packs'
import { Familiarity, Phrase, PhraseShape, Puzzle } from '@types'

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

  // Twelve, not eight, and spanning familiarity 1-5 rather than sitting on the default. Cryptogram
  // takes three and Missing Vowels four, so eight all-familiarity-3 phrases left cryptogram with
  // zero slack -- one rejection and the pack came up short, which is a fixture that tests luck.
  //
  // Annotated with letters/unique and the difficulty each derives to, so a reader can check that
  // difficulties 2, 3 and 4 are all reachable without running anything.
  const phrases: Phrase[] = (
    [
      ['The Empire Strikes Back', 4, 'title'], //     20/12, repeats -> derives 1
      ['Raiders of the Lost Ark', 4, 'title'], //     19/12, repeats -> derives 1
      ['Time flies like an arrow', 3, 'idiom'], //    20/13, repeats -> derives 2
      ['To be or not to be', 5, 'quote'], //          13/6,  repeats -> derives 1 (clamped)
      ['Pride and Prejudice', 4, 'title'], //         17/10, repeats -> derives 1
      ['Bite the bullet', 3, 'idiom'], //             13/7,  repeats -> derives 2
      ['A stitch in time', 1, 'idiom'], //            13/9,  neither -> derives 5
      ['The Great Gatsby', 3, 'title'], //            14/9,  neither -> derives 3
      ['Gone with the Wind', 2, 'title'], //          15/9,  repeats -> derives 3
      ['Better late than never', 3, 'idiom'], //      19/9,  repeats -> derives 2
      ['The Old Man and the Sea', 3, 'title'], //     18/10, repeats -> derives 2
      ['Curiosity killed the cat', 2, 'idiom'], //    21/14, both    -> derives 4
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
    // Five goFigure, three Cryptogram and four Missing Vowels, per the launch distribution.
    expect(pack.puzzles).toHaveLength(12)
  })

  it('stores the ids the generator produced rather than re-deriving them', async () => {
    setup(seeds[0])

    const pack = await buildFullPack()

    // That the suffix is opaque and carries no position is generate()'s contract, proven against an
    // injected shortId in generator.test.ts. What only this suite can prove is that createPack
    // passes those ids through untouched instead of stamping a slot number on them.
    //
    // The ORDER is the second thing this pins. createPack spends 00-04 on goFigure, and
    // addPhrasePuzzles then walks phraseGenerators in registry order -- cryptogram before Missing
    // Vowels, which is load-bearing, since the two share one mutated pool and the permissive
    // generator picking first would leave the restrictive one nothing it can use. randomBytes is
    // stubbed to a counter, so the tenth and eleventh suffixes are hex 0a and 0b.
    expect(pack.puzzles.map((puzzle) => puzzle.id)).toEqual([
      `${packDate}:gofigure:abc12300`,
      `${packDate}:gofigure:abc12301`,
      `${packDate}:gofigure:abc12302`,
      `${packDate}:gofigure:abc12303`,
      `${packDate}:gofigure:abc12304`,
      `${packDate}:cryptogram:abc12305`,
      `${packDate}:cryptogram:abc12306`,
      `${packDate}:cryptogram:abc12307`,
      `${packDate}:missingvowels:abc12308`,
      `${packDate}:missingvowels:abc12309`,
      `${packDate}:missingvowels:abc1230a`,
      `${packDate}:missingvowels:abc1230b`,
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
    // No difficulty 1 and no difficulty 5: a cryptogram with nothing pre-filled has a floor of
    // effort a "gentle" rating would misdescribe, and the catalog leaves the top band to Phrazle.
    expect(difficultiesFor('cryptogram')).toEqual([2, 3, 4])
    expect(difficultiesFor('missingvowels')).toEqual([1, 2, 3, 4])
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

    // Three cryptograms and four missing vowels, one phrase each.
    expect(answers).toHaveLength(7)
    expect(new Set(answers).size).toEqual(answers.length)
  })

  // Every letter substituted, every space kept, and no letter left standing on itself. A ciphertext
  // that lost a space is a different phrase; one with a fixed point hands the solver a free letter
  // on a board with nothing pre-filled.
  it.each(seeds)('enciphers every cryptogram without a fixed point from seed %i', async (seed) => {
    setup(seed)

    const pack = await buildFullPack()

    const broken = pack.puzzles
      .filter((puzzle) => puzzle.type === 'cryptogram')
      .map((puzzle) => (puzzle as Puzzle<{ answer: string; ciphertext: string }>).data)
      .filter(({ answer, ciphertext }) => {
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

    expect(broken).toEqual([])
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
