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

    it('does not regenerate a complete pack', async () => {
      mockGetPackByDate.mockResolvedValueOnce({ ...pack, complete: true })

      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).not.toHaveBeenCalled()
    })

    it('regenerates an incomplete pack', async () => {
      mockGetPackByDate.mockResolvedValueOnce({ ...pack, complete: false })

      await createPackHandler({ retryToday: true })

      expect(mockCreatePack).toHaveBeenCalledWith('2026-06-15')
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
