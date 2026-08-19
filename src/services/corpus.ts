import { createHash } from 'node:crypto'

import { adjectives } from '../assets/adjectives'
import { chargedWords } from '../assets/blocklist'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import {
  corpusPhraseCount,
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmCorpusPromptId,
} from '../config'
import { normalizeAnswer } from '../rules/normalize-answer'
import { CorpusEntry, PhraseShape, ToolSchema } from '../types'
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
// list and the shape enum are real gates rather than documentation. A response missing a tag is
// rejected outright rather than filling the corpus with entries no consumer can select on.
export const corpusTool: ToolSchema = {
  description:
    'Submit the nightly phrase corpus. Every phrase needs a shape tag and two category labels at different specificities.',
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
  name: 'submit_phrase_corpus',
}

interface GeneratedPhrase {
  categoryBroad: string
  categorySpecific: string
  shape: PhraseShape
  text: string
}

// Derived from the normalized text so the same phrase carries the same id on every night it
// appears. That is what keeps a usedIds set meaningful when a later corpus repeats an earlier
// phrase. 12 hex characters is 48 bits, which keeps collisions negligible across years of nightly
// corpora without putting a full hash in every stored entry.
const entryId = (text: string): string => createHash('sha256').update(normalizeAnswer(text)).digest('hex').slice(0, 12)

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

const getModelContext = (random: () => number): Record<string, unknown> => ({
  inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
  inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
  inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
  phraseCount: corpusPhraseCount,
})

/**
 * Runs the one nightly Bedrock call and returns the phrases that survive validation.
 *
 * Only CreateCorpusFunction calls this. Nothing on the request path may: a Bedrock call cannot fit
 * inside a request under any circumstances, which is why the corpus is stored and merely read by
 * the generators.
 */
export const generateCorpus = async (random: () => number = Math.random): Promise<CorpusEntry[]> => {
  const prompt = await getPromptById(llmCorpusPromptId)
  const context = getModelContext(random)

  const { phrases } = await invokeModel<{ phrases: GeneratedPhrase[] }>(prompt, corpusTool, context)

  const entries: CorpusEntry[] = []
  const seen = new Set<string>()
  for (const phrase of phrases) {
    if (!isUsable(phrase)) {
      log('Rejected a generated phrase', { shape: phrase.shape, text: phrase.text })
      continue
    }
    const id = entryId(phrase.text)
    // Deduped on the derived id, so two phrases differing only in case or spacing collapse.
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    entries.push({
      categoryBroad: phrase.categoryBroad,
      categorySpecific: phrase.categorySpecific,
      id,
      shape: phrase.shape,
      text: phrase.text,
    })
  }

  // Throwing beats returning an empty list, and the difference is the whole fallback. An empty
  // corpus written to the table becomes the MOST RECENT corpus and shadows the previous night's
  // good one -- turning one bad model call into three dead puzzle types. Throwing here leaves the
  // older corpus as the newest stored, which is exactly what the consumers should draw from.
  if (entries.length === 0) {
    throw new Error(`Corpus generation returned no usable phrases from ${phrases.length} candidates`)
  }

  log('Generated corpus', { generated: phrases.length, usable: entries.length })
  return entries
}
