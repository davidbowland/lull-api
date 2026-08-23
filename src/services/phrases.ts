import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmPhrasePromptId } from '../config'
import { normalizeAnswer } from '../rules/normalize-answer'
import { Phrase, PhraseHints, PhraseShape, ToolSchema } from '../types'
import { log } from '../utils/logging'
import { containsChargedWord } from '../utils/model-output-checks'
import { DEFAULT_FAMILIARITY, passesProseGates } from '../utils/phrase-checks'
import { getRandomSample } from '../utils/random-sample'
import { requestBatch } from './model-batch'

// Exported for ONE reason: phraseTool.description below names these tags in prose, and prose does
// not reference a constant. The `enum: SHAPES` that used to tie the two together was removed
// because a constraint below the batch key fails the whole payload over one bad element -- and it
// took the coupling with it, so a fifth shape would update this list and leave the model never told
// the tag exists. tool-schemas.test.ts reads this list and asserts the description names every
// entry. Nothing in src/ imports it.
export const SHAPES: PhraseShape[] = ['compact', 'idiom', 'quote', 'title']

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

export const phraseTool: ToolSchema = {
  // The per-field description moved HERE from the schema, because under the tool-schema rule ajv
  // sees an OPAQUE element and the model would otherwise be told nothing about one. This string is
  // the only thing that specifies a phrase to the model; isUsable is the only thing that enforces
  // it. That is a genuine downgrade in how the request is specified, and it buys a per-phrase
  // filter where a whole-batch failure used to be.
  description:
    'Submit the phrases for this pack. Each element is an object with: `text`, the phrase itself, ' +
    'letters and spaces only, two to six words; `shape`, one of "compact", "idiom", "quote" or ' +
    '"title"; `category`, one short string naming the general kind of thing it is; and `hints`, an ' +
    'array of exactly three strings ordered from least to most revealing.',
  input_schema: {
    properties: {
      // items: {} -- an element is OPAQUE to ajv, deliberately. Measured on this repo's ajv against
      // a 21-phrase payload with one bad element: ANY keyword below this line, INCLUDING `type`,
      // fails the ENTIRE payload over that one element. That is the exact opposite of a per-phrase
      // filter, and it is the live bug this replaces -- one model returning "saying" instead of
      // "idiom" cost the night every Missing Vowels and every Cryptogram.
      phrases: { items: {}, type: 'array' },
    },
    // The one surviving constraint, and it is at the top level: a payload with no `phrases` key is
    // not a batch at all, there is nothing to iterate, and there is nothing left to filter per item.
    required: ['phrases'],
    type: 'object',
  },
  name: 'submit_phrases',
}

// The shape a phrase has AFTER isUsable accepted it. It is no longer a claim ajv checks -- under the
// tool-schema rule an element is opaque to ajv, so a raw element is `unknown` until the gate below
// has run on it.
interface GeneratedPhrase {
  category: string
  hints: string[]
  shape: PhraseShape
  text: string
}

// A WORD count is not a character count. MAX_WORDS caps the phrase at six words and
// ALLOWED_CHARACTERS keeps them letters, which together still admit six 2000-letter words -- and
// `text` ships as `answer` on every phrase puzzle, so that reaches the client. The longest real
// answer in the corpus is 23 characters ("The Empire Strikes Back"); this rejects a runaway
// generation without touching anything a player would recognize.
const MAX_TEXT_LENGTH = 80

// Takes `unknown` and NARROWS, rather than taking GeneratedPhrase and hoping. Under the tool-schema
// rule ajv is given no view of an element at all, so `unknown` is the only honest parameter type --
// and phrases.test.ts proves a raw element can be `null`, which GeneratedPhrase excludes. `candidate`
// is the one cast, it is `Partial`, and it lives INSIDE the gate where every field it names is
// checked on the lines below. Annotating the parameter instead would let a future caller write
// `raw.text.toUpperCase()` with the compiler's blessing and find out on a null element in production.
const isUsable = (phrase: unknown): phrase is GeneratedPhrase => {
  const candidate = phrase as Partial<GeneratedPhrase> | null | undefined
  // Every field re-checked here, because NOTHING in the schema requires them any more -- that is
  // deliberate, and it makes this function the only gate. The typeof guards run FIRST: the word
  // count below does `text.trim()`, which THROWS on a missing text, and a throw here is a
  // whole-batch failure wearing the costume of a per-item filter.
  if (typeof candidate?.text !== 'string' || typeof candidate.category !== 'string') {
    return false
  }
  // An unknown shape tag REJECTS the phrase rather than defaulting to one. `shape` is the field that
  // tells three consumers apart, and a defaulted tag is a silent lie in exactly that field: a phrase
  // retagged `idiom` would be offered to a predicate as something it is not. Rejection costs one
  // phrase and is visible in the log line.
  if (!SHAPES.includes(candidate.shape as PhraseShape)) {
    return false
  }
  if (!Array.isArray(candidate.hints)) {
    return false
  }
  const words = candidate.text.trim().split(/\s+/)
  return (
    ALLOWED_CHARACTERS.test(candidate.text) &&
    candidate.text.length <= MAX_TEXT_LENGTH &&
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    !containsChargedWord(candidate.text) &&
    // Field by field rather than by spreading `candidate`: ProseCandidate.text is a plain `string`,
    // and narrowing a property does not re-type the object it hangs off.
    passesProseGates({ category: candidate.category, hints: candidate.hints, text: candidate.text })
  )
}

// The accept half: gate, then build the Phrase. Returns undefined rather than throwing, and logs its
// own reason -- the shared loop's line names the type and the index, this one names the phrase.
const toPhrase = (raw: unknown): Phrase | undefined => {
  if (!isUsable(raw)) {
    // Read off a Partial through an optional chain, because nothing has accepted this element and
    // the log line must not be the thing that dereferences a null.
    const rejected = raw as Partial<GeneratedPhrase> | null | undefined
    log('Rejected a generated phrase', { shape: rejected?.shape, text: rejected?.text })
    return undefined
  }
  return {
    category: raw.category,
    // Stamped on every phrase the generator returns. The reviewer overwrites it; this default is
    // what survives when review does not run, so Phrase.familiarity is total and no consumer has to
    // handle an absent rating.
    familiarity: DEFAULT_FAMILIARITY,
    hints: raw.hints as PhraseHints,
    shape: raw.shape,
    text: raw.text,
  }
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
 *
 * Ask, gate, dedupe and log all live in services/model-batch.ts; what stays here is the context and
 * the gate.
 */
export const generatePhrases = async (
  count: number,
  excluded: string[] = [],
  random: () => number = Math.random,
): Promise<Phrase[]> => {
  const context = getModelContext(count, excluded, random)

  // <unknown, Phrase>, NOT <GeneratedPhrase, Phrase>. TRaw is what came back from the model before
  // any gate ran, and the tool schema deliberately describes nothing below `phrases` -- an element
  // can be null, a number, or absent. Naming GeneratedPhrase here would be the compiler agreeing
  // with a claim nothing has checked.
  return requestBatch<unknown, Phrase>({
    // The ONLY gate, because the tool schema describes the top level and nothing below it. isUsable
    // runs its typeof guards first and never throws.
    accept: toPhrase,
    asked: count,
    context,
    // Rejected in code as well as asked for in the prompt, because LLM output is untrusted: a
    // prompt asking for plain letters is a request rather than a guarantee, and a phrase the player
    // cannot type is worse than a missing one.
    excludedKeys: new Set(excluded.map(normalizeAnswer)),
    itemsOf: (payload) => (payload as { phrases: unknown[] }).phrases,
    keyOf: (phrase) => normalizeAnswer(phrase.text),
    // What was ASKED of the model at the hard end. The reviewer's familiarity spread is what
    // actually landed, and having both in the log group is what distinguishes a prompt that is not
    // being followed from a request that was never made. It rides on requestBatch's closing line
    // rather than a second one, so asked/returned/usable/challenging stay together.
    logContext: { challenging: context.challengingPhraseCount },
    promptId: llmPhrasePromptId,
    tool: phraseTool,
    type: 'phrase',
  })
}
