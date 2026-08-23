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
  // The last two rows are added by this branch and go unused until Phrazle lands. They clear
  // Phrazle's STRUCTURAL floor (2-3 words, 3-7 letters each, <=18 letters total, at least one shared
  // letter); no derived-difficulty claim is made for Phrazle, whose formula does not exist in this
  // repo yet. They are here rather than on Phrazle's branch because THIS branch creates the
  // collision: moving Cryptogram to [3, 4] lets it take both of the fixture's existing
  // Phrazle-eligible phrases -- Bite the bullet and The Great Gatsby, which derive to 3 -- before
  // Phrazle sees them, and a shared fixture handed to its next consumer without the phrases that
  // consumer needs makes the fixture indistinguishable from a bug in the code.
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
