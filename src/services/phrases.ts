import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmPhrasePromptId } from '../config'
import { normalizeAnswer } from '../rules/normalize-answer'
import { HintLadder, Phrase, PhraseShape, ToolSchema } from '../types'
import { log } from '../utils/logging'
import { DEFAULT_FAMILIARITY, containsChargedWord, passesProseGates } from '../utils/phrase-checks'
import { getRandomSample } from '../utils/random-sample'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

const SHAPES: PhraseShape[] = ['compact', 'idiom', 'quote', 'title']

// Matches the phrase_rules block in prompts/create-phrases.txt. Enforced here as well because LLM
// output is untrusted -- a prompt asking for plain letters is a request, not a guarantee, and a
// phrase the player cannot type is worse than a missing one.
const MAX_WORDS = 6
const MIN_WORDS = 2
// Letters and spaces only. Digits survive vowel-stripping, so CATCH 22 would reach a Missing Vowels
// board with its digits in plaintext. Hints and categories are prose and may still contain digits --
// "a 1977 film" is a legitimate rung. Only Phrase.text is constrained.
const ALLOWED_CHARACTERS = /^[A-Za-z ]+$/

// The share of the batch asked for at the harder end of recognizability, and the reason it is asked
// for at all: Cryptogram derives its difficulty almost entirely from the reviewer's familiarity
// rating, so its hardest declared band can only be filled by a phrase that is NOT instantly named by
// everyone. Left to itself the prompt returns a batch the reviewer rates 4 and 5 across the board,
// which is a pool with nothing in that band -- and a pack one cryptogram short every single night.
//
// A share rather than a count, because the request scales with what a full pack needs. A third of a
// batch is enough to cover the hard bands of every phrase type without turning a day's puzzles into
// a trivia round: this is a spread, not a difficulty setting.
const CHALLENGING_SHARE = 1 / 3

// bedrock.ts compiles this with ajv and validates every model payload against it, so the required
// list and the shape enum are real gates rather than documentation.
export const phraseTool: ToolSchema = {
  description:
    'Submit the phrases for this pack. Every phrase needs a shape tag, one category naming the general kind of thing it is, and three hints ordered from least to most revealing.',
  input_schema: {
    properties: {
      phrases: {
        items: {
          properties: {
            category: { type: 'string' },
            // No minItems/maxItems AND no items, deliberately -- all three are banned for the same
            // reason. bedrock.ts validates the model's whole payload against this same object with
            // ajv, so any constraint here fails the ENTIRE batch over one malformed phrase: a count
            // bound over a two-rung ladder, an element type over a single hint the model returned as
            // an object instead of a string. That is the exact opposite of a per-phrase filter. Both
            // the count and the element types are enforced by isHintLadder in phrase-checks, where a
            // violation costs one phrase.
            hints: { type: 'array' },
            shape: { enum: SHAPES, type: 'string' },
            text: { type: 'string' },
          },
          required: ['text', 'shape', 'category', 'hints'],
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
  category: string
  hints: string[]
  shape: PhraseShape
  text: string
}

const isUsable = (phrase: GeneratedPhrase): boolean => {
  const words = phrase.text.trim().split(/\s+/)
  return (
    ALLOWED_CHARACTERS.test(phrase.text) &&
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    !containsChargedWord(phrase.text) &&
    passesProseGates(phrase)
  )
}

const getModelContext = (count: number, excluded: string[], random: () => number): Record<string, unknown> => ({
  // How many of `phraseCount` should sit at the harder end of recognizability. Handed over as a
  // number rather than described in prose, so the instruction is countable and the model has
  // something to check its own batch against.
  challengingPhraseCount: Math.ceil(count * CHALLENGING_SHARE),
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
      category: phrase.category,
      // Stamped on every phrase the generator returns. The reviewer overwrites it; this default is
      // what survives when review does not run, so Phrase.familiarity is total and no consumer has
      // to handle an absent rating.
      familiarity: DEFAULT_FAMILIARITY,
      hints: phrase.hints as HintLadder,
      shape: phrase.shape,
      text: phrase.text,
    })
  }

  log('Generated phrases', {
    asked: count,
    // What was ASKED of the model at the hard end. The reviewer's familiarity spread is what
    // actually landed, and having both in the log group is what distinguishes a prompt that is not
    // being followed from a request that was never made.
    challenging: context.challengingPhraseCount,
    returned: phrases.length,
    usable: usable.length,
  })
  return usable
}
