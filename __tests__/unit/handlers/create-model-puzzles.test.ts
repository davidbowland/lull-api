import { createModelPuzzlesHandler } from '@handlers/create-model-puzzles'
import { getPackByDate, getRecentPacks } from '@services/dynamodb'
import { Candidate, Difficulty, Pack, Puzzle } from '@types'
import { log, logError } from '@utils/logging'

const mockFetchFirst = jest.fn()
const mockFetchSecond = jest.fn()
const mockAddModelPuzzles = jest.fn()
const mockCreatePack = jest.fn()

// The generators are built INSIDE the factory. jest.mock is hoisted above every declaration in the
// file and babel-plugin-jest-hoist admits an out-of-scope reference only for a `mock`-prefixed name
// or a const with a pure initializer -- so a `const first = generatorFor(...)` referenced from here
// fails the whole suite at transform. The fetch mocks are `mock`-prefixed, which is what lets the
// factory reach them.
//
// modelGenerators ships EMPTY on this branch, so the loop below is unreachable in production until a
// type registers. Mocking it is what gives the budget guard, the shortfall ERROR and the
// per-generator write a live guard from day one -- and it is the only thing exercising them.
//
// availableFrom is at or BEFORE this suite's packDate. A fixture dated after the date under test
// applies to nothing, missingDifficulties returns [] for every generator, and the whole suite goes
// green while asserting nothing.
jest.mock('@generators/model', () => ({
  modelGenerators: [
    {
      availableFrom: '2026-08-01',
      baseSeconds: 60,
      countPerDay: 2,
      difficulties: [2, 3],
      fetchCandidates: (...args: unknown[]) => mockFetchFirst(...args),
      secondsPerDifficulty: 15,
      type: 'themedanagrams',
    },
    {
      availableFrom: '2026-08-01',
      baseSeconds: 60,
      countPerDay: 2,
      difficulties: [2, 3],
      fetchCandidates: (...args: unknown[]) => mockFetchSecond(...args),
      secondsPerDifficulty: 15,
      type: 'crypticclue',
    },
  ],
}))

// PARTIAL, keeping the REAL missingDifficulties. It is a pure function of a contribution and the
// puzzles already stored, and it is what the "nothing missing for this type" row is actually about --
// automocking it would make that row assert only that the handler honours whatever a stub returned,
// and the pack fixture it names would never reach the branch it is named for.
jest.mock('@services/packs', () => ({
  ...jest.requireActual('@services/packs'),
  addModelPuzzles: (...args: unknown[]) => mockAddModelPuzzles(...args),
  createPack: (...args: unknown[]) => mockCreatePack(...args),
}))

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

const packDate = '2026-08-20'

const puzzleFor = (type: string, difficulty: Difficulty): Puzzle =>
  ({ data: {}, difficulty, estimatedSeconds: 60, id: `${packDate}:${type}:x`, type }) as unknown as Puzzle

const packOf = (...puzzles: Puzzle[]): Pack => ({ complete: false, date: packDate, puzzles })

const candidate = (usableAt: Difficulty[]): Candidate => ({ build: jest.fn(), usableAt })

describe('create-model-puzzles', () => {
  // A FIXED clock, injected, returning the given readings in order and holding the last one.
  // GENERATOR_BUDGET_MS is otherwise untestable without a real clock, and a fake-timer approach
  // would still be timing.
  const clockOf = (...readings: number[]): (() => number) => {
    let index = 0
    return () => readings[Math.min(index++, readings.length - 1)]
  }

  // A named setup() called explicitly. jest.config clears mocks between tests, so the shared
  // defaults are re-armed here rather than in a beforeEach.
  const setup = (): void => {
    mockCreatePack.mockResolvedValue(packOf())
    jest.mocked(getPackByDate).mockResolvedValue(packOf())
    jest.mocked(getRecentPacks).mockResolvedValue([])
    mockAddModelPuzzles.mockResolvedValue(packOf())
    mockFetchFirst.mockResolvedValue([candidate([2]), candidate([3])])
    mockFetchSecond.mockResolvedValue([candidate([2]), candidate([3])])
  }

  // An unvalidated event field reaching a DynamoDB key is an unbounded key, and this one names both
  // the pack to fill and the dates to read. Format only, not isValidPackDate: a manual replay
  // legitimately targets a date in the past.
  it.each([
    ['no date at all', undefined],
    ['a malformed date', 'not-a-date'],
    ['an impossible calendar date', '2026-02-30'],
  ])('refuses %s without touching the table', async (_description, date) => {
    setup()

    await createModelPuzzlesHandler({ date })

    expect(logError).toHaveBeenCalledWith('Invalid date, refusing to generate', { date })
    expect(getPackByDate).not.toHaveBeenCalled()
    expect(mockCreatePack).not.toHaveBeenCalled()
  })

  // The non-inRequest self-contained lane, which nothing else repairs, and the ONLY guard it has:
  // Phase 1 ships no inRequest: false self-contained generator at all, so this line has no occupant
  // and would otherwise rot.
  it('repairs the self-contained lane before any model work', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockCreatePack).toHaveBeenCalledWith(packDate)
    expect(mockCreatePack.mock.invocationCallOrder[0]).toBeLessThan(mockFetchFirst.mock.invocationCallOrder[0])
  })

  // Read AFTER the repair, so what the repair wrote counts.
  it('reads the pack after the repair, not before it', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockCreatePack.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(getPackByDate).mock.invocationCallOrder[0],
    )
  })

  it('does not abort the loop when the self-contained repair fails', async () => {
    setup()
    mockCreatePack.mockRejectedValueOnce(new Error('goFigure is on fire'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Could not repair the self-contained lane',
      expect.objectContaining({ date: packDate }),
    )
    expect(mockFetchFirst).toHaveBeenCalled()
  })

  it('treats a date with no stored pack as one holding no puzzles', async () => {
    setup()
    jest.mocked(getPackByDate).mockResolvedValueOnce(undefined as never)

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).toHaveBeenCalledWith(2, [])
  })

  // Missing difficulties are computed BEFORE the model call. With two builders behind one flag,
  // "the pack is incomplete" no longer means "your type is missing", so an invocation that fetches
  // first burns Opus tokens to add nothing.
  it('makes no model call when nothing is missing for a type', async () => {
    setup()
    jest
      .mocked(getPackByDate)
      .mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2), puzzleFor('themedanagrams', 3)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).not.toHaveBeenCalled()
    expect(mockFetchSecond).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Nothing missing for this type, skipping the model call', {
      date: packDate,
      type: 'themedanagrams',
    })
  })

  // ONE call per type per pack, never one per puzzle, asked for exactly what is missing and handed
  // the recent packs rather than a pre-flattened exclusion list.
  it('asks for as many candidates as the type is missing, once', async () => {
    setup()
    const recent = [packOf(puzzleFor('cryptogram', 2))]
    jest.mocked(getRecentPacks).mockResolvedValueOnce(recent)
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).toHaveBeenCalledTimes(1)
    expect(mockFetchFirst).toHaveBeenCalledWith(1, recent)
  })

  // The handler's ask is authoritative: `missing` is passed through to addModelPuzzles rather than
  // left to be re-derived against a later read.
  it('passes the missing set it computed through to the write', async () => {
    setup()
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledWith(packDate, expect.anything(), [3], expect.any(Array))
  })

  // buildPack's put is conditional on the count it read, so one write after 800 seconds is a single
  // condition a racing GET can invalidate, discarding every type's model output.
  it('writes once per generator rather than once at the end', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
  })

  it('does not let one failing type cost its neighbour', async () => {
    setup()
    mockFetchFirst.mockRejectedValueOnce(new Error('bedrock on fire'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Could not add puzzles for this type',
      expect.objectContaining({ date: packDate, type: 'themedanagrams' }),
    )
    expect(mockFetchSecond).toHaveBeenCalled()
  })

  // With several types in one invocation, "pack is still incomplete" no longer says which one
  // failed, and the level="ERROR" subscription filter is the only thing that alarms.
  it('raises a per-type ERROR when a type ends short', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith('Model type is still short after its call', {
      date: packDate,
      type: 'themedanagrams',
    })
  })

  // Counted against the type's OWN puzzles in the merged pack, so a neighbour's output cannot make a
  // short type look full.
  it('raises no ERROR for a type that ends full', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValue(
      packOf(
        puzzleFor('themedanagrams', 2),
        puzzleFor('themedanagrams', 3),
        puzzleFor('crypticclue', 2),
        puzzleFor('crypticclue', 3),
      ),
    )

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).not.toHaveBeenCalledWith('Model type is still short after its call', expect.anything())
  })

  it('counts only its own type towards the tally, never a neighbour', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValueOnce(
      packOf(puzzleFor('themedanagrams', 2), puzzleFor('crypticclue', 2), puzzleFor('crypticclue', 3)),
    )

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith('Model type is still short after its call', {
      date: packDate,
      type: 'themedanagrams',
    })
  })

  // A wall-clock budget on the LOOP, not per type. It bounds when the LAST call may START and it is
  // checked once per iteration against a single `start`.
  it('stops starting generators past the budget and names the ones it skipped', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate }, clockOf(0, 0, 600_001))

    expect(mockFetchFirst).toHaveBeenCalled()
    expect(mockFetchSecond).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['crypticclue'],
    })
  })

  // The budget cannot interrupt a call already in flight, and it must not fire a millisecond early:
  // one reading below the bound still starts its generator.
  it('starts a generator that is still inside the budget', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate }, clockOf(0, 0, 599_999))

    expect(mockFetchSecond).toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalledWith('Model budget spent, skipping the remaining types', expect.anything())
  })

  // The bound itself, bracketed. `>=` rather than `>` and nothing held it: 599_999 starts and
  // 600_001 does not, so a `>` survives both. This is the reading exactly on GENERATOR_BUDGET_MS,
  // which spends it -- the budget is a ceiling on when the last call may start, and a call starting
  // AT the ceiling has none of the 300 seconds the number was reserved to leave it.
  it('spends the budget on a reading exactly at the bound', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate }, clockOf(0, 0, 600_000))

    expect(mockFetchSecond).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['crypticclue'],
    })
  })

  // The budget guard sits AFTER the "nothing missing" skip. Before it, a slow night raised the one
  // ERROR this stack alarms on -- the level="ERROR" subscription filter is the only alarm there is --
  // naming types that had no work to do, which is a page for a pack that was already full.
  it('raises no budget ERROR over types that had nothing missing', async () => {
    setup()
    jest
      .mocked(getPackByDate)
      .mockResolvedValueOnce(
        packOf(
          puzzleFor('themedanagrams', 2),
          puzzleFor('themedanagrams', 3),
          puzzleFor('crypticclue', 2),
          puzzleFor('crypticclue', 3),
        ),
      )

    await createModelPuzzlesHandler({ date: packDate }, clockOf(0, 0, 600_001))

    expect(logError).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Nothing missing for this type, skipping the model call', {
      date: packDate,
      type: 'crypticclue',
    })
  })

  // Never rethrown. A retry re-runs EVERY type including the ones that succeeded; the 05:33 retry is
  // the retry, at the right granularity, because it re-reads what is missing.
  it('never throws out of the handler', async () => {
    setup()
    jest.mocked(getRecentPacks).mockRejectedValueOnce(new Error('dynamo on fire'))

    await expect(createModelPuzzlesHandler({ date: packDate })).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('Could not add model puzzles', expect.objectContaining({ date: packDate }))
  })
})
