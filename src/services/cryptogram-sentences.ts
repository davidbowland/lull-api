import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import {
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmCryptogramPromptId,
} from '../config'
import {
  COMFORTABLE_WORD_LETTERS,
  MAX_LETTERS,
  MAX_WORD_LETTERS,
  MAX_WORDS,
  MIN_LETTERS,
  MIN_WORDS,
  meetsSentenceFloor,
} from '../generators/cryptogram/sentence'
import { normalizeAnswer } from '../rules/normalize-answer'
import { ToolSchema } from '../types'
import { log } from '../utils/logging'
import {
  containsAnswerToken,
  containsBritishSpelling,
  containsChargedWord,
  passesStringGates,
} from '../utils/model-output-checks'
import { getRandomSample } from '../utils/random-sample'
import { requestBatch } from './model-batch'

// One puzzle a day from a batch this size: the floor and the dedupe each cost a share, and the
// allocator needs spare sentences to pass over the ones with long words.
export const SENTENCE_REQUEST_MULTIPLIER = 6
export const MINIMUM_SENTENCE_REQUEST = 6

// At most one sentence in this many may carry a word over COMFORTABLE_WORD_LETTERS. Candidates ship
// in model order, so this is roughly how often a cryptogram carries a long word.
const SENTENCES_PER_LONG_WORD = 6

// The examples prompts/create-cryptogram-sentences.txt prints, good and bad, refused as
// submissions. Exported so a test can pin each one to the prompt verbatim.
export const PROMPT_EXAMPLE_SENTENCES = [
  'A WATCHED POT NEVER BOILS BUT A WATCHED CLOCK ALWAYS SEEMS TO STOP',
  'IT IS NOT ENOUGH TO BE BUSY SO ARE THE ANTS',
  'NECESSITY IS THE MOTHER OF INVENTION',
]
const promptExampleKeys = new Set(PROMPT_EXAMPLE_SENTENCES.map(normalizeAnswer))

// A label such as "Proverb" or "Mark Twain", so it gets a label's cap rather than a hint's.
export const MAX_CATEGORY_LENGTH = 40

export const sentenceTool: ToolSchema = {
  // Elements are opaque to ajv, so this string is the model's only specification of one.
  description:
    'Submit the sentences for this pack. Each element of `sentences` is an object with: `text`, one ' +
    `complete sentence of ${MIN_WORDS} to ${MAX_WORDS} words and ${MIN_LETTERS} to ${MAX_LETTERS} letters, ` +
    `letters and spaces only, no word over ${MAX_WORD_LETTERS} letters; and \`category\`, a short label ` +
    'naming its source or kind, such as "Proverb" or "Benjamin Franklin", that repeats no word of the sentence.',
  input_schema: {
    properties: {
      // items: {} -- any keyword below the batch key fails the whole payload over one element.
      sentences: { items: {}, type: 'array' },
    },
    required: ['sentences'],
    type: 'object',
  },
  name: 'submit_sentences',
}

export interface CryptogramSentence {
  category: string
  text: string
}

/**
 * Narrows `unknown` one element at a time and never throws, so a bad element costs itself alone.
 * `text` ships as `answer` and `category` is rendered verbatim, so both are content-gated here.
 */
const toSentence = (raw: unknown): CryptogramSentence | undefined => {
  const candidate = raw as Partial<CryptogramSentence> | null | undefined
  const text = candidate?.text
  const category = candidate?.category
  const usable =
    typeof text === 'string' &&
    meetsSentenceFloor(text) &&
    !promptExampleKeys.has(normalizeAnswer(text)) &&
    !containsChargedWord(text) &&
    // The player types the answer letter by letter, so COLOUR is unsolvable rather than misspelled.
    !containsBritishSpelling(text) &&
    // `answer` set, so a category naming a word of the sentence is refused.
    passesStringGates({ answer: text, maxLength: MAX_CATEGORY_LENGTH, value: category }) &&
    // The strict variant as well: the leak gate skips short and function words, and in a cryptogram
    // a three-letter word is a foothold, so "Cat proverb" over a sentence holding CAT gives away
    // three letters.
    !containsAnswerToken(text, category as string)
  if (!usable) {
    log('Rejected a cryptogram sentence', { text: typeof text === 'string' ? text : undefined })
    return undefined
  }
  return { category: (category as string).trim(), text: text.trim().replace(/\s+/g, ' ').toUpperCase() }
}

const getModelContext = (sentenceCount: number, used: string[], random: () => number) => ({
  comfortableWordLetters: COMFORTABLE_WORD_LETTERS,
  // An independent draw from the other calls' samples, so two calls in one night do not correlate.
  inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
  inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
  inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
  maxLongWordSentences: Math.floor(sentenceCount / SENTENCES_PER_LONG_WORD),
  sentenceCount,
  // Shown as well as enforced: rejecting a repeat the model was never told about wastes a slot.
  sentencesAlreadyUsed: used,
})

/**
 * One model call for `max(count * 6, 6)` sentences, gated and deduped per sentence against recent
 * cryptograms and recent phrase answers. A short batch is a shortfall the generator logs, never a
 * retry.
 */
export const fetchCryptogramSentences = async (
  count: number,
  used: string[],
  phraseAnswers: string[],
  random: () => number = Math.random,
): Promise<CryptogramSentence[]> => {
  const sentenceCount = Math.max(count * SENTENCE_REQUEST_MULTIPLIER, MINIMUM_SENTENCE_REQUEST)

  return requestBatch<unknown, CryptogramSentence>({
    accept: toSentence,
    asked: sentenceCount,
    context: getModelContext(sentenceCount, used, random),
    // Phrase answers are refused in code and kept out of the prompt: a six-word proverb can be both
    // a phrase and a sentence, but the phrase list is hundreds long and almost never collides.
    excludedKeys: new Set([...used, ...phraseAnswers].map(normalizeAnswer)),
    itemsOf: (payload) => (payload as { sentences: unknown[] }).sentences,
    keyOf: (sentence) => normalizeAnswer(sentence.text),
    promptId: llmCryptogramPromptId,
    tool: sentenceTool,
    type: 'cryptogram',
  })
}
