import { adjectives } from '../assets/adjectives'
import { chargedWords } from '../assets/blocklist'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmPhrasePromptId } from '../config'
import { normalizeAnswer } from '../rules/normalize-answer'
import { Phrase, PhraseShape, ToolSchema } from '../types'
import { log } from '../utils/logging'
import { getRandomSample } from '../utils/random-sample'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

const SHAPES: PhraseShape[] = ['compact', 'idiom', 'quote', 'title']

// Matches the phrase_rules block in prompts/create-phrase-corpus.txt. Enforced here as well
// because LLM output is untrusted -- a prompt asking for plain letters is a request, not a
// guarantee, and a phrase the player cannot type is worse than a missing one.
const MAX_WORDS = 6
const MIN_WORDS = 2
const ALLOWED_CHARACTERS = /^[A-Za-z0-9 ]+$/

// bedrock.ts compiles this with ajv and validates every model payload against it, so the required
// list and the shape enum are real gates rather than documentation.
export const phraseTool: ToolSchema = {
  description:
    'Submit the phrases for this pack. Every phrase needs a shape tag and two category labels at different specificities.',
  input_schema: {
    properties: {
      phrases: {
        items: {
          properties: {
            categoryBroad: { type: 'string' },
            categorySpecific: { type: 'string' },
            shape: { enum: SHAPES, type: 'string' },
            text: { type: 'string' },
          },
          required: ['text', 'shape', 'categorySpecific', 'categoryBroad'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['phrases'],
    type: 'object',
  },
  name: 'submit_phrases',
}

interface GeneratedPhrase {
  categoryBroad: string
  categorySpecific: string
  shape: PhraseShape
  text: string
}

// Whole-token and case-insensitive, NEVER substring: ASSESS, COCKTAIL, and SCUNTHORPE are
// legitimate. Splitting on the letter runs rather than on spaces means punctuation cannot smuggle
// a token past the check.
const containsChargedWord = (text: string): boolean =>
  (text.toUpperCase().match(/[A-Z]+/g) ?? []).some((token) => chargedWords.has(token))

const isUsable = (phrase: GeneratedPhrase): boolean => {
  const words = phrase.text.trim().split(/\s+/)
  return (
    ALLOWED_CHARACTERS.test(phrase.text) &&
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    !containsChargedWord(phrase.text)
  )
}

const getModelContext = (count: number, excluded: string[], random: () => number): Record<string, unknown> => ({
  // Sampled fresh on every call, and this is the load-bearing anti-repetition mechanism rather
  // than a nicety. An unseeded model asked for phrases returns the same dozen idioms every time;
  // different seeds are why two packs built days apart do not collide in the first place.
  inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
  inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
  inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
  phraseCount: count,
  // The backstop the seeding cannot provide: a list of phrases recent packs already used. Shown to
  // the model rather than enforced after the fact, because rejecting a repeat the model was never
  // told about kills a generation with no way for it to have done better.
  phrasesAlreadyUsed: excluded,
})

/**
 * Asks the model for `count` phrases, seeded randomly and told what recent packs already used.
 *
 * The result is returned in memory and never stored. An earlier design persisted a nightly corpus
 * in its own table with a used-id set, a TTL lock, and a fallback to the most recent stored corpus.
 * All of it existed to stop many dates repeating each other out of ONE shared list, which is not a
 * problem when every build generates its own phrases from its own seed.
 *
 * Only the async puzzle builder calls this. Nothing on the request path may: a Bedrock call cannot
 * fit inside a request under any circumstances.
 */
export const generatePhrases = async (
  count: number,
  excluded: string[] = [],
  random: () => number = Math.random,
): Promise<Phrase[]> => {
  const prompt = await getPromptById(llmPhrasePromptId)
  const context = getModelContext(count, excluded, random)

  const { phrases } = await invokeModel<{ phrases: GeneratedPhrase[] }>(prompt, phraseTool, context)

  // Rejected in code as well as asked for in the prompt, because LLM output is untrusted: a prompt
  // asking for plain letters is a request rather than a guarantee, and a phrase the player cannot
  // type is worse than a missing one.
  const excludedKeys = new Set(excluded.map(normalizeAnswer))
  const seen = new Set<string>()
  const usable: Phrase[] = []
  for (const phrase of phrases) {
    const key = normalizeAnswer(phrase.text)
    if (!isUsable(phrase)) {
      log('Rejected a generated phrase', { shape: phrase.shape, text: phrase.text })
      continue
    }
    // Deduped within the batch AND against the exclusions, on the normalized text, so a phrase
    // differing only in case or punctuation still collapses.
    if (seen.has(key) || excludedKeys.has(key)) {
      log('Skipped a repeated phrase', { text: phrase.text })
      continue
    }
    seen.add(key)
    usable.push({
      categoryBroad: phrase.categoryBroad,
      categorySpecific: phrase.categorySpecific,
      shape: phrase.shape,
      text: phrase.text,
    })
  }

  log('Generated phrases', { asked: count, returned: phrases.length, usable: usable.length })
  return usable
}
