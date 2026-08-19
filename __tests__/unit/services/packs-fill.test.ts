import { fillPack } from '@services/packs'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'

const mockFastGenerate = jest.fn()
const mockSlowGenerate = jest.fn()
// Two types with different inRequest grades. This is the whole point of the file: fillPack must run
// one and skip the other, and must still judge completeness against both. PuzzleType is currently
// the single literal 'gofigure', so the second entry is cast -- tests are not type-checked, and a
// second real type is exactly what this guards against regressing when one lands.
jest.mock('@generators/index', () => ({
  generators: [
    {
      countPerDay: 3,
      difficulties: [1, 2, 3],
      generate: (...args: unknown[]) => mockFastGenerate(...args),
      inRequest: true,
      type: 'gofigure',
    },
    {
      countPerDay: 1,
      difficulties: [1],
      generate: (...args: unknown[]) => mockSlowGenerate(...args),
      inRequest: false,
      type: 'cryptogram',
    },
  ],
}))

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const packDate = '2026-06-15'

const fastPuzzle = (difficulty: number): Puzzle => ({
  data: { goal: difficulty * 10 },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 60,
  id: `${packDate}:gofigure:short${difficulty}`,
  type: 'gofigure',
})

const slowPuzzle = (difficulty: number): Puzzle => ({
  data: { ciphertext: 'KVDX BZVXH' },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 180,
  id: `${packDate}:cryptogram:short${difficulty}`,
  type: 'cryptogram' as unknown as PuzzleType,
})

describe('fillPack', () => {
  beforeAll(() => {
    mockFastGenerate.mockImplementation((_date, difficulty) => Promise.resolve(fastPuzzle(difficulty)))
    mockSlowGenerate.mockImplementation((_date, difficulty) => Promise.resolve(slowPuzzle(difficulty)))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)
  })

  it('runs only the generators graded for a request', async () => {
    await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(mockSlowGenerate).not.toHaveBeenCalled()
  })

  // The filter selects who GENERATES. Completeness still asks whether every registered type has its
  // countPerDay, or a half-run fill would mark the day done and the client would stop refetching.
  it('does not mark the pack complete when a generator it skipped still owes puzzles', async () => {
    const result = await fillPack(packDate)

    expect(result.complete).toBe(false)
    expect(result.puzzles).toHaveLength(3)
  })

  it('tops up only what is missing and leaves the existing puzzles byte-identical', async () => {
    const existing: Pack = { complete: false, date: packDate, puzzles: [fastPuzzle(1)] }
    mockGetPackByDate.mockResolvedValueOnce(existing)

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(2)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 2)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 3)
    expect(JSON.stringify(result.puzzles[0])).toBe(JSON.stringify(fastPuzzle(1)))
    expect(mockSetPackByDate).toHaveBeenCalledWith(packDate, expect.anything(), 1)
  })

  it('stops starting generate calls once the budget is spent', async () => {
    let clock = 0
    const now = () => {
      clock += 6_000
      return clock
    }

    const result = await fillPack(packDate, now)

    // now() is read once for the start stamp, then once before each difficulty. The reading before
    // difficulty 2 is already 12s past the start, so only difficulty 1 is generated.
    expect(mockFastGenerate).toHaveBeenCalledTimes(1)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 1)
    expect(result.puzzles).toHaveLength(1)
  })

  it('writes what it generated', async () => {
    await fillPack(packDate)

    expect(mockSetPackByDate).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ complete: false, date: packDate }),
      0,
    )
  })

  it('returns an empty pack without writing when nothing can be generated', async () => {
    mockFastGenerate.mockRejectedValueOnce(new Error('first'))
    mockFastGenerate.mockRejectedValueOnce(new Error('second'))
    mockFastGenerate.mockRejectedValueOnce(new Error('third'))

    const result = await fillPack(packDate)

    expect(result.puzzles).toEqual([])
    expect(mockSetPackByDate).not.toHaveBeenCalled()
  })
})
