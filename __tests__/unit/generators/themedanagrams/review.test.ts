import { readFileSync } from 'fs'
import { join } from 'path'

import { ANAGRAM_VERDICTS, anagramReviewTool, reviewAnagramSets } from '@generators/themedanagrams/review'
import { WORDS_PER_PUZZLE } from '@generators/themedanagrams/words'
import { AnagramSet } from '@services/anagram-sets'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { Prompt } from '@types'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

// Five words, so a one-word trim leaves exactly the four a puzzle ships and a two-word trim does not.
const thieves = (overrides: Partial<AnagramSet> = {}): AnagramSet => ({
  form: 'singular nouns: people',
  theme: 'Thieves and theft',
  words: ['BURGLAR', 'ROBBERY', 'ROBBER', 'MUGGER', 'POACHER'],
  ...overrides,
})

const kitchen = (): AnagramSet => ({
  theme: 'Kitchen tools',
  words: ['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN'],
})

describe('reviewAnagramSets', () => {
  const mockInvokeModel = jest.mocked(invokeModel)

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue({} as Prompt)
    mockInvokeModel.mockResolvedValue({ verdicts: [{ index: 0, verdict: 'keep' }] })
  })

  const context = (): Record<string, any> => mockInvokeModel.mock.calls[0][2] as Record<string, any>

  describe('the tool', () => {
    it.each([...ANAGRAM_VERDICTS])('names the %s verdict', (verdict) => {
      expect(anagramReviewTool.description).toContain(`"${verdict}"`)
    })

    // Removal is the only edit applyTrim can make; this pins that the reviewer is told so.
    it('forbids adding or rewriting a word', () => {
      expect(anagramReviewTool.description).toContain('Never add a word and never rewrite a word or a theme')
    })
  })

  describe('the prompt', () => {
    const prompt = readFileSync(join(__dirname, '../../../../prompts/review-anagram-sets.txt'), 'utf8')

    // applyTrim drops a set left under WORDS_PER_PUZZLE; the prose number must say the same.
    it('states the word floor applyTrim enforces', () => {
      expect(WORDS_PER_PUZZLE).toEqual(4)
      expect(prompt).toContain('at least FOUR good ones remain')
      expect(prompt).toContain('fewer than FOUR good words would remain')
    })

    it('asks about both theme fit and agreement in form and kind', () => {
      expect(prompt).toContain('DOES EVERY WORD PLAINLY BELONG TO THE THEME?')
      expect(prompt).toContain('DO ALL THE WORDS TAKE THE SAME FORM AND KIND?')
      expect(prompt).toContain('BURGLAR, ROBBERY, FELONY')
    })
  })

  describe('the context', () => {
    it('sends each set its index, theme, form and every admitted word', async () => {
      await reviewAnagramSets([thieves(), kitchen()])

      expect(JSON.parse(JSON.stringify(context()))).toStrictEqual({
        sets: [
          {
            form: 'singular nouns: people',
            index: 0,
            theme: 'Thieves and theft',
            words: ['BURGLAR', 'ROBBERY', 'ROBBER', 'MUGGER', 'POACHER'],
          },
          // No form key at all once serialized, which is what the prompt describes.
          { index: 1, theme: 'Kitchen tools', words: ['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN'] },
        ],
      })
    })

    it('makes no call at all for an empty batch', async () => {
      expect(await reviewAnagramSets([])).toStrictEqual([])
      expect(mockInvokeModel).not.toHaveBeenCalled()
    })
  })

  describe('verdicts', () => {
    it('keeps a set the reviewer kept, unchanged', async () => {
      const set = thieves()

      expect(await reviewAnagramSets([set])).toStrictEqual([set])
    })

    it('drops a set the reviewer dropped, and logs why', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, reason: 'mixed kinds', verdict: 'drop' },
          { index: 1, verdict: 'keep' },
        ],
      })

      expect(await reviewAnagramSets([thieves(), kitchen()])).toStrictEqual([kitchen()])
      expect(log).toHaveBeenCalledWith('Reviewer dropped an anagram set', {
        reason: 'mixed kinds',
        theme: 'Thieves and theft',
      })
    })

    // Order is the model's ranking and entriesAt ships the first four, so a trim must not reorder.
    it('removes only the named words, in any case, and keeps the rest in order', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ index: 0, reason: 'an act among people', remove: ['robbery'], verdict: 'trim' }],
      })

      const [set] = await reviewAnagramSets([thieves()])

      expect(set.words).toStrictEqual(['BURGLAR', 'ROBBER', 'MUGGER', 'POACHER'])
      expect(set.form).toEqual('singular nouns: people')
      expect(log).toHaveBeenCalledWith('Reviewer trimmed an anagram set', {
        reason: 'an act among people',
        removed: ['ROBBERY'],
        theme: 'Thieves and theft',
      })
    })

    it('drops a set a trim leaves below the words a puzzle ships', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, remove: ['ROBBERY', 'POACHER'], verdict: 'trim' },
          { index: 1, verdict: 'keep' },
        ],
      })

      expect(await reviewAnagramSets([thieves(), kitchen()])).toStrictEqual([kitchen()])
      expect(log).toHaveBeenCalledWith('Reviewed anagram sets', {
        dropped: 0,
        kept: 1,
        trimmed: 0,
        trimmedBelowFloor: 1,
        unjudged: 0,
      })
    })

    it.each([
      ['no remove field', undefined],
      ['a remove that is not an array', 'ROBBERY'],
      ['only words the set never held', ['FELONY']],
      ['only non-strings', [42, null]],
    ])('treats a trim with %s as a keep', async (_name, remove) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, remove, verdict: 'trim' }] })
      const set = thieves()

      expect(await reviewAnagramSets([set])).toStrictEqual([set])
      expect(log).toHaveBeenCalledWith('Treated a trim that removed nothing as a keep', { theme: 'Thieves and theft' })
    })

    it.each([
      ['an unknown verdict word', { index: 0, verdict: 'DROP' }],
      ['an index out of range', { index: 5, verdict: 'drop' }],
      ['a non-integer index', { index: '0', verdict: 'drop' }],
      ['a null verdict', null],
    ])('ignores %s and keeps the set it would have reached', async (_name, verdict) => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [verdict, { index: 1, verdict: 'keep' }],
      })

      expect(await reviewAnagramSets([thieves(), kitchen()])).toStrictEqual([thieves(), kitchen()])
      expect(log).toHaveBeenCalledWith('Ignored an unusable anagram verdict', expect.any(Object))
    })

    it('honors only the first verdict for an index', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, verdict: 'keep' },
          { index: 0, verdict: 'drop' },
        ],
      })

      expect(await reviewAnagramSets([thieves()])).toHaveLength(1)
    })

    it('counts every outcome on one summary line', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, remove: ['ROBBERY'], verdict: 'trim' },
          { index: 1, verdict: 'keep' },
        ],
      })

      await reviewAnagramSets([thieves(), kitchen(), kitchen()])

      expect(log).toHaveBeenCalledWith('Reviewed anagram sets', {
        dropped: 0,
        kept: 1,
        trimmed: 1,
        trimmedBelowFloor: 0,
        unjudged: 1,
      })
    })
  })

  describe('failure', () => {
    it('ships the batch unreviewed when the call throws', async () => {
      mockInvokeModel.mockRejectedValueOnce(new Error('Bedrock said no'))

      expect(await reviewAnagramSets([thieves()])).toStrictEqual([thieves()])
      expect(logError).toHaveBeenCalledWith('Could not review anagram sets; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
    })

    it('warns rather than alarming when the reviewer is unavailable', async () => {
      mockInvokeModel.mockRejectedValueOnce(
        Object.assign(new Error('Bedrock is unable to process your request'), {
          $fault: 'server',
          $metadata: { attempts: 4, httpStatusCode: 503 },
        }),
      )

      expect(await reviewAnagramSets([thieves()])).toStrictEqual([thieves()])
      expect(logWarning).toHaveBeenCalledWith('Could not review anagram sets; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
      expect(logError).not.toHaveBeenCalled()
    })

    it('ships the batch unreviewed when the prompt cannot be read', async () => {
      jest.mocked(getPromptById).mockRejectedValueOnce(new Error('No such prompt'))

      expect(await reviewAnagramSets([thieves()])).toHaveLength(1)
      expect(logError).toHaveBeenCalled()
    })

    // This type is not best-effort: a unanimous rejection would cost the night all three puzzles.
    it('keeps the batch when the reviewer removes every set', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, verdict: 'drop' },
          { index: 1, verdict: 'drop' },
        ],
      })

      expect(await reviewAnagramSets([thieves(), kitchen()])).toStrictEqual([thieves(), kitchen()])
      expect(logError).toHaveBeenCalledWith('Reviewer removed every anagram set; keeping the batch unreviewed', {
        count: 2,
      })
    })

    it('keeps the batch when no verdict can be addressed', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ setIndex: 0, verdict: 'drop' }] })

      expect(await reviewAnagramSets([thieves()])).toStrictEqual([thieves()])
      expect(logError).toHaveBeenCalledWith('Reviewer judged no anagram set; keeping the batch unreviewed', {
        count: 1,
      })
    })

    it('survives a response carrying no verdicts array at all', async () => {
      mockInvokeModel.mockResolvedValueOnce({})

      expect(await reviewAnagramSets([thieves()])).toStrictEqual([thieves()])
    })
  })
})
