import { pack } from '../__mocks__'
import { createPackHandler } from '@handlers/create-pack'
import { invokeSlowGenerators } from '@services/lambda'
import { ScheduledEvent } from '@types'
import { logError } from '@utils/logging'

const mockGetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
}))

const mockCreatePack = jest.fn()
const mockHasWorkRemaining = jest.fn()
jest.mock('@services/packs', () => ({
  createPack: (...args: unknown[]) => mockCreatePack(...args),
  hasWorkRemaining: (...args: unknown[]) => mockHasWorkRemaining(...args),
}))

jest.mock('@services/lambda')
jest.mock('@utils/logging')

describe('create-pack', () => {
  const scheduledEvent = { 'detail-type': 'Scheduled Event' } as unknown as ScheduledEvent

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockCreatePack.mockResolvedValue({ ...pack, complete: true })
    mockHasWorkRemaining.mockReturnValue(false)
    jest.mocked(invokeSlowGenerators).mockResolvedValue(undefined)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('createPackHandler', () => {
    it("targets tomorrow's pack on the nightly schedule", async () => {
      await createPackHandler(scheduledEvent)

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-16')
    })

    // The 05:33 retry schedule and its `retryToday: true` input are gone, and with them the only
    // path that ever produced more than one date from one invocation. A run targets exactly one day.
    it('targets exactly one date per invocation', async () => {
      await createPackHandler(scheduledEvent)

      expect(mockCreatePack).toHaveBeenCalledTimes(1)
    })

    it('ignores a leftover retryToday input rather than reviving the two-date path', async () => {
      await createPackHandler({ retryToday: true } as unknown as ScheduledEvent)

      expect(mockCreatePack).toHaveBeenCalledTimes(1)
      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-16')
    })

    it('targets an explicit date, including one in the past', async () => {
      await createPackHandler({ date: '2026-03-09' })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-03-09')
    })

    it.each([
      ['a non-date string', 'fnord'],
      ['an impossible date', '2026-02-30'],
      ['a key-injection attempt', '2026-06-15 OR 1=1'],
    ])('refuses %s rather than putting it in a DynamoDB key', async (_description, date) => {
      await createPackHandler({ date })

      expect(mockCreatePack).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith('Invalid pack date, refusing to generate', { date })
    })

    // The handler does not pre-read a `complete` flag to decide whether to skip. That flag is frozen
    // at write time from the registry of the deploy that wrote it, so the day a second type ships it
    // would make a top-up run skip a pack that is now short. createPack owns the decision: it
    // recomputes what is missing from the live registry and no-ops when nothing is.
    it('always asks createPack, and lets it decide whether anything is missing', async () => {
      await createPackHandler({ date: '2026-06-15' })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-15')
    })

    // A throw is swallowed rather than escaping the handler: template.yaml sets
    // MaximumRetryAttempts to 0, so a function error re-runs nothing and only loses the ERROR line.
    it('does not throw out of the handler when pack creation fails', async () => {
      mockCreatePack.mockRejectedValueOnce(new Error('bedrock is sulking'))

      await expect(createPackHandler(scheduledEvent)).resolves.toBeUndefined()
    })

    it('logs at ERROR when pack creation fails, because the log subscription filters on it', async () => {
      const error = new Error('DynamoDB is down')
      mockCreatePack.mockRejectedValueOnce(error)

      await createPackHandler(scheduledEvent)

      expect(logError).toHaveBeenCalledWith('Pack creation failed', { date: '2026-06-16', error })
    })

    // An incomplete pack here is the EXPECTED intermediate state, not a fault: the self-contained
    // puzzles are built and what remains needs a model call. So this hands off rather than raising
    // an alarm -- each async builder reports its own types after it runs, and raises an ERROR only
    // for a required type that produced NOTHING.
    it('hands off to the slow generators rather than raising an alarm', async () => {
      mockCreatePack.mockResolvedValueOnce({ ...pack, complete: false })
      mockHasWorkRemaining.mockReturnValueOnce(true)

      await createPackHandler(scheduledEvent)

      expect(invokeSlowGenerators).toHaveBeenCalledWith('2026-06-16')
      expect(logError).not.toHaveBeenCalled()
    })

    it('does not hand off a pack that is already complete', async () => {
      await createPackHandler(scheduledEvent)

      expect(invokeSlowGenerators).not.toHaveBeenCalled()
    })

    // NOT `complete`, and this is the whole reason the two questions are separate. A best-effort
    // type is skipped by the completeness flag by design, so a pack short of only that type reads
    // complete: true -- and gating the hand-off on the flag means no builder is ever invoked for it.
    // It would ship zero puzzles of that type and this retry, which exists to repair a short day,
    // could never reach it.
    it('hands off a complete pack that still has something worth attempting', async () => {
      mockHasWorkRemaining.mockReturnValueOnce(true)

      await createPackHandler(scheduledEvent)

      expect(invokeSlowGenerators).toHaveBeenCalledWith('2026-06-16')
    })

    // The date the run TARGETS, never the one on the returned pack, and the puzzles it actually
    // holds. A pack read back from a lost race carries its own date; grading against that would ask
    // the question about a different day.
    it('asks about the date it targeted and the puzzles that pack holds', async () => {
      await createPackHandler(scheduledEvent)

      expect(mockHasWorkRemaining).toHaveBeenCalledWith('2026-06-16', pack.puzzles)
    })
  })
})
