import { corpusEntries } from '../__mocks__'
import { invokeModel } from '@services/bedrock'
import { corpusTool, ensureCorpus, generateCorpus } from '@services/corpus'
import { claimCorpusGeneration, getLatestCorpus, getPromptById, setCorpus } from '@services/dynamodb'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('corpus', () => {
  const prompt = {
    config: { anthropicVersion: 'bedrock-2023-05-31', maxTokens: 16000, model: 'a-model', thinkingEffort: 'high' },
    contents: 'generate phrases',
  }

  const phrase = (text: string, shape = 'title') => ({
    categoryBroad: 'Film',
    categorySpecific: 'A specific film',
    shape,
    text,
  })

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ phrases: [phrase('The Empire Strikes Back')] } as never)
  })

  describe('corpusTool', () => {
    // The tool's input_schema is compiled by ajv in bedrock.ts and every model payload is validated
    // against it, so these are real gates rather than documentation.
    it('requires every field a consumer reads', () => {
      expect(corpusTool.input_schema.properties.phrases.items.required).toEqual(
        expect.arrayContaining(['text', 'shape', 'categorySpecific', 'categoryBroad']),
      )
    })

    it('constrains shape to the four tags consumers know', () => {
      expect(corpusTool.input_schema.properties.phrases.items.properties.shape.enum).toEqual([
        'compact',
        'idiom',
        'quote',
        'title',
      ])
    })
  })

  describe('generateCorpus', () => {
    it('fetches the prompt by its configured id', async () => {
      await generateCorpus()

      expect(getPromptById).toHaveBeenCalledWith('create-phrase-corpus')
    })

    it('asks the model for the configured number of phrases', async () => {
      await generateCorpus()

      expect(invokeModel).toHaveBeenCalledWith(prompt, corpusTool, expect.objectContaining({ phraseCount: 30 }))
    })

    // An unseeded model asked for phrases returns the same idioms every night, and one prompt
    // supplies a whole night of content for three puzzle types.
    it('seeds the context with inspiration words', async () => {
      await generateCorpus()

      const context = jest.mocked(invokeModel).mock.calls[0][2] as Record<string, string[]>
      expect(context.inspirationNouns).toHaveLength(10)
      expect(context.inspirationVerbs).toHaveLength(8)
      expect(context.inspirationAdjectives).toHaveLength(5)
    })

    it('returns an entry per surviving phrase', async () => {
      expect(await generateCorpus()).toEqual([
        expect.objectContaining({
          categoryBroad: 'Film',
          categorySpecific: 'A specific film',
          shape: 'title',
          text: 'The Empire Strikes Back',
        }),
      ])
    })

    // Stable across nights, so a usedIds set stays meaningful when a later corpus repeats a phrase.
    it('derives an id that ignores case, spacing, and punctuation', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [phrase('The Empire Strikes Back')] } as never)
      const [first] = await generateCorpus()

      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [phrase('the empire strikes back')] } as never)
      const [second] = await generateCorpus()

      expect(first.id).toEqual(second.id)
    })

    it('gives different phrases different ids', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [phrase('The Empire Strikes Back'), phrase('Raiders of the Lost Ark')],
      } as never)

      const entries = await generateCorpus()

      expect(entries[0].id).not.toEqual(entries[1].id)
    })

    // The blocklist is applied here, in code, and is deliberately never sent to the model: listing
    // slurs in a generation prompt primes toward the neighborhood being avoided.
    it('drops a phrase containing a charged word', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [phrase('No shit Sherlock'), phrase('The Empire Strikes Back')],
      } as never)

      const entries = await generateCorpus()

      expect(entries).toHaveLength(1)
      expect(entries[0].text).toEqual('The Empire Strikes Back')
    })

    // Whole-token matching, never substring. ASSESS, COCKTAIL, and SCUNTHORPE are legitimate.
    it.each([['Assess the damage'], ['A cocktail party'], ['Scunthorpe United']])(
      'keeps %s, which only contains a charged word as a substring',
      async (text) => {
        jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [phrase(text)] } as never)

        expect(await generateCorpus()).toHaveLength(1)
      },
    )

    // LLM output is untrusted, and the prompt asking for plain letters is not a guarantee. A phrase
    // the player cannot type is worse than a missing one.
    // Paired with a valid phrase so the assertion is "this one was dropped" rather than "the whole
    // corpus was empty", which throws for a different reason entirely.
    it.each([
      ['an accented character', 'Cafe Society en Espanol é'],
      ['punctuation', "Don't Look Now"],
      ['an ampersand', 'Rock & Roll'],
    ])('drops a phrase containing %s', async (_description, text) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [phrase(text), phrase('The Empire Strikes Back')],
      } as never)

      const entries = await generateCorpus()

      expect(entries).toHaveLength(1)
      expect(entries[0].text).toEqual('The Empire Strikes Back')
    })

    it.each([
      ['too short', 'Jaws'],
      ['too long', 'One two three four five six seven'],
    ])('drops a phrase that is %s', async (_description, text) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [phrase(text), phrase('The Empire Strikes Back')],
      } as never)

      const entries = await generateCorpus()

      expect(entries).toHaveLength(1)
      expect(entries[0].text).toEqual('The Empire Strikes Back')
    })

    it('keeps only one copy of a repeated phrase', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        phrases: [phrase('The Empire Strikes Back'), phrase('THE EMPIRE STRIKES BACK')],
      } as never)

      expect(await generateCorpus()).toHaveLength(1)
    })

    // The critical one. An empty corpus written to the table becomes the MOST RECENT corpus and
    // shadows the previous night's good one -- turning a bad model call into three dead puzzle
    // types, which is precisely what the fallback exists to prevent. Throwing leaves the older
    // corpus as the newest stored, so the fallback works.
    it('throws rather than returning an empty corpus', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ phrases: [phrase('Rock & Roll')] } as never)

      await expect(generateCorpus()).rejects.toThrow('no usable phrases')
    })
  })

  describe('ensureCorpus', () => {
    const setup = (): void => {
      jest.mocked(getLatestCorpus).mockResolvedValue(undefined as never)
      jest.mocked(claimCorpusGeneration).mockResolvedValue(true as never)
      jest.mocked(setCorpus).mockResolvedValue(true as never)
    }

    // Any corpus at all is enough, because the consumers fall back to the most recent stored one.
    // Paying for a model call to replace a corpus that is merely a day old would spend real money
    // to fix nothing.
    it('does not generate when a corpus is already stored', async () => {
      setup()
      jest.mocked(getLatestCorpus).mockResolvedValueOnce({ date: '2026-06-14', entries: corpusEntries, usedIds: [] })

      expect(await ensureCorpus('2026-06-15')).toBe(true)
      expect(invokeModel).not.toHaveBeenCalled()
      expect(claimCorpusGeneration).not.toHaveBeenCalled()
    })

    it('generates and stores a corpus when none exists', async () => {
      setup()

      expect(await ensureCorpus('2026-06-15')).toBe(true)
      expect(invokeModel).toHaveBeenCalled()
      expect(setCorpus).toHaveBeenCalledWith('2026-06-15', expect.any(Array))
    })

    // The claim, not the write, is what stops concurrent model calls. setCorpus is conditional too,
    // but it is only checked AFTER generation -- so without this, eight prefetched dates would each
    // pay for a Bedrock call and seven would discard the result.
    it('makes no model call when another run holds the claim', async () => {
      setup()
      jest.mocked(claimCorpusGeneration).mockResolvedValueOnce(false as never)

      expect(await ensureCorpus('2026-06-15')).toBe(false)
      expect(invokeModel).not.toHaveBeenCalled()
    })

    it('claims before calling the model, never after', async () => {
      setup()

      await ensureCorpus('2026-06-15')

      expect(jest.mocked(claimCorpusGeneration).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(invokeModel).mock.invocationCallOrder[0],
      )
    })

    it('still reports a corpus available when another run wrote one first', async () => {
      setup()
      jest.mocked(setCorpus).mockResolvedValueOnce(false as never)

      expect(await ensureCorpus('2026-06-15')).toBe(true)
    })
  })
})
