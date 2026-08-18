import { pack } from '../__mocks__'
import { createPackHandler } from '@handlers/create-pack'
import { ScheduledEvent } from '@types'
import { logError } from '@utils/logging'

const mockGetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
}))

const mockCreatePack = jest.fn()
jest.mock('@services/packs', () => ({
  createPack: (...args: unknown[]) => mockCreatePack(...args),
}))

jest.mock('@utils/logging')

describe('create-pack', () => {
  const scheduledEvent = { 'detail-type': 'Scheduled Event' } as unknown as ScheduledEvent

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockCreatePack.mockResolvedValue({ ...pack, complete: true })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('createPackHandler', () => {
    it("targets tomorrow's pack on the nightly schedule", async () => {
      await createPackHandler(scheduledEvent)

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-16')
    })

    it("targets today's pack when retryToday is set", async () => {
      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-15')
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

    // The handler no longer pre-reads a `complete` flag to decide whether to skip. That flag is
    // frozen at write time from the registry of the deploy that wrote it, so the day a second type
    // ships it would make the retry skip a pack that is now short. createPack owns the decision:
    // it recomputes what is missing from the live registry and no-ops when nothing is.
    it('always asks createPack, and lets it decide whether anything is missing', async () => {
      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-15')
    })

    // Tomorrow is the nightly's own target and so the likeliest to be short, and nothing else
    // revisits it before it becomes today -- by which point its own retry has already run.
    it('tops up both today and tomorrow on a retry', async () => {
      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-15')
      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-16')
    })

    it('keeps going with the second date when the first one throws', async () => {
      mockCreatePack.mockRejectedValueOnce(new Error('bedrock is sulking'))

      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).toHaveBeenCalledTimes(2)
      expect(logError).toHaveBeenCalledWith('Pack creation failed', expect.objectContaining({ date: '2026-06-15' }))
    })

    it('logs at ERROR when pack creation fails, because the log subscription filters on it', async () => {
      const error = new Error('DynamoDB is down')
      mockCreatePack.mockRejectedValueOnce(error)

      await createPackHandler(scheduledEvent)

      expect(logError).toHaveBeenCalledWith('Pack creation failed', { date: '2026-06-16', error })
    })

    it('logs at ERROR when the pack comes back incomplete', async () => {
      mockCreatePack.mockResolvedValueOnce({ ...pack, complete: false })

      await createPackHandler(scheduledEvent)

      expect(logError).toHaveBeenCalledWith('Pack is incomplete', { date: '2026-06-16', puzzles: 1 })
    })
  })
})
