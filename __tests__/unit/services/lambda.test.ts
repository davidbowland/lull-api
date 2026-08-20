import { packDate } from '../__mocks__'
import { invokeCreatePack } from '@services/lambda'
import { logError } from '@utils/logging'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging')

describe('invokeCreatePack', () => {
  // InvocationType 'Event' is what makes this fire-and-forget: Lambda queues the payload and
  // returns immediately, so the response a player is waiting on never blocks on generation.
  it('queues the date without waiting for the result', async () => {
    mockSend.mockResolvedValueOnce({})

    await invokeCreatePack(packDate)

    expect(mockSend).toHaveBeenCalledWith({
      FunctionName: 'create-pack-function',
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify({ date: packDate })),
    })
  })

  // The pack is already built and already written by the time this runs, so a failed invoke must
  // not turn a request that was about to answer 200 with a playable partial pack into a 500.
  // Completing the pack is an improvement, not a precondition.
  it('logs and swallows a failure rather than failing the request', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

    await expect(invokeCreatePack(packDate)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith(
      'Could not ask the pack builder to finish this date',
      expect.objectContaining({ date: packDate }),
    )
  })
})
