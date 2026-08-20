import { corpusEntries } from '../__mocks__'
import { createCorpusHandler } from '@handlers/create-corpus'
import { ensureCorpus, generateCorpus } from '@services/corpus'
import { setCorpus } from '@services/dynamodb'
import { invokeCreatePack } from '@services/lambda'
import { logError } from '@utils/logging'

jest.mock('@services/corpus')
jest.mock('@services/dynamodb')
jest.mock('@services/lambda')
jest.mock('@utils/logging')

describe('create-corpus', () => {
  beforeAll(() => {
    jest.mocked(generateCorpus).mockResolvedValue(corpusEntries)
    jest.mocked(ensureCorpus).mockResolvedValue(true)
    jest.mocked(setCorpus).mockResolvedValue(true)
    jest.mocked(invokeCreatePack).mockResolvedValue(undefined)
  })

  describe('the nightly run', () => {
    // A fresh corpus on purpose. Variety is the reason this runs every night, so it must not be
    // skipped merely because an older corpus is still stored.
    it('generates unconditionally and writes it for tomorrow', async () => {
      await createCorpusHandler({} as never)

      expect(generateCorpus).toHaveBeenCalled()
      expect(ensureCorpus).not.toHaveBeenCalled()
      expect(setCorpus).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), corpusEntries)
    })

    // The nightly run targets a date the pack run will reach on its own half an hour later, so
    // there is nothing to hand on.
    it('does not ask for a pack rebuild', async () => {
      await createCorpusHandler({} as never)

      expect(invokeCreatePack).not.toHaveBeenCalled()
    })

    it('logs an error and does not throw when generation fails', async () => {
      jest.mocked(generateCorpus).mockRejectedValueOnce(new Error('no usable phrases'))

      await expect(createCorpusHandler({} as never)).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith(expect.stringContaining('Corpus generation failed'), expect.anything())
      expect(setCorpus).not.toHaveBeenCalled()
    })

    // Losing this race is expected: EventBridge delivers at least once, and the condition on
    // setCorpus is what protects the used-id set from being reset by a second run.
    it('does not raise an error when a corpus already exists for the date', async () => {
      jest.mocked(setCorpus).mockResolvedValueOnce(false)

      await createCorpusHandler({} as never)

      expect(logError).not.toHaveBeenCalled()
    })
  })

  describe('on demand from a request', () => {
    const onDemand = { date: '2026-06-15', ifMissing: true }

    // ensureCorpus is a no-op when any corpus is stored and claim-guarded when it is not, so the
    // eight dates usePrefetch walks cannot become eight concurrent model calls.
    it('ensures rather than generating outright', async () => {
      await createCorpusHandler(onDemand as never)

      expect(ensureCorpus).toHaveBeenCalledWith('2026-06-15')
      expect(generateCorpus).not.toHaveBeenCalled()
      expect(setCorpus).not.toHaveBeenCalled()
    })

    // The puzzles a corpus unblocks are fast to make, so they are asked for immediately rather
    // than left until a client refetches or until the 03:33 run.
    it('asks for the pack to be rebuilt once a corpus is available', async () => {
      await createCorpusHandler(onDemand as never)

      expect(invokeCreatePack).toHaveBeenCalledWith('2026-06-15')
    })

    // Another run holds the claim, so it will do both halves. Rebuilding now would find no corpus
    // and write the same short pack again.
    it('does not ask for a rebuild when another run holds the claim', async () => {
      jest.mocked(ensureCorpus).mockResolvedValueOnce(false)

      await createCorpusHandler(onDemand as never)

      expect(invokeCreatePack).not.toHaveBeenCalled()
    })

    // An unvalidated event field reaching a DynamoDB key is an unbounded key, and this one names
    // both the corpus to write and the pack to rebuild.
    it('refuses a malformed date', async () => {
      await createCorpusHandler({ date: 'fnord', ifMissing: true } as never)

      expect(ensureCorpus).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledWith('Invalid corpus date, refusing to generate', { date: 'fnord' })
    })
  })
})
