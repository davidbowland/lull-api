import Ajv from 'ajv'

import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { generatePhrases, phraseTool } from '@services/phrases'
import { log } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('phrases', () => {
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

  describe('generatePhrases', () => {
    it('fetches the prompt by its configured id', async () => {
      await generatePhrases(4)

      expect(getPromptById).toHaveBeenCalledWith('create-phrases')
    })

    it('asks for the number of phrases requested', async () => {
      await generatePhrases(9)

      expect(invokeModel).toHaveBeenCalledWith(prompt, phraseTool, expect.objectContaining({ phraseCount: 9 }))
    })

    // Cryptogram derives its difficulty almost entirely from the reviewer's familiarity rating, so
    // its hardest declared band can only be filled by a phrase that is NOT instantly named by
    // everyone. Left to itself the prompt returns a batch rated 4 and 5 across the board, which is a
    // pool with nothing in that band and a pack one cryptogram short every night. Asking for a count
    // rather than describing a spread in prose gives the model something to check its batch against.
    it.each([
      [21, 7],
      [10, 4],
      [9, 3],
    ])('asks for a hard-end share of a batch of %i', async (count, challenging) => {
      await generatePhrases(count)

      expect(invokeModel).toHaveBeenCalledWith(
        prompt,
        phraseTool,
        expect.objectContaining({ challengingPhraseCount: challenging }),
      )
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

    it('returns a phrase per usable result', async () => {
      expect(await generatePhrases(4)).toEqual([
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

      const phrases = await generatePhrases(4)

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

      const phrases = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The behaviour the deleted `constrains shape to the four tags` schema assertion used to buy,
    // moved to where it now lives. An unknown tag rejects ONE phrase instead of the whole payload:
    // on master this exact batch came back "saying" instead of "idiom" and cost the night every
    // Missing Vowels and every Cryptogram.
    it('rejects a drifted shape tag per phrase, leaving the rest of the batch standing', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('The Empire Strikes Back'), { ...generated('Bite the bullet'), shape: 'saying' }],
      } as never)

      const phrases = await generatePhrases(2)

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

      const phrases = await generatePhrases(2)

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

      await expect(generatePhrases(2)).resolves.toEqual([expect.objectContaining({ text: 'The Empire Strikes Back' })])
    })

    it('returns the rest of the batch when one element is null', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [null, generated('The Empire Strikes Back')] } as never)

      await expect(generatePhrases(2)).resolves.toEqual([expect.objectContaining({ text: 'The Empire Strikes Back' })])
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

      const phrases = await generatePhrases(4, ['The Empire Strikes Back!'])

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

      expect(await generatePhrases(4)).toHaveLength(1)
    })

    // The blocklist is applied here, in code, and is deliberately never sent to the model: listing
    // slurs in a generation prompt primes toward the neighborhood being avoided.
    it('drops a phrase containing a charged word', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('No shit Sherlock'), generated('The Empire Strikes Back')],
      } as never)

      const phrases = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // Whole-token matching, never substring. ASSESS, COCKTAIL, and SCUNTHORPE are legitimate.
    it.each([['Assess the damage'], ['A cocktail party'], ['Scunthorpe United']])(
      'keeps %s, which only contains a charged word as a substring',
      async (text) => {
        jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated(text)] } as never)

        expect(await generatePhrases(4)).toHaveLength(1)
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

      const phrases = await generatePhrases(4)

      expect(phrases.map((phrase) => phrase.text)).toEqual(['The Empire Strikes Back'])
    })

    // The closing line moved into model-batch.ts and changed shape with it. What is asserted here
    // is the half model-batch cannot know: `challenging` is the phrase batch's own instrument, and
    // it rides on requestBatch's ONE line rather than a second one, so a night that asked for 21 and
    // got 1 shows the ask, the hard-end share, the return and the survivors together. Nothing on
    // master asserted the old `Generated phrases` line at all, which is why this is an addition
    // rather than the replacement the plan expected.
    it('closes with one asked/returned/usable line carrying the challenging count', async () => {
      await generatePhrases(21)

      expect(log).toHaveBeenCalledWith('Fetched batch', {
        asked: 21,
        challenging: 7,
        returned: 1,
        type: 'phrase',
        usable: 1,
      })
    })

    // Returning an empty list is fine here, unlike the stored-corpus design it replaced. Nothing is
    // persisted, so there is no stale corpus to shadow -- the pack simply stays short and the next
    // retry or request tries again.
    it('returns an empty list rather than throwing when nothing survives', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated('Rock & Roll')] } as never)

      expect(await generatePhrases(4)).toEqual([])
    })
  })
})
