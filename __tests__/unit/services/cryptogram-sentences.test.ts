import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { invokeModel } from '@services/bedrock'
import {
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
    contents: 'choose quotes',
  }

  const TEXT = 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES.'
  const GOOD = { author: null, text: 'People who live in glass houses should not throw stones.' }
  const ACCEPTED = { author: null, category: 'Proverb', text: TEXT }

  // No live randomness; getRandomSample is the only consumer.
  const fixedRandom = () => 0.5

  const fetch = (count = 1, used: string[] = [], phraseAnswers: string[] = [], apostropheAllowed = true) =>
    fetchCryptogramSentences(count, used, phraseAnswers, apostropheAllowed, fixedRandom)

  const returning = (...sentences: unknown[]) => jest.mocked(invokeModel).mockResolvedValueOnce({ sentences } as never)

  const contextOf = (): Record<string, unknown> => jest.mocked(invokeModel).mock.calls[0][2] as Record<string, unknown>

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ sentences: [GOOD] } as never)
  })

  it('reads its own prompt', async () => {
    await fetch()

    expect(getPromptById).toHaveBeenCalledWith('create-cryptogram-sentences')
  })

  it.each([
    [1, Math.max(SENTENCE_REQUEST_MULTIPLIER, MINIMUM_SENTENCE_REQUEST)],
    [2, 2 * SENTENCE_REQUEST_MULTIPLIER],
  ])('asks for enough quotes to cover %i missing puzzle(s)', async (count, asked) => {
    await fetch(count)

    expect(contextOf().sentenceCount).toEqual(asked)
  })

  it('caps the long-word quotes at one in six', async () => {
    await fetch(2)

    expect(contextOf().maxLongWordSentences).toEqual(2)
  })

  it.each([
    [true, 2],
    [false, 0],
  ])('with apostrophes allowed %p, caps the apostrophe quotes at %i', async (apostropheAllowed, cap) => {
    await fetch(2, [], [], apostropheAllowed)

    expect(contextOf().apostropheAllowed).toBe(apostropheAllowed)
    expect(contextOf().maxApostropheSentences).toEqual(cap)
  })

  it('shows the model what recent days used', async () => {
    await fetch(1, ['A FOOL AND HIS MONEY ARE SOON PARTED.'])

    expect(contextOf().sentencesAlreadyUsed).toStrictEqual(['A FOOL AND HIS MONEY ARE SOON PARTED.'])
  })

  it('seeds the context with inspiration words', async () => {
    await fetch()

    expect(contextOf().inspirationNouns).toHaveLength(10)
  })

  it('canonicalizes an accepted proverb to upper case with single spaces', async () => {
    returning({ author: null, text: '  People who live in  glass houses should not throw stones. ' })

    expect(await fetch()).toStrictEqual([ACCEPTED])
  })

  it('credits a quote to its speaker and labels it a quote', async () => {
    returning({ author: ' Thomas  jefferson ', text: 'Honesty is the first chapter in the book of wisdom.' })

    expect(await fetch()).toStrictEqual([
      { author: 'THOMAS JEFFERSON', category: 'Quote', text: 'HONESTY IS THE FIRST CHAPTER IN THE BOOK OF WISDOM.' },
    ])
  })

  it('folds a typographic apostrophe to the one the board draws', async () => {
    returning({ author: 'Mark Twain', text: 'It’s not the size of the dog in the fight, but the fight.' })

    expect((await fetch())[0].text).toEqual("IT'S NOT THE SIZE OF THE DOG IN THE FIGHT, BUT THE FIGHT.")
  })

  it.each([
    ['a non-object', 'just a string'],
    ['a missing text', { author: null }],
    // A missing author is a malformed element, not an anonymous one.
    ['a missing author', { text: GOOD.text }],
    ['a non-string author', { author: 5, text: GOOD.text }],
    ['a fragment', { author: null, text: 'A STITCH IN TIME.' }],
    ['no closing mark', { author: null, text: 'People who live in glass houses should not throw stones' }],
    ['a hyphen', { author: null, text: 'A WELL-KNOWN FOOL AND HIS MONEY ARE SOON PARTED.' }],
    ['an author past the floor', { author: 'JEAN-PAUL SARTRE', text: GOOD.text }],
    [
      'an apostrophe in both the quote and the author',
      { author: "Flannery O'Connor", text: "It's not the size of the dog in the fight, but the fight." },
    ],
    ['a British spelling', { author: null, text: 'EVERY CLOUD HAS A SILVER LINING AND A COLOUR.' }],
    ['a charged word', { author: null, text: 'DO NOT GIVE A SHIT ABOUT WHAT THEY THINK OF YOU.' }],
    [
      'a charged word in the author',
      { author: 'SHIT HEAD', text: 'HONESTY IS THE FIRST CHAPTER IN THE BOOK OF WISDOM.' },
    ],
    // The category prints above the board.
    [
      'a quote naming its own category',
      { author: 'MARK TWAIN', text: 'A QUOTE IS A LINE THAT SOMEONE ELSE ONCE SAID.' },
    ],
    ['a prompt example', { author: 'THOMAS JEFFERSON', text: PROMPT_EXAMPLE_SENTENCES[0] }],
    // A BAD example that clears the floor, so only the refusal list stops it.
    ['a bad prompt example', { author: null, text: PROMPT_EXAMPLE_SENTENCES[3] }],
  ])('drops %s and keeps the rest of the batch', async (_name, bad) => {
    returning(bad, GOOD)

    expect(await fetch()).toStrictEqual([ACCEPTED])
  })

  it('drops a quote recent days already used', async () => {
    returning(GOOD)

    expect(await fetch(1, [TEXT])).toStrictEqual([])
  })

  // The dedupe key is the quote alone: the same words are a repeat whoever is credited.
  it('drops a recent quote credited to someone new', async () => {
    returning({ author: 'MARK TWAIN', text: GOOD.text })

    expect(await fetch(1, [TEXT])).toStrictEqual([])
  })

  it('drops a quote that shipped recently as a phrase, without showing the model the phrase list', async () => {
    returning(GOOD)

    expect(await fetch(1, [], ['People who live in glass houses should not throw stones'])).toStrictEqual([])
    expect(contextOf().sentencesAlreadyUsed).toStrictEqual([])
  })

  // The shrink direction only: an example edited out of the prompt and left here fails.
  it.each(PROMPT_EXAMPLE_SENTENCES)('%s appears verbatim in the prompt', (sentence) => {
    expect(readFileSync(PROMPT_PATH, 'utf8')).toContain(sentence)
  })
})
