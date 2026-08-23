import { prompt, toolSchema } from '../__mocks__'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { requestBatch } from '@services/model-batch'
import { log, logError } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('model-batch', () => {
  type Raw = { text?: unknown } | null

  // Named setup helper, called explicitly. No beforeEach anywhere in this repo.
  const request = (overrides = {}) => ({
    accept: (raw: Raw) => (typeof raw?.text === 'string' ? { text: raw.text } : undefined),
    asked: 3,
    context: { count: 3 },
    itemsOf: (payload: unknown) => (payload as { items: Raw[] }).items,
    keyOf: (item: { text: string }) => item.text.toUpperCase(),
    promptId: 'a-prompt',
    tool: toolSchema,
    type: 'test',
    ...overrides,
  })

  const returns = (items: unknown[]): void => {
    jest.mocked(invokeModel).mockResolvedValueOnce({ items } as never)
  }

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ items: [] } as never)
  })

  describe('requestBatch', () => {
    it('fetches the prompt by the id it was handed and invokes the model with the type-owned tool', async () => {
      returns([])

      await requestBatch(request())

      expect(getPromptById).toHaveBeenCalledWith('a-prompt')
      expect(invokeModel).toHaveBeenCalledWith(prompt, toolSchema, { count: 3 })
    })

    it('returns the items accept kept', async () => {
      returns([{ text: 'one' }, { text: 'two' }])

      await expect(requestBatch(request())).resolves.toEqual([{ text: 'one' }, { text: 'two' }])
    })

    // REJECTS AN ITEM, NEVER THE BATCH. This is the whole reason the loop is shared.
    it('drops one bad item and keeps the rest', async () => {
      returns([{ text: 'one' }, { nope: true }, null, { text: 'two' }])

      await expect(requestBatch(request())).resolves.toEqual([{ text: 'one' }, { text: 'two' }])
    })

    it('logs a rejected item against its type, so a bad batch names a type rather than a schema', async () => {
      returns([{ nope: true }])

      await requestBatch(request())

      expect(log).toHaveBeenCalledWith('Rejected an item', { index: 0, reason: 'failed the type gate', type: 'test' })
    })

    // ONE line from the shared loop per rejected element, and it does not depend on the caller's gate
    // having logged anything -- `request()`'s accept logs nothing at all. The caller's own line, which
    // toPhrase does emit with the phrase text on it, is ADDITIONAL and answers a different question.
    it('logs exactly one rejection line per rejected item', async () => {
      returns([{ text: 'one' }, { nope: true }, null])

      await requestBatch(request())

      expect(jest.mocked(log).mock.calls.filter(([message]) => message === 'Rejected an item')).toHaveLength(2)
      expect(logError).not.toHaveBeenCalled()
    })

    it('dedupes within the batch on the normalized key', async () => {
      returns([{ text: 'one' }, { text: 'ONE' }])

      await expect(requestBatch(request())).resolves.toEqual([{ text: 'one' }])
    })

    // NAMES THE KEY, not just the reason. Master logged `Skipped a repeated phrase` with the text on
    // it; a reason-only line turns a night where the exclusion list eats twenty of twenty-one phrases
    // into twenty byte-identical lines and no way to tell which twenty -- and phrasesAlreadyUsed is
    // the load-bearing anti-repetition mechanism, so this line is how it is diagnosed misfiring.
    it('names the key it dropped as a repeat rather than silently shortening the batch', async () => {
      returns([{ text: 'one' }, { text: 'ONE' }])

      await requestBatch(request())

      expect(log).toHaveBeenCalledWith('Rejected an item', { index: 1, key: 'ONE', reason: 'repeated', type: 'test' })
    })

    it('dedupes against the exclusion list', async () => {
      returns([{ text: 'one' }, { text: 'two' }])

      await expect(requestBatch(request({ excludedKeys: new Set(['ONE']) }))).resolves.toEqual([{ text: 'two' }])
    })

    // asked / returned / usable on ONE line. A batch that turned three asks into one puzzle used to
    // log the ask and the result in different places and never the gap.
    it('closes with one asked/returned/usable line', async () => {
      returns([{ text: 'one' }, { nope: true }])

      await requestBatch(request({ logContext: { challenging: 1 } }))

      expect(log).toHaveBeenCalledWith('Fetched batch', {
        asked: 3,
        challenging: 1,
        returned: 2,
        type: 'test',
        usable: 1,
      })
    })

    // accept NEVER throws is a contract on the caller, and this is the backstop for a caller that
    // breaks it: a throwing accept is a per-item rejection, not a whole-batch failure. Without this
    // the seam would let one bad element out through a different door than the one it closed.
    it('treats a throwing accept as a rejection rather than propagating it', async () => {
      returns([{ text: 'one' }, { text: 'boom' }])
      const accept = (raw: { text: string }) => {
        // No `if` in a test BODY; this is a fixture function, and the rule is about assertions.
        return raw.text === 'boom' ? (JSON.parse('{') as never) : { text: raw.text }
      }

      await expect(requestBatch(request({ accept }))).resolves.toEqual([{ text: 'one' }])
    })

    // logError, not log. accept is SPECIFIED never to throw, so a throw is a code defect in the
    // caller's gate -- and the CloudWatch subscription filter is `level="ERROR"`. Before the loop was
    // hoisted a throw escaped generatePhrases into the handler's catch and became
    // `Could not add phrase puzzles`, which alarms; at `log` a gate that breaks on some elements
    // raises no ERROR anywhere while the pack still completes. `index` because the batch is
    // twenty-one elements long and keyOf cannot run on one accept never returned.
    it('logs a throwing gate at ERROR, so a broken gate still raises the alarm it used to', async () => {
      returns([{ text: 'boom' }])
      const accept = () => {
        throw new Error('an accept threw')
      }

      await requestBatch(request({ accept }))

      expect(logError).toHaveBeenCalledWith('Rejected an item', {
        error: expect.objectContaining({ message: 'an accept threw' }),
        index: 0,
        reason: 'gate threw',
        type: 'test',
      })
    })

    // A gate that exploded did NOT fail the type gate -- it never returned a verdict at all. Logging
    // both lines described the crash as an ordinary rejection and buried the defect in the volume.
    it('logs a throwing gate once, and never as an item that failed the type gate', async () => {
      returns([{ text: 'boom' }])
      const accept = () => {
        throw new Error('an accept threw')
      }

      await requestBatch(request({ accept }))

      expect(logError).toHaveBeenCalledTimes(1)
      expect(log).not.toHaveBeenCalledWith(
        'Rejected an item',
        expect.objectContaining({ reason: 'failed the type gate' }),
      )
    })

    // keyOf is called ONLY on something accept returned. normalizeAnswer throws on undefined, null
    // or a number, so keying a raw element is a whole-batch failure wearing the costume of a
    // per-item filter -- which is what services/phrases.ts did on master until this branch reordered
    // it.
    it('never calls keyOf on a raw element', async () => {
      const keyOf = jest.fn((item: { text: string }) => item.text)
      returns([{ nope: true }, { text: 'one' }])

      await requestBatch(request({ keyOf }))

      expect(keyOf).toHaveBeenCalledTimes(1)
      expect(keyOf).toHaveBeenCalledWith({ text: 'one' })
    })
  })
})
