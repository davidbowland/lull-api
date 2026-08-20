import Ajv from 'ajv'

import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { generatePhrases, phraseTool } from '@services/phrases'

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
    // bedrock.ts compiles this with ajv and validates every model payload against it, so these are
    // real gates rather than documentation.
    it('requires every field a consumer reads', () => {
      expect(phraseTool.input_schema.properties.phrases.items.required).toEqual(
        expect.arrayContaining(['text', 'shape', 'category', 'hints']),
      )
    })

    it('constrains shape to the four tags consumers know', () => {
      expect(phraseTool.input_schema.properties.phrases.items.properties.shape.enum).toEqual([
        'compact',
        'idiom',
        'quote',
        'title',
      ])
    })

    // Run against the REAL schema through ajv, exactly as bedrock.ts does, rather than against the
    // code behind it. Every constraint on `hints` is a whole-BATCH gate -- ajv validates the entire
    // payload, so one drifted ladder in ten costs all ten phrases. The tests below the mock cover
    // what happens to a bad ladder that gets through; these cover the schema letting it through in
    // the first place.
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

    // Enforced in code as well as asked for in the prompt: the model was TOLD not to reuse these,
    // and this is the backstop for when it does anyway.
    it('drops a phrase the exclusion list already named, ignoring case and punctuation', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [generated('the empire strikes back!'), generated('Raiders of the Lost Ark')],
      } as never)

      const phrases = await generatePhrases(4, ['The Empire Strikes Back'])

      expect(phrases.map((phrase) => phrase.text)).toEqual(['Raiders of the Lost Ark'])
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

    // Returning an empty list is fine here, unlike the stored-corpus design it replaced. Nothing is
    // persisted, so there is no stale corpus to shadow -- the pack simply stays short and the next
    // retry or request tries again.
    it('returns an empty list rather than throwing when nothing survives', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [generated('Rock & Roll')] } as never)

      expect(await generatePhrases(4)).toEqual([])
    })
  })
})
