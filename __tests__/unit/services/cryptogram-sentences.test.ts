import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { invokeModel } from '@services/bedrock'
import {
  MAX_CATEGORY_LENGTH,
  MINIMUM_SENTENCE_REQUEST,
  PROMPT_EXAMPLE_SENTENCES,
  SENTENCE_REQUEST_MULTIPLIER,
  fetchCryptogramSentences,
} from '@services/cryptogram-sentences'
import { getPromptById } from '@services/dynamodb'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

const PROMPT_PATH = join(__dirname, '..', '..', '..', 'prompts', 'create-cryptogram-sentences.txt')

describe('cryptogram-sentences', () => {
  const prompt = {
    config: { anthropicVersion: 'bedrock-2023-05-31', maxTokens: 32000, model: 'a-model', thinkingEffort: 'low' },
    contents: 'write sentences',
  }

  const GOOD = { category: 'Proverb', text: 'People who live in glass houses should not throw stones' }

  // No live randomness; getRandomSample is the only consumer.
  const fixedRandom = () => 0.5

  const returning = (...sentences: unknown[]) => jest.mocked(invokeModel).mockResolvedValueOnce({ sentences } as never)

  const contextOf = (): Record<string, unknown> => jest.mocked(invokeModel).mock.calls[0][2] as Record<string, unknown>

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ sentences: [GOOD] } as never)
  })

  it('reads its own prompt', async () => {
    await fetchCryptogramSentences(1, [], [], fixedRandom)

    expect(getPromptById).toHaveBeenCalledWith('create-cryptogram-sentences')
  })

  it.each([
    [1, Math.max(SENTENCE_REQUEST_MULTIPLIER, MINIMUM_SENTENCE_REQUEST)],
    [2, 2 * SENTENCE_REQUEST_MULTIPLIER],
  ])('asks for enough sentences to cover %i missing puzzle(s)', async (count, asked) => {
    await fetchCryptogramSentences(count, [], [], fixedRandom)

    expect(contextOf().sentenceCount).toEqual(asked)
  })

  it('caps the long-word sentences at one in six', async () => {
    await fetchCryptogramSentences(2, [], [], fixedRandom)

    expect(contextOf().maxLongWordSentences).toEqual(2)
  })

  it('shows the model what recent days used', async () => {
    await fetchCryptogramSentences(1, ['A FOOL AND HIS MONEY ARE SOON PARTED'], [], fixedRandom)

    expect(contextOf().sentencesAlreadyUsed).toStrictEqual(['A FOOL AND HIS MONEY ARE SOON PARTED'])
  })

  it('seeds the context with inspiration words', async () => {
    await fetchCryptogramSentences(1, [], [], fixedRandom)

    expect(contextOf().inspirationNouns).toHaveLength(10)
  })

  it('canonicalizes an accepted sentence to upper case with single spaces', async () => {
    returning({ category: 'Proverb', text: '  People who live in  glass houses should not throw stones ' })

    expect(await fetchCryptogramSentences(1, [], [], fixedRandom)).toStrictEqual([
      { category: 'Proverb', text: 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES' },
    ])
  })

  it.each([
    ['a non-object', 'just a string'],
    ['a missing text', { category: 'Proverb' }],
    ['a missing category', { text: GOOD.text }],
    ['a fragment', { category: 'Proverb', text: 'A STITCH IN TIME' }],
    ['punctuation', { category: 'Proverb', text: 'WHEN IN ROME, DO AS THE ROMANS DO TODAY' }],
    ['a British spelling', { category: 'Proverb', text: 'EVERY CLOUD HAS A SILVER LINING AND A COLOUR' }],
    ['a charged word', { category: 'Proverb', text: 'DO NOT GIVE A SHIT ABOUT WHAT THEY THINK OF YOU' }],
    ['a category naming a word of the sentence', { category: 'Glass houses', text: GOOD.text }],
    // Under the leak gate's four-letter floor, and still a foothold in a cryptogram.
    ['a category naming a short word of the sentence', { category: 'Who said', text: GOOD.text }],
    ['an over-length category', { category: 'c'.repeat(MAX_CATEGORY_LENGTH + 1), text: GOOD.text }],
    ['a prompt example', { category: 'Proverb', text: PROMPT_EXAMPLE_SENTENCES[0] }],
    // A BAD example that clears the floor, so only the refusal list stops it.
    ['a bad prompt example', { category: 'Proverb', text: PROMPT_EXAMPLE_SENTENCES[2] }],
  ])('drops %s and keeps the rest of the batch', async (_name, bad) => {
    returning(bad, GOOD)

    expect(await fetchCryptogramSentences(1, [], [], fixedRandom)).toStrictEqual([
      { category: 'Proverb', text: 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES' },
    ])
  })

  it('trims the category it ships', async () => {
    returning({ category: ' Proverb ', text: GOOD.text })

    expect((await fetchCryptogramSentences(1, [], [], fixedRandom))[0].category).toEqual('Proverb')
  })

  it('drops a sentence recent days already used', async () => {
    returning(GOOD)

    expect(
      await fetchCryptogramSentences(1, ['PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES'], [], fixedRandom),
    ).toStrictEqual([])
  })

  it('drops a sentence that shipped recently as a phrase, without showing the model the phrase list', async () => {
    returning(GOOD)

    expect(
      await fetchCryptogramSentences(1, [], ['People who live in glass houses should not throw stones'], fixedRandom),
    ).toStrictEqual([])
    expect(contextOf().sentencesAlreadyUsed).toStrictEqual([])
  })

  // The shrink direction only: an example edited out of the prompt and left here fails.
  it.each(PROMPT_EXAMPLE_SENTENCES)('%s appears verbatim in the prompt', (sentence) => {
    expect(readFileSync(PROMPT_PATH, 'utf8')).toContain(sentence)
  })
})
