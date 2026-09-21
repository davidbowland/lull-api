import { fillPack } from '@services/packs'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'

const mockFastGenerate = jest.fn()
const mockSlowGenerate = jest.fn()
// Two types with different inRequest grades, which is the point of the file: fillPack must run
// one and skip the other, and must still judge completeness against both. Their difficulty sets
// are disjoint ([1, 2, 3] against [4]) so missingDifficulties' `puzzle.type === generator.type`
// filter is exercised. availableFrom must be at or BEFORE packDate, or nothing applies and the
// suite goes green asserting nothing.
jest.mock('@generators/index', () => ({
  allContributions: [
    {
      availableFrom: '2026-06-01',
      countPerDay: 3,
      difficulties: [1, 2, 3],
      generate: (...args: unknown[]) => mockFastGenerate(...args),
      inRequest: true,
      type: 'gofigure',
    },
    {
      availableFrom: '2026-06-01',
      countPerDay: 1,
      difficulties: [4],
      generate: (...args: unknown[]) => mockSlowGenerate(...args),
      inRequest: false,
      type: 'cryptogram',
    },
  ],
  phraseGenerators: [],
  selfContainedGenerators: [
    {
      availableFrom: '2026-06-01',
      countPerDay: 3,
      difficulties: [1, 2, 3],
      generate: (...args: unknown[]) => mockFastGenerate(...args),
      inRequest: true,
      type: 'gofigure',
    },
    {
      availableFrom: '2026-06-01',
      countPerDay: 1,
      difficulties: [4],
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

const mockLog = jest.fn()
const mockLogError = jest.fn()
jest.mock('@utils/logging', () => ({
  log: (...args: unknown[]) => mockLog(...args),
  logError: (...args: unknown[]) => mockLogError(...args),
}))

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

  // The filter selects who GENERATES; completeness still asks whether every registered type has
  // its countPerDay, or a half-run fill marks the day done and the client stops refetching.
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

  // Difficulties present are counted per TYPE: without that filter a stored cryptogram at
  // difficulty 2 counts as goFigure's and the day is served one goFigure short.
  it('generates a difficulty a stored puzzle of another type already occupies', async () => {
    const existing: Pack = { complete: false, date: packDate, puzzles: [slowPuzzle(2)] }
    mockGetPackByDate.mockResolvedValueOnce(existing)

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 2)
    expect(result.puzzles).toEqual([slowPuzzle(2), fastPuzzle(1), fastPuzzle(2), fastPuzzle(3)])
  })

  // These two together pin ON_DEMAND_BUDGET_MS to exactly 10_000 and the comparison to >=; one
  // alone only bounds it on a side. The clock is injected and nothing moves it but the test.
  it('still starts a generate call at 9,999ms elapsed', async () => {
    let clock = 0
    const now = () => clock
    mockFastGenerate.mockImplementationOnce((_date, difficulty) => {
      clock = 9_999
      return Promise.resolve(fastPuzzle(difficulty))
    })

    const result = await fillPack(packDate, now)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(result.puzzles).toHaveLength(3)
  })

  it('starts no further generate call at 10,000ms elapsed', async () => {
    let clock = 0
    const now = () => clock
    mockFastGenerate.mockImplementationOnce((_date, difficulty) => {
      clock = 10_000
      return Promise.resolve(fastPuzzle(difficulty))
    })

    const result = await fillPack(packDate, now)

    expect(mockFastGenerate).toHaveBeenCalledTimes(1)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 1)
    expect(result.puzzles).toHaveLength(1)
  })

  // A spent budget owes the log which types went unattempted. This pins the message and payload,
  // not the loop's exit: with one inRequest generator, break and continue emit the same line.
  it('names the generators it skipped once the budget is spent', async () => {
    let clock = 0
    const now = () => clock
    // The stored-pack read sits between the start stamp and the loop's first check, so the budget
    // is already spent when the loop opens and no generator gets a turn.
    mockGetPackByDate.mockImplementationOnce(() => {
      clock = 10_000
      return Promise.resolve(undefined)
    })

    const result = await fillPack(packDate, now)

    expect(mockFastGenerate).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith('Fill budget spent, skipping the remaining generators', {
      date: packDate,
      skipped: ['gofigure'],
    })
    expect(result.puzzles).toEqual([])
  })

  it('writes what it generated', async () => {
    await fillPack(packDate)

    expect(mockSetPackByDate).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ complete: false, date: packDate }),
      0,
    )
  })

  // setPackByDate turns ONLY a conditional-check failure into false; everything else throws, and
  // uncaught that turns a date answerable from its stored pack into a 500 purely because the
  // request path writes. IAM drift is the realistic cause of an AccessDeniedException.
  it('returns the stored partial pack when the write fails for a reason other than the race', async () => {
    mockGetPackByDate.mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [fastPuzzle(1)] })
    mockSetPackByDate.mockRejectedValueOnce(new Error('AccessDeniedException'))

    const result = await fillPack(packDate)

    expect(result).toEqual({ complete: false, date: packDate, puzzles: [fastPuzzle(1)] })
    expect(mockLogError).toHaveBeenCalledWith(
      'Could not write the pack, falling back to what is already stored',
      expect.objectContaining({ date: packDate }),
    )
  })

  // Returning the in-memory pack would also avoid the 500, while handing back ids that reached no
  // table. The generate-count assertion stops this passing vacuously.
  it('does not serve the ids it generated but could not persist', async () => {
    mockGetPackByDate.mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [fastPuzzle(1)] })
    mockSetPackByDate.mockRejectedValueOnce(new Error('AccessDeniedException'))

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(2)
    expect(result.puzzles.map((puzzle) => puzzle.id)).toEqual([fastPuzzle(1).id])
  })

  // A cold date has nothing persisted, so the fallback collapses to an empty pack and a 404.
  it('returns an empty pack when the write fails on a date with nothing stored', async () => {
    mockSetPackByDate.mockRejectedValueOnce(new Error('AccessDeniedException'))

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ complete: false, date: packDate, puzzles: [] })
  })

  // Six rejections for three bands: every draw is retried once, so half of these are the retries.
  it('returns an empty pack without writing when nothing can be generated', async () => {
    mockFastGenerate.mockRejectedValueOnce(new Error('first'))
    mockFastGenerate.mockRejectedValueOnce(new Error('first retry'))
    mockFastGenerate.mockRejectedValueOnce(new Error('second'))
    mockFastGenerate.mockRejectedValueOnce(new Error('second retry'))
    mockFastGenerate.mockRejectedValueOnce(new Error('third'))
    mockFastGenerate.mockRejectedValueOnce(new Error('third retry'))

    const result = await fillPack(packDate)

    expect(result.puzzles).toEqual([])
    expect(mockSetPackByDate).not.toHaveBeenCalled()
  })

  // The retry is inside the budget, unlike the nightly path, because a client is waiting. The
  // failing draw burns the whole budget here, so the retry is refused.
  it('spends no retry on the request path once the budget is gone', async () => {
    let clock = 0
    const now = () => clock
    mockFastGenerate.mockImplementationOnce(() => {
      clock = 10_000
      return Promise.reject(new Error('bad draw'))
    })

    const result = await fillPack(packDate, now)

    expect(mockFastGenerate).toHaveBeenCalledTimes(1)
    expect(result.puzzles).toEqual([])
  })

  // The other side: without this the case above passes for a version that never retries at all.
  it('spends the retry on the request path while the budget holds', async () => {
    mockFastGenerate.mockRejectedValueOnce(new Error('bad draw'))

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(4)
    expect(result.puzzles.map((puzzle) => puzzle.id)).toEqual([fastPuzzle(1).id, fastPuzzle(2).id, fastPuzzle(3).id])
  })
})
