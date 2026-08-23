import { InvokeCommand } from '@aws-sdk/client-lambda'

import { packDate } from '../__mocks__'
import { invokeCreateModelPuzzles, invokeCreatePhrasePuzzles, invokeSlowGenerators } from '@services/lambda'
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

describe('invokeCreateModelPuzzles', () => {
  it('queues the date without waiting for the result', async () => {
    mockSend.mockResolvedValueOnce({})

    await invokeCreateModelPuzzles(packDate)

    expect(mockSend).toHaveBeenCalledWith({
      FunctionName: 'create-model-puzzles-function',
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify({ date: packDate })),
    })
  })

  it('logs and swallows a failure rather than failing the caller', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

    await expect(invokeCreateModelPuzzles(packDate)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith(
      'Could not ask for model puzzles',
      expect.objectContaining({ date: packDate }),
    )
  })
})

describe('invokeSlowGenerators', () => {
  // A third async BUILDER is added here and nowhere else -- a builder, not a type. Three call sites
  // is how a fan-out rots, and the two callers are already the two places this repo has forgotten to
  // keep in step before.
  //
  // SORTED, because order is not a property of this function. Both hand-offs go out concurrently --
  // each is one round trip to the Lambda control plane on a 15-second request path and neither reads
  // the other's result -- so asserting the sequence would pin an artifact of which promise the
  // runtime happened to start first, and would redden on a change that broke nothing.
  it('asks both builders, once each', async () => {
    mockSend.mockResolvedValue({})

    await invokeSlowGenerators(packDate)

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(
      jest
        .mocked(InvokeCommand)
        .mock.calls.map(([input]) => input.FunctionName)
        .sort(),
    ).toStrictEqual(['create-model-puzzles-function', 'create-phrase-puzzles-function'])
  })

  // Both are in flight at once rather than one after the other. Awaiting them in sequence put two
  // control-plane round trips on the request path in front of a player waiting on a response, for no
  // ordering anything depends on.
  it('does not wait for the first hand-off before making the second', async () => {
    let releaseFirst = (): void => undefined
    mockSend
      .mockImplementationOnce(async () => new Promise((resolve) => (releaseFirst = () => resolve({}))))
      .mockResolvedValueOnce({})

    const pending = invokeSlowGenerators(packDate)
    await Promise.resolve()

    expect(mockSend).toHaveBeenCalledTimes(2)

    releaseFirst()
    await pending
  })

  // Neither invoke throws, so neither does this. Both are called after the work that matters has
  // already succeeded and been written.
  it('does not throw when an invoke fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda on fire'))

    await expect(invokeSlowGenerators(packDate)).resolves.toBeUndefined()
  })

  // A failing FIRST invoke must not cost the second. Both are independent hand-offs and the phrase
  // half going down is not a reason the model half should not be asked for.
  it('still asks the second builder when the first invoke fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda on fire')).mockResolvedValueOnce({})

    await invokeSlowGenerators(packDate)

    expect(
      jest
        .mocked(InvokeCommand)
        .mock.calls.map(([input]) => input.FunctionName)
        .sort(),
    ).toStrictEqual(['create-model-puzzles-function', 'create-phrase-puzzles-function'])
  })
})
