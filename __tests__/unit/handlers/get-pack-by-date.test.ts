import { goFigurePuzzle, pack, packDate } from '../__mocks__'
import eventJson from '@events/get-pack-by-date.json'
import { getPackByDateHandler } from '@handlers/get-pack-by-date'
import { APIGatewayProxyEventV2, Pack } from '@types'
import status from '@utils/status'

const mockFillPack = jest.fn()
const mockHasWorkRemaining = jest.fn()
jest.mock('@services/packs', () => ({
  fillPack: (...args: unknown[]) => mockFillPack(...args),
  hasWorkRemaining: (...args: unknown[]) => mockHasWorkRemaining(...args),
}))

const mockClaimPackGeneration = jest.fn()
jest.mock('@services/dynamodb', () => ({
  claimPackGeneration: (...args: unknown[]) => mockClaimPackGeneration(...args),
}))

const mockInvokeSlowGenerators = jest.fn()
jest.mock('@services/lambda', () => ({
  invokeSlowGenerators: (...args: unknown[]) => mockInvokeSlowGenerators(...args),
}))

jest.mock('@utils/logging')

describe('get-pack-by-date', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockFillPack.mockResolvedValue(pack)
    mockHasWorkRemaining.mockReturnValue(false)
    mockClaimPackGeneration.mockResolvedValue(true)
    mockInvokeSlowGenerators.mockResolvedValue(undefined)
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
        puzzles: [goFigurePuzzle, { ...goFigurePuzzle, difficulty: 3, id: `${packDate}:gofigure:filled03` }],
      }
      mockFillPack.mockResolvedValueOnce(filled)

      const result = await getPackByDateHandler(event)

      expect(result).toEqual({ ...status.OK, body: JSON.stringify(filled) })
      expect(JSON.stringify(filled)).not.toEqual(JSON.stringify(pack))
    })

    // An incomplete pack that still holds puzzles is served, not withheld. Withholding it is the
    // "one flaky generation kills a day that had three good goFigures in it" outcome.
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

  describe('finishing an incomplete pack out of band', () => {
    const incomplete: Pack = { ...pack, complete: false }

    // A short pack that the builder can still do something about. Both halves are set, because they
    // are separate questions: `complete` is what the RESPONSE carries and hasWorkRemaining is what
    // gates the hand-off, and every case below turns on the second.
    const setupUnfinished = (): void => {
      mockFillPack.mockResolvedValueOnce(incomplete)
      mockHasWorkRemaining.mockReturnValueOnce(true)
    }

    // fillPack runs only the generators graded fast enough for a request. Anything they cannot
    // supply -- today a corpus that does not exist yet, later any inRequest: false type -- is
    // finished by the full builder rather than waiting for the next 03:33 UTC run.
    it('asks the slow generators for the rest when the pack is incomplete', async () => {
      setupUnfinished()

      await getPackByDateHandler(event)

      expect(mockInvokeSlowGenerators).toHaveBeenCalledWith(packDate)
    })

    // NOT `complete`, which skips a best-effort contribution by design. Gating the hand-off on the
    // flag means a pack short of only a best-effort type never reaches a builder at all: it ships
    // zero puzzles of that type, on every date, and no request or retry can repair it.
    it('asks for a complete pack that still has something worth attempting', async () => {
      mockHasWorkRemaining.mockReturnValueOnce(true)

      await getPackByDateHandler(event)

      expect(mockInvokeSlowGenerators).toHaveBeenCalledWith(packDate)
    })

    // The VALIDATED path parameter, never the date on the returned pack, and the puzzles the pack
    // actually holds -- the same question the response was built from.
    it('asks about the date it validated and the puzzles that pack holds', async () => {
      await getPackByDateHandler(event)

      expect(mockHasWorkRemaining).toHaveBeenCalledWith(packDate, pack.puzzles)
    })

    it('does not ask for a pack that is already complete', async () => {
      await getPackByDateHandler(event)

      expect(mockClaimPackGeneration).not.toHaveBeenCalled()
      expect(mockInvokeSlowGenerators).not.toHaveBeenCalled()
    })

    // The claim is what keeps this a repair path rather than an invoke storm. A pack that cannot be
    // completed is requested again on every app open, and usePrefetch walks up to eight dates each
    // time -- so without it the invoke rate against a job that keeps failing is unbounded.
    it('does not invoke when a build is already in flight', async () => {
      setupUnfinished()
      mockClaimPackGeneration.mockResolvedValueOnce(false)

      await getPackByDateHandler(event)

      expect(mockInvokeSlowGenerators).not.toHaveBeenCalled()
    })

    it('claims before invoking, never after', async () => {
      setupUnfinished()

      await getPackByDateHandler(event)

      expect(mockClaimPackGeneration.mock.invocationCallOrder[0]).toBeLessThan(
        mockInvokeSlowGenerators.mock.invocationCallOrder[0],
      )
    })

    // The pack is already built and written by this point, so the player gets what is playable now.
    // Completing it is an improvement, not a precondition.
    it('still serves the partial pack when the claim itself fails', async () => {
      setupUnfinished()
      mockClaimPackGeneration.mockRejectedValueOnce(new Error('table on fire'))

      const result = await getPackByDateHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body as string)).toEqual(incomplete)
    })

    // A 404 means nothing could be generated at all. There is no pack item to stamp a claim on, and
    // claimPackGeneration deliberately refuses to create one.
    it('does not invoke for a date with no pack at all', async () => {
      mockFillPack.mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [] })

      await getPackByDateHandler(event)

      expect(mockInvokeSlowGenerators).not.toHaveBeenCalled()
    })
  })
})
