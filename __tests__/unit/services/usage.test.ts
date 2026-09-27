import { packDate } from '../__mocks__'
import { appendPackUsage } from '@services/dynamodb'
import { withPackUsage } from '@services/usage'
import { log, logWarning } from '@utils/logging'
import { recordModelUsage } from '@utils/usage'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('withPackUsage', () => {
  const work = async (): Promise<void> => {
    recordModelUsage('us.anthropic.claude-opus-5-5', { input_tokens: 1_000, output_tokens: 1_000 })
  }

  beforeAll(() => {
    jest.mocked(appendPackUsage).mockResolvedValue(true)
  })

  it('stores what the work spent against the pack date', async () => {
    await withPackUsage(packDate, 'phrase-puzzles', work)

    expect(appendPackUsage).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({
        builder: 'phrase-puzzles',
        tokens: [expect.objectContaining({ costUsd: 0.024, invocations: 1, model: 'us.anthropic.claude-opus-5-5' })],
      }),
    )
    expect(log).toHaveBeenCalledWith('Generation usage', expect.objectContaining({ date: packDate }))
  })

  // The tokens were spent whether or not anything shipped.
  it('stores an invocation that made no model calls', async () => {
    await withPackUsage(packDate, 'model-puzzles', async () => undefined)

    expect(appendPackUsage).toHaveBeenCalledWith(packDate, expect.objectContaining({ tokens: [] }))
  })

  it('logs rather than throws when there is no pack row', async () => {
    jest.mocked(appendPackUsage).mockResolvedValueOnce(false)

    await withPackUsage(packDate, 'model-puzzles', work)

    expect(log).toHaveBeenCalledWith('No pack to attach usage to', { builder: 'model-puzzles', date: packDate })
  })

  // A cost record must never page or cost the pack anything; the log line already carries it.
  it('warns rather than throws when the store fails', async () => {
    const error = new Error('table on fire')
    jest.mocked(appendPackUsage).mockRejectedValueOnce(error)

    await expect(withPackUsage(packDate, 'model-puzzles', work)).resolves.toBeUndefined()

    expect(logWarning).toHaveBeenCalledWith('Could not store generation usage', {
      builder: 'model-puzzles',
      date: packDate,
      error,
    })
  })
})
