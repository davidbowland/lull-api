import eventJson from '@events/get-pack-dates.json'
import { getPackDatesHandler } from '@handlers/get-pack-dates'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

const mockGetPackDates = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackDates: (...args: unknown[]) => mockGetPackDates(...args),
}))

jest.mock('@utils/logging')

describe('get-pack-dates', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    mockGetPackDates.mockResolvedValue(['2026-06-15', '2026-06-14'])
  })

  describe('getPackDatesHandler', () => {
    it('returns the dates that actually have a pack', async () => {
      const result = await getPackDatesHandler(event)

      expect(result).toEqual({ ...status.OK, body: JSON.stringify({ dates: ['2026-06-15', '2026-06-14'] }) })
    })

    it('returns an empty list when no packs exist', async () => {
      mockGetPackDates.mockResolvedValueOnce([])

      const result = await getPackDatesHandler(event)

      expect(result).toEqual({ ...status.OK, body: JSON.stringify({ dates: [] }) })
    })

    it('returns 500 when the scan fails', async () => {
      mockGetPackDates.mockRejectedValueOnce(new Error('DynamoDB is down'))

      const result = await getPackDatesHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
