import { fillPack } from '@services/packs'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'

const mockFastGenerate = jest.fn()
const mockSlowGenerate = jest.fn()
// Two types with different inRequest grades. This is the whole point of the file: fillPack must run
// one and skip the other, and must still judge completeness against both. PuzzleType is currently
// the single literal 'gofigure', so the second entry is cast -- tests are not type-checked, and a
// second real type is exactly what this guards against regressing when one lands.
//
// The two difficulty sets are disjoint on purpose ([1, 2, 3] against [4]). While the slow type
// declared [1] the union of every present difficulty happened to equal each type's own set in every
// case here, so missingDifficulties' `puzzle.type === generator.type` filter was a no-op across the
// whole suite and deleting it kept every test green.
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

  // The set of difficulties already present is per TYPE. Drop missingDifficulties'
  // `puzzle.type === generator.type` filter and the cryptogram the nightly run stored at difficulty
  // 2 counts as goFigure's difficulty 2: the fill skips it, the day is served one goFigure short,
  // and the only thing that would ever fix it is another type happening to fill the same slot.
  it('generates a difficulty a stored puzzle of another type already occupies', async () => {
    const existing: Pack = { complete: false, date: packDate, puzzles: [slowPuzzle(2)] }
    mockGetPackByDate.mockResolvedValueOnce(existing)

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(mockFastGenerate).toHaveBeenCalledWith(packDate, 2)
    expect(result.puzzles).toEqual([slowPuzzle(2), fastPuzzle(1), fastPuzzle(2), fastPuzzle(3)])
  })

  // These two cases pin ON_DEMAND_BUDGET_MS to exactly 10_000 and the comparison to >=, and it
  // takes both of them. The stepped clock they replaced (+6000 per read) only ever proved the
  // budget sat somewhere in (6000, 12000], so raising it to 12_000 -- three seconds of headroom
  // under a 15-second Lambda timeout, when the whole justification for the value is that the guard
  // fires before the runtime pre-empts it -- left the suite green. The clock is settable and
  // nothing moves it but the test.
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

  // What a spent budget owes the log is which types went unattempted -- an absence of puzzles does
  // not say it, and by then no generator will run to say it either. This pins the message and its
  // payload, not the loop's exit: with one inRequest generator in this fixture, break and continue
  // emit the same single line, and packs.ts says so where the break is.
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

  // setPackByDate turns ONLY a conditional-check failure into false; everything else throws. Before
  // the catch, that exception propagated out of buildPack to the handler's catch-all, so a date that
  // answered 200 from its stored pack answered 500 instead -- purely because the request path now
  // writes. AccessDeniedException is the realistic one: the write shipped one commit before the IAM
  // grant did, so an intermediate deploy, template drift, or a partial rollback makes every
  // cold-or-incomplete date a 500.
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

  // The other half, and it needs its own test: returning the in-memory pack would also avoid the
  // 500 while handing back puzzle ids that reached no table. A client caching them keys
  // lull:progress against ids no refetch can ever contain -- the invariant the lost-race path
  // already keeps. The generate-count assertion is what stops this passing vacuously.
  it('does not serve the ids it generated but could not persist', async () => {
    mockGetPackByDate.mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [fastPuzzle(1)] })
    mockSetPackByDate.mockRejectedValueOnce(new Error('AccessDeniedException'))

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(2)
    expect(result.puzzles.map((puzzle) => puzzle.id)).toEqual([fastPuzzle(1).id])
  })

  // A cold date has nothing persisted, so the fallback collapses to an empty pack and the handler
  // answers 404 -- the same answer it gave before on-demand fill existed, rather than a 500.
  it('returns an empty pack when the write fails on a date with nothing stored', async () => {
    mockSetPackByDate.mockRejectedValueOnce(new Error('AccessDeniedException'))

    const result = await fillPack(packDate)

    expect(mockFastGenerate).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ complete: false, date: packDate, puzzles: [] })
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
