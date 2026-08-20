import { packDate } from '../__mocks__'
import { invokeCreateCorpus, invokeCreatePack } from '@services/lambda'
import { logError } from '@utils/logging'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging')

describe('lambda', () => {
  describe('invokeCreateCorpus', () => {
    // InvocationType 'Event' is what makes this fire-and-forget: Lambda queues the payload and
    // returns immediately, so the response a player is waiting on never blocks on a model call.
    //
    // ifMissing distinguishes this from the nightly run, which makes a fresh corpus on purpose. On
    // demand an existing corpus of any age is enough, because the consumers already fall back to
    // the most recent one.
    it('queues a corpus request without waiting for the result', async () => {
      mockSend.mockResolvedValueOnce({})

      await invokeCreateCorpus(packDate)

      expect(mockSend).toHaveBeenCalledWith({
        FunctionName: 'create-corpus-function',
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify({ date: packDate, ifMissing: true })),
      })
    })

    // The pack is already built and written by the time this runs, so a failed invoke must not
    // turn a request about to answer 200 with a playable partial pack into a 500.
    it('logs and swallows a failure rather than failing the request', async () => {
      mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

      await expect(invokeCreateCorpus(packDate)).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith('Could not ask for a corpus', expect.objectContaining({ date: packDate }))
    })
  })

  describe('invokeCreatePack', () => {
    // Called by the corpus job once a corpus is stored, so the puzzles it unblocks appear without
    // waiting for a client refetch or for 03:33. No ifMissing flag and no model call: this is the
    // same pure assembly the request path runs.
    it('queues a rebuild for the date', async () => {
      mockSend.mockResolvedValueOnce({})

      await invokeCreatePack(packDate)

      expect(mockSend).toHaveBeenCalledWith({
        FunctionName: 'create-pack-function',
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify({ date: packDate })),
      })
    })

    it('logs and swallows a failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

      await expect(invokeCreatePack(packDate)).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalled()
    })
  })
})
