import { corpusEntries } from '../__mocks__'
import { createCorpusHandler } from '@handlers/create-corpus'
import { generateCorpus } from '@services/corpus'
import { setCorpus } from '@services/dynamodb'
import { logError } from '@utils/logging'

jest.mock('@services/corpus')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('create-corpus', () => {
  beforeAll(() => {
    jest.mocked(generateCorpus).mockResolvedValue(corpusEntries)
    jest.mocked(setCorpus).mockResolvedValue(true)
  })

  // The corpus run fires at 03:03 UTC and the pack run at 03:33, both targeting tomorrow, so the
  // corpus a pack reads is written half an hour before that pack is built.
  it('writes the corpus for tomorrow', async () => {
    await createCorpusHandler({} as never)

    expect(setCorpus).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), corpusEntries)
  })

  it('generates before writing', async () => {
    await createCorpusHandler({} as never)

    expect(generateCorpus).toHaveBeenCalled()
    expect(setCorpus).toHaveBeenCalled()
  })

  // A failed model call is the case the whole fallback exists for: the consumers keep drawing from
  // the most recent stored corpus, so three puzzle types survive a bad night. It is still an ERROR,
  // because the CloudWatch subscription filters on level="ERROR" and this handler otherwise returns
  // normally -- a silently skipped corpus night would raise no alarm at all.
  it('logs an error and does not throw when generation fails', async () => {
    jest.mocked(generateCorpus).mockRejectedValueOnce(new Error('no usable phrases'))

    await expect(createCorpusHandler({} as never)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Corpus generation failed'), expect.anything())
    expect(setCorpus).not.toHaveBeenCalled()
  })

  it('logs an error and does not throw when the write fails', async () => {
    jest.mocked(setCorpus).mockRejectedValueOnce(new Error('table on fire'))

    await expect(createCorpusHandler({} as never)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalled()
  })

  // Losing this race is expected rather than exceptional: EventBridge delivers at least once, and
  // the condition on setCorpus is what protects the used-id set from being reset by a second run.
  it('does not raise an error when a corpus already exists for the date', async () => {
    jest.mocked(setCorpus).mockResolvedValueOnce(false)

    await createCorpusHandler({} as never)

    expect(logError).not.toHaveBeenCalled()
  })
})
