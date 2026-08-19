import { goFigurePuzzle, pack, packDate } from '../__mocks__'
import eventJson from '@events/get-pack-by-date.json'
import { getPackByDateHandler } from '@handlers/get-pack-by-date'
import { APIGatewayProxyEventV2, Pack } from '@types'
import status from '@utils/status'

const mockFillPack = jest.fn()
jest.mock('@services/packs', () => ({
  fillPack: (...args: unknown[]) => mockFillPack(...args),
}))

jest.mock('@utils/logging')

describe('get-pack-by-date', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockFillPack.mockResolvedValue(pack)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getPackByDateHandler', () => {
    it('returns the pack for a valid date', async () => {
      const result = await getPackByDateHandler(event)

      expect(mockFillPack).toHaveBeenCalledWith(packDate)
      expect(result).toEqual({ ...status.OK, body: JSON.stringify(pack) })
    })

    // The repair path: a date with nothing stored is filled during the request rather than
    // answered with a 404. The fixture MUST differ from the shared `pack` mock, which is already
    // complete -- `{ ...pack, complete: true }` would be byte-identical to the default
    // mockResolvedValue and the test would pass without proving anything.
    it('returns the freshly filled pack for a date that had nothing', async () => {
      const filled: Pack = {
        complete: true,
        date: packDate,
        puzzles: [goFigurePuzzle, { ...goFigurePuzzle, difficulty: 2, id: `${packDate}:gofigure:filled02` }],
      }
      mockFillPack.mockResolvedValueOnce(filled)

      const result = await getPackByDateHandler(event)

      expect(result).toEqual({ ...status.OK, body: JSON.stringify(filled) })
      expect(JSON.stringify(filled)).not.toEqual(JSON.stringify(pack))
    })

    // An incomplete pack that still holds puzzles is served, not withheld. Withholding it is the
    // "one flaky generation kills a day that had five good goFigures in it" outcome.
    it('returns 200 for an incomplete pack that still holds puzzles', async () => {
      const partial: Pack = { ...pack, complete: false }
      mockFillPack.mockResolvedValueOnce(partial)

      const result = await getPackByDateHandler(event)

      expect(result).toEqual({ ...status.OK, body: JSON.stringify(partial) })
    })

    it('returns 404 only when the fill produced no puzzles', async () => {
      mockFillPack.mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [] })

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

      expect(mockFillPack).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('returns 400 when no date is supplied', async () => {
      const result = await getPackByDateHandler({ ...event, pathParameters: undefined } as APIGatewayProxyEventV2)

      expect(mockFillPack).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('returns 500 when the fill fails', async () => {
      mockFillPack.mockRejectedValueOnce(new Error('DynamoDB is down'))

      const result = await getPackByDateHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
