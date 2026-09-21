import Ajv from 'ajv'
import { readFileSync } from 'fs'
import { join } from 'path'

import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { generatePhrases, phraseTool } from '@services/phrases'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('phrases', () => {
  // A Bedrock unavailability: 503, $fault server, `$retryable` ABSENT -- what distinguishes it
  // from a generic 5xx. A function, so no test shares an error object.
  const unavailableOnce = (): void => {
    jest.mocked(invokeModel).mockRejectedValueOnce(
      Object.assign(new Error('Bedrock is unable to process your request'), {
        $fault: 'server',
        $metadata: { attempts: 4, httpStatusCode: 503 },
      }),
    )
  }

  const prompt = {
    config: { anthropicVersion: 'bedrock-2023-05-31', maxTokens: 16000, model: 'a-model', thinkingEffort: 'high' },
    contents: 'generate phrases',
  }

  const generated = (text: string, shape = 'title') => ({
    category: 'Film',
    hints: ['A space opera sequel', 'The middle chapter, where the heroes lose', 'The one where the father is named'],
    shape,
    text,
  })

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ phrases: [generated('The Maltese Falcon')] } as never)
  })

  describe('phraseTool', () => {
    // tool-schemas.test.ts asserts what the schema may contain; here it is the consequence for a
    // LADDER. ajv validates the whole payload, so a constraint on `hints` would cost every phrase
    // in the batch over one drifted ladder.
    describe('ajv validation', () => {
      const validate = new Ajv().compile(phraseTool.input_schema)

      const payload = (hints: unknown): Record<string, unknown> => ({
        phrases: [{ category: 'Film', hints, shape: 'title', text: 'The Maltese Falcon' }],
      })

      it.each([
        ['a hint returned as an object instead of a string', [{ rung: 1, text: 'A space opera sequel' }, 'b', 'c']],
        ['a ladder with too few rungs', ['only one']],
        ['a ladder with too many rungs', ['one', 'two', 'three', 'four']],
        ['a ladder of mixed types', ['one', 2, null]],
        ['an empty ladder', []],
      ])('accepts a batch containing %s so the other phrases survive', (_description, hints) => {
        expect(validate(payload(hints))).toBe(true)
      })

      it('still rejects a payload with no phrases key at all', () => {
        expect(validate({})).toBe(false)
      })
    })
  })

  // The other half of PHRASES_PER_CALL: nothing else in the suite reads this cap, so lowering it
  // puts the calls back on the ceiling with the whole suite green. Asserted on the FILE, which is
  // what deploy-prompts.ts ships; a fixture would pin a copy of the number rather than the number.
  describe('the prompt cap the split is sized against', () => {
    it('pins create-phrases.txt at 32000 tokens', () => {
      const [firstLine] = readFileSync(join(__dirname, '../../../prompts/create-phrases.txt'), 'utf8').split('\n')

      expect((JSON.parse(firstLine.replace(/^#\s*/, '')) as { maxTokens: number }).maxTokens).toEqual(32_000)
    })
  })

  describe('generatePhrases', () => {
    it('fetches the prompt by its configured id', async () => {
      await generatePhrases(4)

      expect(getPromptById).toHaveBeenCalledWith('create-phrases')
    })

    it('asks for the number of phrases requested when they fit in one call', async () => {
      await generatePhrases(6)

      expect(invokeModel).toHaveBeenCalledWith(prompt, phraseTool, expect.objectContaining({ phraseCount: 6 }))
      expect(invokeModel).toHaveBeenCalledTimes(1)
    })

    // PHRASES_PER_CALL is six, measured rather than rounded: against the live prompt at
    // thinkingEffort high, six phrases cost 12,453 output tokens (39% of the 32,000 cap) and
    // eighteen cost 24,816 (78%). Thinking and the tool_use block share that ceiling, so a run
    // near it returns thinking and nothing else.
    it.each([
      [18, [6, 6, 6]],
      [12, [6, 6]],
      [10, [5, 5]],
      [9, [5, 4]],
      [6, [6]],
      [4, [4]],
    ])('splits a request for %i phrases into calls of %j', async (count, expected) => {
      await generatePhrases(count)

      expect(
        jest.mocked(invokeModel).mock.calls.map((call) => (call[2] as { phraseCount: number }).phraseCount),
      ).toEqual(expected)
    })

    // Balanced, not "fill six then take the remainder": a trailing chunk of one is a batch whose
    // ladder has nothing to check itself against, since <hint_rules> rung 1 asks for two others.
    it.each([
      [13, [5, 4, 4]],
      [7, [4, 3]],
    ])('balances the calls for %i phrases rather than leaving a thin tail', async (count, expected) => {
      await generatePhrases(count)

      expect(
        jest.mocked(invokeModel).mock.calls.map((call) => (call[2] as { phraseCount: number }).phraseCount),
      ).toEqual(expected)
    })

    // Cryptogram's difficulty is dominated by familiarity, and left alone the prompt returns a
    // batch rated 4 and 5 across the board. Asserted as the SUM ACROSS THE CALLS, since the share
    // is a property of the shared pool; each chunk rounds up, which over-asks, the recoverable way.
    it.each([
      [21, 8],
      [10, 4],
      [9, 4],
      [6, 2],
    ])('asks for a hard-end share of a batch of %i across every call', async (count, challenging) => {
      await generatePhrases(count)

      const total = jest
        .mocked(invokeModel)
        .mock.calls.reduce(
          (sum, call) => sum + (call[2] as { challengingPhraseCount: number }).challengingPhraseCount,
          0,
        )
      expect(total).toEqual(challenging)
    })

    // Left alone the prompt returns two- and three-word phrases almost exclusively. Same lever as
    // challengingPhraseCount: a described property is one the model can agree with and not supply.
    it.each([
      [18, 6],
      [12, 4],
      [10, 4],
      [6, 2],
    ])('asks for a long-phrase share of a batch of %i across every call', async (count, long) => {
      await generatePhrases(count)

      const total = jest
        .mocked(invokeModel)
        .mock.calls.reduce((sum, call) => sum + (call[2] as { longPhraseCount: number }).longPhraseCount, 0)
      expect(total).toEqual(long)
    })

    // Rounded UP, so the smallest batch the handler can ask for still carries the instruction.
    it('never asks for zero long phrases', async () => {
      await generatePhrases(1)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, number>
      expect(context.longPhraseCount).toBeGreaterThan(0)
    })

    it('never asks for zero challenging phrases', async () => {
      await generatePhrases(1)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, number>
      expect(context.challengingPhraseCount).toBeGreaterThan(0)
    })

    // The load-bearing anti-repetition mechanism: unseeded, the model returns the same dozen.
    it('seeds the context with random inspiration words', async () => {
      await generatePhrases(4)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, string[]>
      expect(context.inspirationNouns).toHaveLength(10)
      expect(context.inspirationVerbs).toHaveLength(8)
      expect(context.inspirationAdjectives).toHaveLength(5)
    })

    // Shown to the model, not only enforced: rejecting a repeat it was never told about kills a
    // generation with no way for it to have done better.
    it('hands the model the phrases recent packs already used', async () => {
      await generatePhrases(4, ['Jaws', 'Alien'])

      expect(invokeModel).toHaveBeenCalledWith(
        prompt,
        phraseTool,
        expect.objectContaining({ phrasesAlreadyUsed: ['Jaws', 'Alien'] }),
      )
    })

    // Three independent draws put more distinct material in front of the model than one.
    it('seeds every call with its own inspiration draw', async () => {
      await generatePhrases(18, [], jest.fn().mockReturnValue(0.5))

      const nouns = jest
        .mocked(invokeModel)
        .mock.calls.map((call) => (call[2] as { inspirationNouns: string[] }).inspirationNouns)
      expect(nouns).toHaveLength(3)
      expect(nouns.every((sample) => sample.length === 10)).toBe(true)
    })

    // The only test that fails if the calls are made but their failures are not contained: one
    // truncated call must cost six phrases, which REQUEST_MULTIPLIER 3 over-asks to absorb.
    it('keeps the phrases from the other calls when one call fails outright', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        .mockRejectedValueOnce(new Error('Model response contained no submit_phrases tool call'))
        .mockResolvedValueOnce({ phrases: [generated('Split second')] } as never)

      const { phrases } = await generatePhrases(18)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Toe hold', 'Split second'])
    })

    // logError, not log: a contained failure that raises nothing is how three calls become one.
    it('raises an ERROR naming what a failed call cost', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('kaboom'))

      await generatePhrases(18)

      expect(logError).toHaveBeenCalledWith(
        'Could not generate a phrase batch; keeping the other calls',
        expect.objectContaining({ asked: 6 }),
      )
    })

    // The same line at WARN when the service was unreachable: concurrent calls meeting one outage
    // otherwise page once each, after the SDK has already retried them.
    it('warns rather than alarming when Bedrock is unavailable', async () => {
      unavailableOnce()

      await generatePhrases(18)

      expect(logWarning).toHaveBeenCalledWith(
        'Could not generate a phrase batch; keeping the other calls',
        expect.objectContaining({ asked: 6 }),
      )
      expect(logError).not.toHaveBeenCalledWith(
        'Could not generate a phrase batch; keeping the other calls',
        expect.anything(),
      )
    })

    // Unanimity is the rule: one call coming back means the emptiness is about what the model
    // sent. mockRejectedValueOnce PER CALL, since clearMocks clears calls and not implementations
    // and a persistent rejection leaks into every later test in the file.
    it('reports the supply as upstream-unavailable only when no call came back', async () => {
      unavailableOnce()
      unavailableOnce()
      unavailableOnce()

      expect((await generatePhrases(18)).upstreamUnavailable).toBe(true)
    })

    it('does not report upstream-unavailable when any call came back', async () => {
      unavailableOnce()
      unavailableOnce()

      expect((await generatePhrases(18)).upstreamUnavailable).toBe(false)
    })

    it('does not report upstream-unavailable when a call failed for another reason', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('kaboom'))
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('kaboom'))
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('kaboom'))

      expect((await generatePhrases(18)).upstreamUnavailable).toBe(false)
    })

    // Once per call, never mockRejectedValue, for the reason above.
    it('returns an empty list rather than throwing when every call fails', async () => {
      jest
        .mocked(invokeModel)
        .mockRejectedValueOnce(new Error('kaboom'))
        .mockRejectedValueOnce(new Error('kaboom'))
        .mockRejectedValueOnce(new Error('kaboom'))

      expect((await generatePhrases(18)).phrases).toEqual([])
    })

    // requestBatch's dedupe does not see across calls, so two calls can land on the same idiom.
    it('keeps only one copy of a phrase two calls both returned', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        // Case and spacing only: punctuation would be rejected by ALLOWED_CHARACTERS before the
        // dedupe ran, and the row would then pass with the cross-call dedupe deleted.
        .mockResolvedValueOnce({ phrases: [generated('TOE  hold')] } as never)
        .mockResolvedValueOnce({ phrases: [generated('Split second')] } as never)

      const { phrases } = await generatePhrases(18)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Toe hold', 'Split second'])
    })

    it('returns a phrase per usable result', async () => {
      expect((await generatePhrases(4)).phrases).toEqual([
        {
          category: 'Film',
          // The reviewer overwrites this. The default is what survives when review does not run.
          familiarity: 3,
          hints: [
            'A space opera sequel',
            'The middle chapter, where the heroes lose',
            'The one where the father is named',
          ],
          shape: 'title',
          text: 'The Maltese Falcon',
        },
      ])
    })

    // Digits survive vowel-stripping, so CATCH 22 reaches a Missing Vowels board with its digits
    // in plaintext. Gating at the phrase means no puzzle type has to.
    it('drops a phrase containing a digit', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('Catch 22'), generated('The Maltese Falcon')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    // The prose gates run over the generator's own output, not only over the reviewer's rewrites.
    it('drops a phrase whose hints are not a three-rung ladder', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [{ ...generated('Raiders of the Lost Ark'), hints: ['only one'] }, generated('The Maltese Falcon')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    it('rejects a drifted shape tag per phrase, leaving the rest of the batch standing', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Maltese Falcon'), { ...generated('Cloak and dagger'), shape: 'saying' }],
      } as never)

      const { phrases } = await generatePhrases(2)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    // Every field is re-checked per phrase; the schema has no `required` list to catch these.
    it.each([
      ['no category', { category: undefined }],
      ['a non-string category', { category: 5 }],
      ['no shape', { shape: undefined }],
      ['hints that are not an array at all', { hints: 'A space opera sequel' }],
    ])('rejects a phrase with %s, leaving the rest of the batch standing', async (_description, overrides) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [{ ...generated('Cloak and dagger'), ...overrides }, generated('The Maltese Falcon')],
      } as never)

      const { phrases } = await generatePhrases(2)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    // Pins accept-before-key: normalizeAnswer throws on a missing text, so keying first turns
    // one bad element into a whole-batch failure.
    it('returns the rest of the batch when one phrase has no text at all', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [{ category: 'Film', hints: ['a', 'b', 'c'], shape: 'title' }, generated('The Maltese Falcon')],
      } as never)

      expect((await generatePhrases(2)).phrases).toEqual([expect.objectContaining({ text: 'The Maltese Falcon' })])
    })

    it('returns the rest of the batch when one element is null', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Maltese Falcon')] } as never)

      expect((await generatePhrases(2)).phrases).toEqual([expect.objectContaining({ text: 'The Maltese Falcon' })])
    })

    // Why the log line reads `phrase?.shape`: the element reaching it may be null.
    it('logs a rejected element without dereferencing it', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Maltese Falcon')] } as never)

      await generatePhrases(2)

      expect(log).toHaveBeenCalledWith('Rejected a generated phrase', { shape: undefined, text: undefined })
    })

    // Two lines per rejection, neither derivable from the other: toPhrase names the PHRASE
    // refused, the shared loop names WHICH element of WHICH type's batch. A null element fails on
    // isUsable's first guard, so the prose gates add no lines of their own.
    it('logs a rejection once from the gate and once from the shared loop, and no more', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Maltese Falcon')] } as never)

      await generatePhrases(2)

      const rejections = jest.mocked(log).mock.calls.filter(([message]) => String(message).startsWith('Rejected'))
      expect(rejections.map(([message]) => message)).toEqual(['Rejected a generated phrase', 'Rejected an item'])
    })

    // The punctuation sits on the exclusion ENTRY, not the generated text: the list is built from
    // stored answers, and a generated `the maltese falcon!` is dropped by ALLOWED_CHARACTERS one
    // branch earlier. The `key` is pinned too, since a reason-only line is twenty identical lines
    // on a night where the exclusion list eats twenty of twenty-one phrases.
    it('drops a phrase the exclusion list already named, ignoring case and punctuation', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('the maltese falcon'), generated('Raiders of the Lost Ark')],
      } as never)

      const { phrases } = await generatePhrases(4, ['The Maltese Falcon!'])

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Raiders of the Lost Ark'])
      expect(log).toHaveBeenCalledWith('Rejected an item', {
        index: 0,
        key: 'THEMALTESEFALCON',
        reason: 'repeated',
        type: 'phrase',
      })
    })

    // The prompt's own worked examples, from src/assets/prompt-example-phrases.ts -- the one
    // exclusion the model is definitely told about. The survivor is asserted, not just the count:
    // a gate that dropped the whole batch would satisfy a length check.
    it('drops a phrase the prompt itself prints as an example', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Old Man and the Sea'), generated('Raiders of the Lost Ark')],
      } as never)

      expect((await generatePhrases(4)).phrases.map((phrase) => phrase.text)).toEqual(['Raiders of the Lost Ark'])
    })

    it('keeps only one copy of a phrase repeated within the batch', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Maltese Falcon'), generated('THE MALTESE FALCON')],
      } as never)

      expect((await generatePhrases(4)).phrases).toHaveLength(1)
    })

    // Applied in code and never sent to the model: listing slurs in a prompt primes toward them.
    it('drops a phrase containing a charged word', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('No shit Sherlock'), generated('The Maltese Falcon')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    // Whole-token matching, never substring. ASSESS, COCKTAIL, and SCUNTHORPE are legitimate.
    it.each([['Assess the damage'], ['A cocktail party'], ['Scunthorpe United']])(
      'keeps %s, which only contains a charged word as a substring',
      async (text) => {
        jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated(text)] } as never)

        expect((await generatePhrases(4)).phrases).toHaveLength(1)
      },
    )

    // LLM output is untrusted, and a phrase the player cannot type is worse than a missing one.
    it.each([
      ['an accented character', 'Cafe Society en Espanol é'],
      ['punctuation', "Don't Look Now"],
      ['an ampersand', 'Rock & Roll'],
      ['too few words', 'Jaws'],
      ['too many words', 'One two three four five six seven'],
    ])('drops a phrase with %s', async (_description, text) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated(text), generated('The Maltese Falcon')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Maltese Falcon'])
    })

    // Per call, deliberately: summing `asked`/`returned`/`usable` across calls reports a ratio no
    // call ever had and hides the one that came back thin. Night totals are `Phrase supply
    // measured` below.
    it('closes with one asked/returned/usable line per call carrying the challenging count', async () => {
      await generatePhrases(6)

      expect(log).toHaveBeenCalledWith('Fetched batch', {
        asked: 6,
        challenging: 2,
        returned: 1,
        type: 'phrase',
        usable: 1,
      })
    })

    // A second line on purpose: `challenging` is what was ASKED and known before the call, these
    // are what LANDED, and requestBatch's logContext is static by design.
    //
    // `phrazleBand5` exists because poolBreadth's usableByDifficulty cannot see the failure: it
    // logs only when a band finds nothing, measures the pool remaining after earlier generators
    // have spent phrases, and under a tolerance of 1 counts every derived-4 phrase as usable at
    // 5. This counts phrases deriving EXACTLY to 5 over the whole batch, and stays one line over
    // the night because it is a tripwire about the shared POOL, not about any one call.
    it('measures the usable supply, the long phrases and the exact-band-5 count over every call', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Barbed wire')] } as never)
        .mockResolvedValueOnce({ phrases: [generated('Music soothes the savage beast')] } as never)
        .mockResolvedValueOnce({ phrases: [generated('Air your dirty laundry')] } as never)

      await generatePhrases(18)

      // Every count differs on purpose so no two meters can be confused, and the phrases arrive
      // from different calls, which proves the meter spans the night rather than a batch.
      expect(log).toHaveBeenCalledWith('Phrase supply measured', {
        asked: 18,
        calls: 3,
        callsFailed: 0,
        long: 2,
        phrazleBand5: 1,
        phrazleUsable: 3,
        returned: 3,
      })
    })

    // The night the tripwire watches for: a logged zero is an instrument, an absent line is not.
    it('reports zeroes rather than omitting the line', async () => {
      // Overridden because the beforeAll default clears the floor. CONSCIOUSNESS is past
      // MAX_WORD_LETTERS, so this phrase is unusable and short at the same time.
      jest.mocked(invokeModel).mockResolvedValue({ phrases: [generated('Consciousness matters')] } as never)

      await generatePhrases(18)

      expect(log).toHaveBeenCalledWith('Phrase supply measured', {
        asked: 18,
        calls: 3,
        callsFailed: 0,
        long: 0,
        phrazleBand5: 0,
        phrazleUsable: 0,
        returned: 1,
      })
    })

    // callsFailed beside the supply it explains: a thin batch and two failed calls read the same
    // apart, and want opposite fixes.
    it('names how many calls failed on the same line as the supply they cost', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        .mockRejectedValueOnce(new Error('kaboom'))
        .mockRejectedValueOnce(new Error('kaboom'))

      await generatePhrases(18)

      expect(log).toHaveBeenCalledWith(
        'Phrase supply measured',
        expect.objectContaining({ asked: 18, calls: 3, callsFailed: 2, returned: 1 }),
      )
    })

    // Nothing is persisted, so an empty list leaves no stale corpus behind.
    it('returns an empty list rather than throwing when nothing survives', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated('Rock & Roll')] } as never)

      expect((await generatePhrases(4)).phrases).toEqual([])
    })
  })
})
