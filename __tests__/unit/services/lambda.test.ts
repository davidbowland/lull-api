import { packDate } from '../__mocks__'
import { invokeCreatePhrasePuzzles } from '@services/lambda'
import { logError } from '@utils/logging'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging')

describe('invokeCreatePhrasePuzzles', () => {
  // InvocationType 'Event' is what makes this fire-and-forget: Lambda queues the payload and
  // returns immediately, so the response a player is waiting on never blocks on a model call.
  it('queues the date without waiting for the result', async () => {
    mockSend.mockResolvedValueOnce({})

    await invokeCreatePhrasePuzzles(packDate)

    expect(mockSend).toHaveBeenCalledWith({
      FunctionName: 'create-phrase-puzzles-function',
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify({ date: packDate })),
    })
  })

  // The self-contained puzzles are already built and written by the time this runs, so a failed
  // invoke must not turn a request about to answer 200 with a playable partial pack into a 500.
  it('logs and swallows a failure rather than failing the caller', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

    await expect(invokeCreatePhrasePuzzles(packDate)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith(
      'Could not ask for phrase puzzles',
      expect.objectContaining({ date: packDate }),
    )
  })
})
