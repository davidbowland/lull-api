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
  // The exact payload the incident produced: ServiceUnavailableException / 503 / $fault server, and
  // `$retryable` ABSENT -- which is what makes it the regression guard rather than a generic 5xx.
  // A function, so each call gets its own instance and no test shares an error object.
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
    jest.mocked(invokeModel).mockResolvedValue({ phrases: [generated('The Empire Strikes Back')] } as never)
  })

  describe('phraseTool', () => {
    // What this schema may and may not contain is asserted in tool-schemas.test.ts, over every tool
    // in the repo at once. What is asserted here is the consequence for a LADDER specifically: ajv
    // validates the entire payload, so any constraint on `hints` would cost all ten phrases over one
    // drifted ladder. The tests below the mock cover what happens to a bad ladder that gets through;
    // these cover the schema letting it through in the first place.
    describe('ajv validation', () => {
      const validate = new Ajv().compile(phraseTool.input_schema)

      const payload = (hints: unknown): Record<string, unknown> => ({
        phrases: [{ category: 'Film', hints, shape: 'title', text: 'The Empire Strikes Back' }],
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

  /*
   * THE OTHER HALF OF PHRASES_PER_CALL, and it lives here because the derivation does.
   *
   * The split is sized against a budget: six phrases measured 12,453 output tokens, which is safe
   * only because the prompt's cap is 32,000. Nothing else in the suite reads that cap, so lowering
   * it -- or raising PHRASES_PER_CALL without raising it -- puts the calls back on the ceiling with
   * the whole suite green, which is exactly how 2026-08-20 happened.
   *
   * Asserted on the FILE, not on a fixture, because the file is what scripts/deploy-prompts.ts ships
   * and the model reads. A fixture would pin a copy of the number rather than the number. Modeled on
   * create-model-puzzles.test.ts, which pins the two cryptic-clue caps the same way -- though NOT for
   * the same reason any more: GENERATOR_BUDGET_MS is no longer derived from a prompt cap. It is 900
   * seconds minus one DynamoDB write, and what those caps size over there is the wall clock of the
   * concurrent fetch phase against the Lambda timeout. The technique carries across; the derivation
   * does not.
   */
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

    /*
     * THE MEASURED CEILING, and every number here was read off a real call rather than argued.
     *
     * Measured against the live prompt on us.anthropic.claude-opus-5 at thinkingEffort high, reading
     * usage.output_tokens_details.thinking_tokens -- the field logModelUsage did not report until
     * this branch, which is why none of this could be read off the log group before:
     *
     *   phrases | thinking | output | wall clock | % of the 32,000 budget
     *        2   |    1,545 |  1,817 |  27s       |   6%
     *        6   |   11,723 | 12,453 | 172s       |  39%
     *        9   |   15,048 | 16,011 | 208s       |  50%
     *       18   |   23,049 | 24,816 | 312s       |  78%
     *
     * EIGHTEEN IS 78% OF BUDGET ON A GOOD RUN, and that single number is the whole diagnosis. The
     * measured call SUCCEEDED -- stop_reason tool_use, all 18 phrases returned -- which is the point
     * rather than a contradiction of it. A request that needs 78% of its ceiling on a good run does
     * not need much of a bad one to need 110%, and thinking and the tool_use block share that
     * ceiling, so the bad ones return content [thinking] and NOTHING ELSE. That is 2026-08-20 losing
     * every Cryptogram, Phrazle and Missing Vowels while 2026-08-26 succeeded on identical code.
     * The bug was never a broken call; it was a batch parked one bad run away from the ceiling.
     *
     * THE CURVE IS STEEP THEN FLATTENS, recorded because a first pass got it wrong in a persuasive
     * way: fitting a power law to 2->6 alone (7.6x the reasoning for 3x the batch, ~n^1.85) predicts
     * ~89,000 tokens at 18. The 9- and 18-phrase rows falsify it -- 6->9 is 1.28x for 1.5x, and the
     * real 18 came in at 23,049. Per phrase the cost FALLS as the batch grows (2,076 tokens each at
     * six, 1,379 at eighteen), so the split trades roughly 50% more tokens a night for the isolation.
     * At three calls of six that is a few cents against six lost puzzles.
     *
     * Doubling the budget was the fix twice already (16,000 -> 32,000 after 2026-08-23) and is not
     * available a third time: a 32,000-token call measured 395s inside a 900s Lambda that still owes
     * reviewPhrases its own call. So the batch comes down instead, which is what services/bedrock.ts
     * named as the next fix before this incident happened.
     *
     * Six is the measured number, not a round one: 12,453 output tokens is 39% of the budget, which
     * leaves 2.5x headroom for the variance that made a ceiling look like a coin flip. It is also
     * FASTER -- three calls of six run concurrently in about 172s where one call of eighteen took
     * 312s -- so the isolation is not bought with wall clock the review call needs.
     */
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

    // BALANCED, not "fill six then take the remainder". A trailing chunk of one is a batch whose
    // hint ladder has nothing to check itself against -- <hint_rules> rung 1 asks for at least TWO
    // other phrases in the batch that still fit -- so 9 goes out as 5 and 4 rather than as 6 and 3,
    // and 13 as 5/4/4 rather than 6/6/1.
    it.each([
      [13, [5, 4, 4]],
      [7, [4, 3]],
    ])('balances the calls for %i phrases rather than leaving a thin tail', async (count, expected) => {
      await generatePhrases(count)

      expect(
        jest.mocked(invokeModel).mock.calls.map((call) => (call[2] as { phraseCount: number }).phraseCount),
      ).toEqual(expected)
    })

    // Cryptogram derives its difficulty almost entirely from the reviewer's familiarity rating, so
    // its hardest declared band can only be filled by a phrase that is NOT instantly named by
    // everyone. Left to itself the prompt returns a batch rated 4 and 5 across the board, which is a
    // pool with nothing in that band and a pack one cryptogram short every night. Asking for a count
    // rather than describing a spread in prose gives the model something to check its batch against.
    // Asserted as the SUM ACROSS THE CALLS, because that is the quantity the night has: the share is
    // a property of the pool three generators draw from, not of whichever call a phrase came out of.
    // Splitting the batch must not quietly change how much hard-end material the night is asked for,
    // and rounding each chunk up rather than the whole is the direction that over-asks -- which is
    // the recoverable one.
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

    // Left alone the prompt returns two- and three-word phrases almost exclusively, so a day built
    // from the pool is the same puzzle three times. Same lever as challengingPhraseCount above, for
    // the same reason: a described property is one the model can agree with and not supply.
    //
    // IT REPLACES compactPhraseCount, WHICH ASKED FOR THE OPPOSITE. That number fed a section
    // demanding "at least TWO narrow letter-sharing" phrases out of a quota that was itself 2, so
    // the whole ask went to two-word phrases of seven letters or fewer -- a shape with only three
    // arrangements under the old floor. Deleting it was measured against four live calls: the batch
    // still returned 10 phrases Phrazle could use against a need of 3.
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

    // Rounded UP, so the smallest batch the handler can ask for still carries the instruction. A
    // floor here would silently drop it on exactly the runs that can least afford a starved band.
    it('never asks for zero long phrases', async () => {
      await generatePhrases(1)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, number>
      expect(context.longPhraseCount).toBeGreaterThan(0)
    })

    // Rounded UP, so the smallest batch the handler can ask for still carries the instruction. A
    // floor here would silently drop it on exactly the runs that can least afford a starved band.
    it('never asks for zero challenging phrases', async () => {
      await generatePhrases(1)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, number>
      expect(context.challengingPhraseCount).toBeGreaterThan(0)
    })

    // The load-bearing anti-repetition mechanism. An unseeded model asked for phrases returns the
    // same dozen idioms every time, so different seeds are why two packs built days apart do not
    // collide in the first place.
    it('seeds the context with random inspiration words', async () => {
      await generatePhrases(4)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, string[]>
      expect(context.inspirationNouns).toHaveLength(10)
      expect(context.inspirationVerbs).toHaveLength(8)
      expect(context.inspirationAdjectives).toHaveLength(5)
    })

    // The backstop the seeding cannot provide. Shown to the model rather than enforced afterwards,
    // because rejecting a repeat the model was never told about kills a generation with no way for
    // it to have done better.
    it('hands the model the phrases recent packs already used', async () => {
      await generatePhrases(4, ['Jaws', 'Alien'])

      expect(invokeModel).toHaveBeenCalledWith(
        prompt,
        phraseTool,
        expect.objectContaining({ phrasesAlreadyUsed: ['Jaws', 'Alien'] }),
      )
    })

    // Every call gets its own list, and this is a gain rather than an accident of the split. The
    // seeds are the load-bearing anti-repetition mechanism, and three independent draws of ten nouns
    // put more distinct material in front of the model over a night than one draw of ten did.
    it('seeds every call with its own inspiration draw', async () => {
      await generatePhrases(18, [], jest.fn().mockReturnValue(0.5))

      const nouns = jest
        .mocked(invokeModel)
        .mock.calls.map((call) => (call[2] as { inspirationNouns: string[] }).inspirationNouns)
      expect(nouns).toHaveLength(3)
      expect(nouns.every((sample) => sample.length === 10)).toBe(true)
    })

    /*
     * THE WHOLE POINT OF THE SPLIT, and the only test that fails if the calls are made but their
     * failures are not contained.
     *
     * On 2026-08-20 one truncated call cost the night every Cryptogram, every Phrazle and every
     * Missing Vowels -- six puzzles -- because there was one call and its rejection propagated to
     * the handler's catch. With three calls that same truncation must cost SIX PHRASES, which
     * REQUEST_MULTIPLIER 3 already over-asks to absorb, and the pack ships whole.
     *
     * services/model-batch.ts rejects an ITEM and never the batch; this is the same rule one level
     * up -- a failed CALL, never the night.
     */
    it('keeps the phrases from the other calls when one call fails outright', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        .mockRejectedValueOnce(new Error('Model response contained no submit_phrases tool call'))
        .mockResolvedValueOnce({ phrases: [generated('Split second')] } as never)

      const { phrases } = await generatePhrases(18)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Toe hold', 'Split second'])
    })

    // logError, not log: this stack's ONE alarm is a CloudWatch subscription filtering on
    // level="ERROR", and a contained failure that raises nothing is how three calls quietly become
    // one. The count that was lost is on the line, because "a call failed" and "a third of the
    // night's supply failed" want different responses.
    it('raises an ERROR naming what a failed call cost', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('kaboom'))

      await generatePhrases(18)

      expect(logError).toHaveBeenCalledWith(
        'Could not generate a phrase batch; keeping the other calls',
        expect.objectContaining({ asked: 6 }),
      )
    })

    // The SAME line at WARN when the model service was simply unreachable. Four concurrent calls
    // meeting one outage produced four identical pages saying Bedrock was busy, after the SDK had
    // already retried each of them four times. Still logged, and `asked` is still on it -- only the
    // level moves, and only for this cause.
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

    // The bit the HANDLER reads. Unanimity matters: one call coming back means the pool's emptiness
    // is about what the model SENT, which is still a page.
    // mockRejectedValueOnce PER CALL, never mockRejectedValue. jest.config sets clearMocks, which
    // clears calls and NOT implementations, so a persistent rejection here leaks into every test
    // after it in the file -- which it did, and it broke two unrelated rows.
    it('reports the supply as upstream-unavailable only when no call came back', async () => {
      unavailableOnce()
      unavailableOnce()
      unavailableOnce()

      expect((await generatePhrases(18)).upstreamUnavailable).toBe(true)
    })

    // ONE call coming back is enough to make the emptiness a property of what the model SENT, which
    // is still a page. Two of three fail transiently and the third succeeds.
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

    // Once per call, never mockRejectedValue: clearMocks calls mockClear, which does NOT restore the
    // beforeAll default, so a bare mockRejectedValue here leaks into every test that runs after it.
    it('returns an empty list rather than throwing when every call fails', async () => {
      jest
        .mocked(invokeModel)
        .mockRejectedValueOnce(new Error('kaboom'))
        .mockRejectedValueOnce(new Error('kaboom'))
        .mockRejectedValueOnce(new Error('kaboom'))

      expect((await generatePhrases(18)).phrases).toEqual([])
    })

    // requestBatch dedupes WITHIN a call and against the exclusion list; neither sees across calls.
    // Three independent calls asked for phrases on the same night can land on the same idiom, and
    // two identical answers in one pack is a visible defect rather than a thin one.
    it('keeps only one copy of a phrase two calls both returned', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        // Case and spacing only. A fixture with punctuation in it would be rejected by
        // ALLOWED_CHARACTERS before the dedupe ever ran, so the test would pass with the
        // cross-call dedupe deleted -- which is the shape of a test that proves nothing.
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
          text: 'The Empire Strikes Back',
        },
      ])
    })

    // Decision 4b. Digits survive vowel-stripping, so CATCH 22 would reach a Missing Vowels board
    // with its digits sitting in the display in plaintext. Gating at the phrase means no puzzle type
    // ever has to think about digits.
    it('drops a phrase containing a digit', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('Catch 22'), generated('The Empire Strikes Back')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The prose gates run over the generator's own output, not only over the reviewer's rewrites.
    it('drops a phrase whose hints are not a three-rung ladder', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [
          { ...generated('Raiders of the Lost Ark'), hints: ['only one'] },
          generated('The Empire Strikes Back'),
        ],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The behavior the deleted `constrains shape to the four tags` schema assertion used to buy,
    // moved to where it now lives. An unknown tag rejects ONE phrase instead of the whole payload:
    // on master this exact batch came back "saying" instead of "idiom" and cost the night every
    // Missing Vowels and every Cryptogram.
    it('rejects a drifted shape tag per phrase, leaving the rest of the batch standing', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Empire Strikes Back'), { ...generated('Bite the bullet'), shape: 'saying' }],
      } as never)

      const { phrases } = await generatePhrases(2)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The other half of what the deleted `requires every field a consumer reads` assertion bought.
    // Every field is re-checked per phrase now that nothing above it checks anything, and each of
    // these rows validated on master only because the schema's `required` list caught it first.
    it.each([
      ['no category', { category: undefined }],
      ['a non-string category', { category: 5 }],
      ['no shape', { shape: undefined }],
      ['hints that are not an array at all', { hints: 'A space opera sequel' }],
    ])('rejects a phrase with %s, leaving the rest of the batch standing', async (_description, overrides) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [{ ...generated('Bite the bullet'), ...overrides }, generated('The Empire Strikes Back')],
      } as never)

      const { phrases } = await generatePhrases(2)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The assertion that pins accept-before-key. On master normalizeAnswer ran FIRST and throws on a
    // missing text, so this batch threw out of generatePhrases, propagated to the handler's generic
    // catch, and cost the night's Missing Vowels and Cryptograms. It was unreachable only because
    // the tool schema's `required` list stopped it -- and that list is gone.
    it('returns the rest of the batch when one phrase has no text at all', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [{ category: 'Film', hints: ['a', 'b', 'c'], shape: 'title' }, generated('The Empire Strikes Back')],
      } as never)

      expect((await generatePhrases(2)).phrases).toEqual([expect.objectContaining({ text: 'The Empire Strikes Back' })])
    })

    it('returns the rest of the batch when one element is null', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Empire Strikes Back')] } as never)

      expect((await generatePhrases(2)).phrases).toEqual([expect.objectContaining({ text: 'The Empire Strikes Back' })])
    })

    // The log line the rejection is visible through, and the reason it reads `phrase?.shape`: the
    // element reaching it may be null.
    it('logs a rejected element without dereferencing it', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Empire Strikes Back')] } as never)

      await generatePhrases(2)

      expect(log).toHaveBeenCalledWith('Rejected a generated phrase', { shape: undefined, text: undefined })
    })

    // TWO lines per rejection, on purpose, and this pins the count so it cannot drift unnoticed the
    // way it drifted from master's one. They sit at different altitudes and neither is derivable
    // from the other: toPhrase names the PHRASE that was refused, the shared loop names WHICH element
    // of WHICH type's batch went. The loop's line is its own guarantee that a drop is recorded at
    // all -- a shared loop that delegates its audit trail to a caller-supplied gate has none, and
    // `Fetched batch` says how many were lost, never which. A null element is the input because it
    // fails on isUsable's first guard, so the prose gates add no lines of their own.
    it('logs a rejection once from the gate and once from the shared loop, and no more', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Empire Strikes Back')] } as never)

      await generatePhrases(2)

      const rejections = jest.mocked(log).mock.calls.filter(([message]) => String(message).startsWith('Rejected'))
      expect(rejections.map(([message]) => message)).toEqual(['Rejected a generated phrase', 'Rejected an item'])
    })

    // Enforced in code as well as asked for in the prompt: the model was TOLD not to reuse these,
    // and this is the backstop for when it does anyway.
    //
    // The PUNCTUATION sits on the exclusion entry, not on the generated text, and that is the only
    // arrangement that tests what the title says. An exclusion list is built from answers already
    // stored on packs, so it is the side that legitimately carries punctuation; a generated
    // `the empire strikes back!` never reaches the dedupe at all -- ALLOWED_CHARACTERS drops it at
    // the type gate first, which is what this row actually exercised before, one branch early.
    //
    // The `key` on the rejection line is the point of the assertion. On a night where the exclusion
    // list eats twenty of twenty-one phrases, a reason-only line is twenty identical lines and no
    // way to tell which twenty -- and phrasesAlreadyUsed is the load-bearing anti-repetition
    // mechanism, so this line is how it is diagnosed misfiring.
    it('drops a phrase the exclusion list already named, ignoring case and punctuation', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('the empire strikes back'), generated('Raiders of the Lost Ark')],
      } as never)

      const { phrases } = await generatePhrases(4, ['The Empire Strikes Back!'])

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Raiders of the Lost Ark'])
      expect(log).toHaveBeenCalledWith('Rejected an item', {
        index: 0,
        key: 'THEEMPIRESTRIKESBACK',
        reason: 'repeated',
        type: 'phrase',
      })
    })

    it('keeps only one copy of a phrase repeated within the batch', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Empire Strikes Back'), generated('THE EMPIRE STRIKES BACK')],
      } as never)

      expect((await generatePhrases(4)).phrases).toHaveLength(1)
    })

    // The blocklist is applied here, in code, and is deliberately never sent to the model: listing
    // slurs in a generation prompt primes toward the neighborhood being avoided.
    it('drops a phrase containing a charged word', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('No shit Sherlock'), generated('The Empire Strikes Back')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // Whole-token matching, never substring. ASSESS, COCKTAIL, and SCUNTHORPE are legitimate.
    it.each([['Assess the damage'], ['A cocktail party'], ['Scunthorpe United']])(
      'keeps %s, which only contains a charged word as a substring',
      async (text) => {
        jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated(text)] } as never)

        expect((await generatePhrases(4)).phrases).toHaveLength(1)
      },
    )

    // LLM output is untrusted, and a prompt asking for plain letters is a request rather than a
    // guarantee. A phrase the player cannot type is worse than a missing one.
    it.each([
      ['an accented character', 'Cafe Society en Espanol é'],
      ['punctuation', "Don't Look Now"],
      ['an ampersand', 'Rock & Roll'],
      ['too few words', 'Jaws'],
      ['too many words', 'One two three four five six seven'],
    ])('drops a phrase with %s', async (_description, text) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated(text), generated('The Empire Strikes Back')],
      } as never)

      const { phrases } = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The closing line moved into model-batch.ts and changed shape with it. What is asserted here
    // is the half model-batch cannot know: `challenging` is the phrase batch's own instrument, and
    // it rides on requestBatch's ONE line rather than a second one, so a night that asked for 21 and
    // got 1 shows the ask, the hard-end share, the return and the survivors together. Nothing on
    // master asserted the old `Generated phrases` line at all, which is why this is an addition
    // rather than the replacement the plan expected.
    //
    // PER CALL, since the split -- and that is the right granularity for this particular line rather
    // than a consequence to be tolerated. `asked` and `challenging` are what ONE call was told to
    // produce and `returned`/`usable` are what that same call sent back, so summing them across
    // calls would report a ratio no single call ever had and would hide the one call that came back
    // thin. The night's totals are the job of `Phrase supply measured` below, which stayed whole.
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

    // THE TWO METERS THE PROMPT CANNOT PROVIDE, and a SECOND line on purpose: `challenging` and
    // `compactPhraseCount` are what was ASKED and are known before the call, while these are what
    // LANDED and are only knowable after it. requestBatch's logContext is static by design.
    //
    // `phrazleUsable` distinguishes "the prompt is not being followed" from "the request was never
    // made", and `long` measures the new ask -- there was no meter on phrase LENGTH before, which is
    // why a batch of nothing but two-word phrases ran for weeks without registering anywhere.
    // `phrazleBand5` is the tripwire's instrument, and it exists because poolBreadth's
    // usableByDifficulty cannot see the failure: that logs only when a band finds NOTHING, measures
    // the pool REMAINING after earlier generators have spent phrases, and under a tolerance of 1
    // counts every derived-4 phrase as "usable at 5". This counts phrases deriving EXACTLY to 5 over
    // the whole returned batch, before any generator touches it.
    //
    // IT STAYED ONE LINE OVER THE WHOLE NIGHT after the split, which is the reason the fan-out lives
    // in this function rather than in the handler. phrazleBand5 is a tripwire read at day 7 and day
    // 14, and "no band-5 material tonight" is a fact about the POOL the three generators share. Three
    // per-call lines each reporting zero would have to be summed by whoever reads them, and a
    // tripwire nobody can read at a glance is not one.
    it('measures the usable supply, the long phrases and the exact-band-5 count over every call', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ phrases: [generated('Toe hold')] } as never)
        .mockResolvedValueOnce({ phrases: [generated('Too many cooks spoil the broth')] } as never)
        .mockResolvedValueOnce({ phrases: [generated('The Empire Strikes Back')] } as never)

      await generatePhrases(18)

      // EVERY COUNT ON THIS LINE IS DIFFERENT, on purpose: all three clear the floor, exactly one
      // derives to 5, and exactly two run to four words or more. A fixture where any two coincided
      // could not tell those meters apart. Toe hold derives to 1, Too many cooks spoil the broth to
      // 5 at six words, and The Empire Strikes Back to 4 at four words. They arrive from DIFFERENT
      // calls, which is what proves the meter spans the night rather than one batch.
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

    // The line still reports on a batch with nothing usable in it, which is the night the tripwire is
    // watching for -- a zero that is logged is an instrument, and a line that is absent is not.
    it('reports zeroes rather than omitting the line', async () => {
      // OVERRIDDEN, because the beforeAll default no longer produces a zero. `The Empire Strikes
      // Back` is four words of 3-7 letters and NOW CLEARS THE FLOOR -- under the old 2-3 word bound
      // it did not, which is exactly the widening this change is for, and it makes the shared default
      // useless for asserting an empty meter. CONSCIOUSNESS is thirteen letters, past
      // MAX_WORD_LETTERS, so this phrase is unusable at two words and short at the same time.
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

    // callsFailed ON THE SAME LINE as the supply it explains. A night that returns six phrases
    // instead of eighteen reads as a starved batch until you know two of three calls never came
    // back, and those two readings want opposite fixes -- one is a prompt problem, the other is a
    // budget or a throttle. Separate lines make that a join across a log group; one line makes it a
    // glance.
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

    // Returning an empty list is fine here, unlike the stored-corpus design it replaced. Nothing is
    // persisted, so there is no stale corpus to shadow -- the pack simply stays short and the next
    // retry or request tries again.
    it('returns an empty list rather than throwing when nothing survives', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated('Rock & Roll')] } as never)

      expect((await generatePhrases(4)).phrases).toEqual([])
    })
  })
})
