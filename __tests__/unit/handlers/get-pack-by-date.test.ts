import { pack, packDate } from '../__mocks__'
import eventJson from '@events/get-pack-by-date.json'
import { getPackByDateHandler } from '@handlers/get-pack-by-date'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

const mockGetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
}))

jest.mock('@utils/logging')

describe('get-pack-by-date', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockGetPackByDate.mockResolvedValue(pack)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getPackByDateHandler', () => {
    it('returns the pack for a valid date', async () => {
      const result = await getPackByDateHandler(event)

      expect(mockGetPackByDate).toHaveBeenCalledWith(packDate)
      expect(result).toEqual({ ...status.OK, body: JSON.stringify(pack) })
    })

    it('returns 404 when the date has no pack', async () => {
      mockGetPackByDate.mockResolvedValueOnce(undefined)

      const result = await getPackByDateHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it.each([
      ['an invalid date', 'fnord'],
      ['an impossible date', '2026-02-30'],
      ['a date before the start date', '2025-12-31'],
      ['a date past tomorrow', '2026-06-17'],
    ])('returns 400 for %s without touching the table', async (_description, date) => {
      const result = await getPackByDateHandler({
        ...event,
        pathParameters: { date },
      } as unknown as APIGatewayProxyEventV2)

      expect(mockGetPackByDate).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('returns 400 when no date is supplied', async () => {
      const result = await getPackByDateHandler({ ...event, pathParameters: undefined } as APIGatewayProxyEventV2)

      expect(mockGetPackByDate).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('returns 500 when the table read fails', async () => {
      mockGetPackByDate.mockRejectedValueOnce(new Error('DynamoDB is down'))

      const result = await getPackByDateHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
