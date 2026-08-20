import { addPhrasePuzzles } from '@services/packs'
import { Difficulty, Phrase, Puzzle } from '@types'

const mockStrictGenerate = jest.fn()
const mockPermissiveGenerate = jest.fn()

// A phrase's TEXT is its derived difficulty, as a one-character string. Nothing here re-implements
// the real derivation -- this suite is about selection, and a fixture that had to be recomputed
// alongside difficulty.ts would break for reasons that have nothing to do with packs.ts.
const derivedOf = (phrase: Phrase): number => Number(phrase.text)

const TOLERANCE = 1

// Cryptogram's shape: three difficulties, a narrow band, and it must run FIRST. The permissive
// generator accepts anything, so running it first would leave this one whatever was left over.
const strict = {
  countPerDay: 3,
  difficulties: [2, 3, 4],
  generate: (...args: unknown[]) => mockStrictGenerate(...args),
  isUsablePhrase: (phrase: Phrase, difficulty: Difficulty) => Math.abs(derivedOf(phrase) - difficulty) <= TOLERANCE,
  type: 'cryptogram',
}
const permissive = {
  countPerDay: 2,
  difficulties: [1, 2],
  generate: (...args: unknown[]) => mockPermissiveGenerate(...args),
  isUsablePhrase: () => true,
  type: 'missingvowels',
}
jest.mock('@generators/index', () => ({
  allGenerators: [strict, permissive],
  phraseGenerators: [strict, permissive],
  selfContainedGenerators: [],
}))

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const packDate = '2026-06-15'

const phraseOf = (text: string): Phrase => ({
  category: 'Thing',
  familiarity: 3,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

const poolOf = (...texts: string[]): Phrase[] => texts.map(phraseOf)

const puzzleFrom =
  (type: string) =>
  (_date: string, difficulty: Difficulty, phrase: Phrase): Promise<Puzzle> =>
    Promise.resolve({
      data: { answer: phrase.text, hints: phrase.hints },
      difficulty,
      estimatedSeconds: 200,
      id: `${packDate}:${type}:${phrase.text}${difficulty}`,
      type: type as never,
    })

// What each generator was actually handed, in call order.
const handedTo = (mock: jest.Mock): [number, string][] =>
  mock.mock.calls.map((call) => [call[1] as number, (call[2] as Phrase).text])

describe('addPhrasePuzzles', () => {
  const setup = (): void => {
    mockStrictGenerate.mockImplementation(puzzleFrom('cryptogram'))
    mockPermissiveGenerate.mockImplementation(puzzleFrom('missingvowels'))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)
  }

  // Most-constrained-first, not first-fit. Under a +/-1 tolerance a derived-3 phrase is acceptable
  // to every declared difficulty, so first-fit lets whichever difficulty ran first drain them and
  // leaves difficulty 4 with only the rare extremes. Selection takes the phrase that FEWEST of this
  // generator's difficulties can use, so the scarce ones are spent where only they fit.
  it('spends each phrase on the difficulty that can least afford to lose it', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('3', '2', '4', '1', '5'))

    expect(handedTo(mockStrictGenerate)).toEqual([
      [2, '1'],
      [3, '2'],
      [4, '5'],
    ])
  })

  // Ties are broken by pool order and nothing else -- no re-sorting, no scanning backwards. Also
  // the inner break: difficulty 4 has nothing left it can use, and that ends this generator without
  // touching the next one.
  it('breaks a tie by pool order', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('4', '2', '2'))

    // Difficulty 2 cannot use the 4 at all, so it takes the first 2. Difficulty 3 then sees a 4 and
    // a 2, both usable by exactly two of [2, 3, 4], so the earlier one in the pool wins.
    expect(handedTo(mockStrictGenerate)).toEqual([
      [2, '2'],
      [3, '4'],
    ])
  })

  // THE regression this task exists for. packs.ts used to `return generated` when the pool ran dry,
  // which was harmless with one phrase generator and means ZERO cryptograms with two.
  it('keeps generating for later generators when the first one runs out', async () => {
    setup()

    // Derived 9: outside every band the strict generator declares, so it can place none of them.
    const pack = await addPhrasePuzzles(packDate, poolOf('9', '9', '9'))

    expect(mockStrictGenerate).not.toHaveBeenCalled()
    expect(handedTo(mockPermissiveGenerate)).toEqual([
      [1, '9'],
      [2, '9'],
    ])
    expect(pack.puzzles).toHaveLength(2)
  })

  it('keeps generating for later generators when the pool is empty', async () => {
    setup()

    const pack = await addPhrasePuzzles(packDate, [])

    expect(pack.puzzles).toEqual([])
  })

  // One phrase per puzzle, never reused within a pack -- which is what stops a single day shipping
  // the same answer twice across two types.
  it('never hands the same phrase to two generators', async () => {
    setup()

    const pack = await addPhrasePuzzles(packDate, poolOf('1', '2', '3', '4', '5'))

    const answers = pack.puzzles.map((puzzle) => (puzzle as Puzzle<{ answer: string }>).data.answer)
    expect(new Set(answers).size).toEqual(answers.length)
    expect(answers).toHaveLength(5)
  })

  // The catch is around each generate CALL. A phrase that cannot be turned into a puzzle costs that
  // puzzle and nothing else -- and the phrase is still spent, so the next difficulty does not
  // immediately retry the same failing input.
  it('loses only the failed puzzle when a generate call throws', async () => {
    setup()
    mockStrictGenerate.mockRejectedValueOnce(new Error('could not encipher'))

    const pack = await addPhrasePuzzles(packDate, poolOf('3', '2', '4', '1', '5'))

    expect(mockStrictGenerate).toHaveBeenCalledTimes(3)
    expect(pack.puzzles).toHaveLength(4)
  })
})
