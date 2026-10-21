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
  MAX_AUTHOR_LENGTH,
  MAX_LETTERS,
  MAX_TEXT_LENGTH,
  MAX_WORD_LETTERS,
  MAX_WORDS,
  MIN_LETTERS,
  MIN_WORDS,
  exceedsApostrophes,
  meetsAuthorFloor,
  meetsSentenceFloor,
  renderAnswer,
} from '../generators/cryptogram/sentence'
import { normalizeAnswer } from '../rules/normalize-answer'
import { ToolSchema } from '../types'
import { log } from '../utils/logging'
import { containsAnswerToken, containsBritishSpelling, containsChargedWord } from '../utils/model-output-checks'
import { getRandomSample } from '../utils/random-sample'
import { requestBatch } from './model-batch'

// One puzzle a day from a batch this size: the floor and the dedupe each cost a share, and the
// allocator needs spare quotes to pass over the ones with long words.
export const SENTENCE_REQUEST_MULTIPLIER = 6
export const MINIMUM_SENTENCE_REQUEST = 6

// At most one quote in this many may carry a word over COMFORTABLE_WORD_LETTERS, and, when any may,
// one in this many an apostrophe. Candidates ship in model order, so this is roughly how often a
// cryptogram carries either.
const SENTENCES_PER_LONG_WORD = 6
const SENTENCES_PER_APOSTROPHE = 6

// The examples prompts/create-cryptogram-sentences.txt prints, good and bad, refused as
// submissions. Exported so a test can pin each one to the prompt verbatim.
export const PROMPT_EXAMPLE_SENTENCES = [
  'WHEN ANGRY, COUNT TO TEN BEFORE YOU SPEAK; IF VERY ANGRY, A HUNDRED.',
  'ALL THAT GLISTERS IS NOT GOLD; OFTEN HAVE YOU HEARD THAT TOLD.',
  'A JOURNEY OF A THOUSAND MILES BEGINS WITH A SINGLE STEP.',
  'THE PICKLE IN THE JAR IS SOUR, BUT THE DAY IS SWEET.',
]
const promptExampleKeys = new Set(PROMPT_EXAMPLE_SENTENCES.map(normalizeAnswer))

// Assigned here rather than asked of the model: the speaker is part of the puzzle, so a category
// naming them would print the solution above the board.
export const CATEGORIES = { proverb: 'Proverb', quote: 'Quote' } as const
// The label's cap, kept above both values; worst-case.ts restates it.
export const MAX_CATEGORY_LENGTH = 40

export const sentenceTool: ToolSchema = {
  // Elements are opaque to ajv, so this string is the model's only specification of one.
  description:
    'Submit the quotations for this pack. Each element of `sentences` is an object with: `text`, one ' +
    `real quotation or traditional proverb, word for word, of ${MIN_WORDS} to ${MAX_WORDS} words and ` +
    `${MIN_LETTERS} to ${MAX_LETTERS} letters, at most ${MAX_TEXT_LENGTH} characters, no word over ` +
    `${MAX_WORD_LETTERS} letters, using only letters, spaces and the punctuation ' , . ? ! ; : and ending ` +
    `in . ? or !; and \`author\`, the speaker's name as commonly known, at most ${MAX_AUTHOR_LENGTH} ` +
    'characters, or null for a proverb.',
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
  author: string | null
  category: string
  text: string
}

// Upper case, single spaces, and a typographic apostrophe folded to the one the board draws.
const canonical = (value: string): string => value.trim().replace(/\s+/g, ' ').replace(/’/g, "'").toUpperCase()

/**
 * Narrows `unknown` one element at a time and never throws, so a bad element costs itself alone.
 * The rendered answer ships verbatim, so the whole of it is content-gated here.
 */
const toSentence = (raw: unknown): CryptogramSentence | undefined => {
  const candidate = raw as { author?: unknown; text?: unknown } | null | undefined
  const rawText = candidate?.text
  const rawAuthor = candidate?.author
  const reject = (): undefined => {
    log('Rejected a cryptogram sentence', { text: typeof rawText === 'string' ? rawText : undefined })
    return undefined
  }
  // `null` is a proverb; a missing author is a malformed element, not an anonymous one.
  if (typeof rawText !== 'string' || (rawAuthor !== null && typeof rawAuthor !== 'string')) {
    return reject()
  }
  const text = canonical(rawText)
  const author = rawAuthor === null ? null : canonical(rawAuthor)
  const category = author === null ? CATEGORIES.proverb : CATEGORIES.quote
  const answer = renderAnswer(text, author)
  const usable =
    meetsSentenceFloor(text) &&
    (author === null || meetsAuthorFloor(author)) &&
    !exceedsApostrophes(answer) &&
    !promptExampleKeys.has(normalizeAnswer(text)) &&
    !containsChargedWord(answer) &&
    // The player types the answer letter by letter, so COLOUR is unsolvable rather than misspelled.
    !containsBritishSpelling(answer) &&
    // The strict leak gate: the category prints above the board, and QUOTE in a quote is five free
    // letters.
    !containsAnswerToken(answer, category)
  return usable ? { author, category, text } : reject()
}

const getModelContext = (sentenceCount: number, used: string[], apostropheAllowed: boolean, random: () => number) => ({
  apostropheAllowed,
  comfortableWordLetters: COMFORTABLE_WORD_LETTERS,
  // An independent draw from the other calls' samples, so two calls in one night do not correlate.
  inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
  inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
  inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
  maxApostropheSentences: apostropheAllowed ? Math.floor(sentenceCount / SENTENCES_PER_APOSTROPHE) : 0,
  maxLongWordSentences: Math.floor(sentenceCount / SENTENCES_PER_LONG_WORD),
  sentenceCount,
  // Shown as well as enforced: rejecting a repeat the model was never told about wastes a slot.
  sentencesAlreadyUsed: used,
})

/**
 * One model call for `max(count * 6, 6)` quotes, gated and deduped per quote against recent
 * cryptograms and recent phrase answers. The dedupe key is the quote alone, so the same words are a
 * repeat whoever is credited. A short batch is a shortfall the generator logs, never a retry.
 */
export const fetchCryptogramSentences = async (
  count: number,
  used: string[],
  phraseAnswers: string[],
  apostropheAllowed: boolean,
  random: () => number = Math.random,
): Promise<CryptogramSentence[]> => {
  const sentenceCount = Math.max(count * SENTENCE_REQUEST_MULTIPLIER, MINIMUM_SENTENCE_REQUEST)

  return requestBatch<unknown, CryptogramSentence>({
    accept: toSentence,
    asked: sentenceCount,
    context: getModelContext(sentenceCount, used, apostropheAllowed, random),
    // Phrase answers are refused in code and kept out of the prompt: a six-word proverb can be both
    // a phrase and a quote, but the phrase list is hundreds long and almost never collides.
    excludedKeys: new Set([...used, ...phraseAnswers].map(normalizeAnswer)),
    itemsOf: (payload) => (payload as { sentences: unknown[] }).sentences,
    keyOf: (sentence) => normalizeAnswer(sentence.text),
    promptId: llmCryptogramPromptId,
    tool: sentenceTool,
    type: 'cryptogram',
  })
}
