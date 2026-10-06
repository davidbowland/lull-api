import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { isPromptExamplePhrase } from '../assets/prompt-example-phrases'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmPhrasePromptId } from '../config'
import { derivedDifficulty, meetsStructuralFloor, reluctanceOf } from '../generators/phrazle/difficulty'
import { normalizeAnswer } from '../rules/normalize-answer'
import { Phrase, PhraseHints, PhraseShape, ToolSchema } from '../types'
import { log, logError, logWarning } from '../utils/logging'
import { isTransientModelFailure } from '../utils/model-errors'
import { containsChargedWord } from '../utils/model-output-checks'
import { passesProseGates } from '../utils/phrase-checks'
import { getRandomSample } from '../utils/random-sample'
import { requestBatch } from './model-batch'

// Exported because phraseTool.description names these tags in prose and tool-schemas.test.ts ties
// the two together. An `enum: SHAPES` in the schema cannot: a constraint below the batch key
// fails the whole payload over one bad element.
export const SHAPES: PhraseShape[] = ['compact', 'idiom', 'quote', 'title']

// Matches the phrase_rules block in prompts/create-phrases.txt, enforced here as well because LLM
// output is untrusted and a phrase the player cannot type is worse than a missing one.
const MAX_WORDS = 6
const MIN_WORDS = 2
// Letters and spaces only, on Phrase.text alone: digits survive vowel-stripping, so CATCH 22 would
// reach a Missing Vowels board in plaintext. Hints and categories are prose and may keep digits.
const ALLOWED_CHARACTERS = /^[A-Za-z ]+$/

// The share asked for at four or more words. Left to itself this prompt returns two- and
// three-word phrases almost exclusively, so a day built from the pool is one puzzle three times.
const LONG_PHRASE_SHARE = 1 / 3

// What "long" means, in one place: the context field asks for it and the closing log line
// measures it, so two literals would drift.
const MIN_LONG_PHRASE_WORDS = 4

// The most a batch may carry of phrases holding a word over phrazle's COMFORTABLE_WORD_LETTERS.
// The allocator already spends them last; this keeps the pool from being made of them.
const LONG_WORD_SHARE = 1 / 10

// Restated rather than imported from the generator: this file measures a property of the BATCH,
// so Phrazle's bands moving is a decision here.
const PHRAZLE_HARD_BAND = 5

export const phraseTool: ToolSchema = {
  // The per-field description lives here rather than in the schema: ajv sees an opaque element,
  // so this string is the only thing specifying a phrase and isUsable the only thing enforcing it.
  description:
    'Submit the phrases for this pack. Each element is an object with: `text`, the phrase itself, ' +
    'letters and spaces only, two to six words; `shape`, one of "compact", "idiom", "quote" or ' +
    '"title"; `category`, one short string naming the general kind of thing it is; and `hints`, an ' +
    'array of exactly three strings ordered from least to most revealing.',
  input_schema: {
    properties: {
      // items: {} -- an element is OPAQUE to ajv, deliberately. Measured against a 21-phrase
      // payload with one bad element: any keyword below this line, INCLUDING `type`, fails the
      // entire payload over that element, which is the opposite of a per-phrase filter.
      phrases: { items: {}, type: 'array' },
    },
    // The one surviving constraint: a payload with no `phrases` key is not a batch at all.
    required: ['phrases'],
    type: 'object',
  },
  name: 'submit_phrases',
}

// The shape a phrase has AFTER isUsable accepted it, not a claim ajv checks: an element is opaque
// to ajv, so a raw element is `unknown` until the gate below has run on it.
interface GeneratedPhrase {
  category: string
  hints: string[]
  shape: PhraseShape
  text: string
}

// A word count is not a character count: MAX_WORDS and ALLOWED_CHARACTERS still admit six
// 2000-letter words, and `text` ships as `answer` to the client. The longest real answer in the
// corpus is 23 characters, so 80 rejects a runaway without touching anything recognizable.
const MAX_TEXT_LENGTH = 80

// Takes `unknown` and narrows rather than taking GeneratedPhrase and hoping: ajv has no view of
// an element, and a raw element can be `null`.
const isUsable = (phrase: unknown): phrase is GeneratedPhrase => {
  const candidate = phrase as Partial<GeneratedPhrase> | null | undefined
  // Every field re-checked here, because nothing in the schema requires them. The typeof guards
  // run FIRST: the word count below does `text.trim()`, which throws on a missing text, and a
  // throw here is a whole-batch failure wearing the costume of a per-item filter.
  if (typeof candidate?.text !== 'string' || typeof candidate.category !== 'string') {
    return false
  }
  // An unknown shape tag rejects the phrase rather than defaulting to one: `shape` tells three
  // consumers apart, so a defaulted tag offers a phrase to a predicate as something it is not.
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
    // The prompt's own worked examples, refused -- two of them reached live boards.
    !isPromptExamplePhrase(candidate.text) &&
    // Field by field rather than by spreading `candidate`: narrowing a property does not re-type
    // the object it hangs off.
    passesProseGates({ category: candidate.category, hints: candidate.hints, text: candidate.text })
  )
}

// Gate, then build the Phrase. Returns undefined rather than throwing, and names the phrase the
// shared loop's line can only name by index.
const toPhrase = (raw: unknown): Phrase | undefined => {
  if (!isUsable(raw)) {
    // Through an optional chain: nothing has accepted this element, and the log line must not be
    // the thing that dereferences a null.
    const rejected = raw as Partial<GeneratedPhrase> | null | undefined
    log('Rejected a generated phrase', { shape: rejected?.shape, text: rejected?.text })
    return undefined
  }
  return {
    category: raw.category,
    hints: raw.hints as PhraseHints,
    shape: raw.shape,
    text: raw.text,
  }
}

// The most phrases one model call is asked for. A full night's ask fits in one call: every call
// pays the model's thinking over the whole task again, so splitting a night multiplies its cost.
// Larger requests split into balanced calls so no single call runs into create-phrases' maxTokens.
const PHRASES_PER_CALL = 16

/**
 * The per-call sizes for a request of `count`, balanced rather than filled-then-remainder.
 *
 * 18 goes out as 6/6/6 either way, but 13 goes out as 5/4/4 and not as 6/6/1: a call asked for
 * one phrase has nothing for its hint ladder to check itself against, since <hint_rules> rung 1
 * requires at least two other phrases in the batch to still fit. Zero calls for a count of zero.
 */
const callSizes = (count: number, perCall: number): number[] => {
  const calls = Math.ceil(count / perCall)
  const base = Math.floor(count / calls)
  const remainder = count % calls

  return Array.from({ length: calls }, (_unused, index) => base + (index < remainder ? 1 : 0))
}

// What one call produced, and whether it came back at all -- an empty array cannot say, and a
// batch that failed the gates and one that threw want opposite fixes.
interface PhraseBatch {
  failed: boolean
  phrases: Phrase[]
  // Why it failed, to one bit: the model service unavailable, or something a person has to fix.
  // This is what stops the handler paging per type about a supply empty because Bedrock was down.
  transient: boolean
}

/**
 * A night's phrase supply, and the one thing the handler cannot work out from the phrases alone:
 * an empty `phrases` is either a prompt problem (the page the per-type check in
 * handlers/create-phrase-puzzles.ts raises) or a Bedrock outage the SDK already retried four
 * times, which nobody can act on.
 */
export interface PhraseSupply {
  phrases: Phrase[]
  upstreamUnavailable: boolean
}

const getModelContext = (count: number, excluded: string[], random: () => number): Record<string, unknown> => ({
  // Numbers rather than prose: a described property is one the model can agree with and not
  // supply.
  longPhraseCount: Math.ceil(count * LONG_PHRASE_SHARE),
  // Floored, so a small batch is told none at all.
  maxLongWordPhrases: Math.floor(count * LONG_WORD_SHARE),
  // Sampled fresh on every call: this is the load-bearing anti-repetition mechanism. An unseeded
  // model returns the same dozen idioms every time.
  inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
  inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
  inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
  phraseCount: count,
  // The backstop seeding cannot provide. Shown to the model rather than enforced after the fact,
  // because rejecting a repeat it was never told about kills a generation for nothing.
  phrasesAlreadyUsed: excluded,
})

/**
 * One call, gated and deduped by requestBatch, and it NEVER THROWS. requestBatch rejects an item
 * and never the batch; this rejects a call and never the night. invokeModel throws on a truncated
 * generation, a throttle that outlived its retries, and a payload ajv would not validate.
 */
const requestPhraseBatch = async (count: number, excluded: string[], random: () => number): Promise<PhraseBatch> => {
  const context = getModelContext(count, excluded, random)

  try {
    // <unknown, Phrase>, not <GeneratedPhrase, Phrase>: TRaw is what came back before any gate
    // ran, and an element can be null, a number, or absent.
    const phrases = await requestBatch<unknown, Phrase>({
      // The only gate, because the tool schema describes the top level and nothing below it.
      accept: toPhrase,
      asked: count,
      context,
      // Rejected in code as well as asked for in the prompt, because LLM output is untrusted.
      excludedKeys: new Set(excluded.map(normalizeAnswer)),
      itemsOf: (payload) => (payload as { phrases: unknown[] }).phrases,
      keyOf: (phrase) => normalizeAnswer(phrase.text),
      promptId: llmPhrasePromptId,
      tool: phraseTool,
      type: 'phrase',
    })

    return { failed: false, phrases, transient: false }
  } catch (error: unknown) {
    // Level by cause: a Bedrock 503 is already four SDK attempts deep, and concurrent calls
    // meeting one outage would otherwise produce identical pages. `asked` stays on the line
    // because "a call failed" and "a third of the night's supply failed" read differently.
    const transient = isTransientModelFailure(error)
    const write = transient ? logWarning : logError
    write('Could not generate a phrase batch; keeping the other calls', { asked: count, error })
    return { failed: true, phrases: [], transient }
  }
}

// Across calls, the one dedupe requestBatch cannot do: it sees its own batch and the exclusion
// list, neither of which holds what a sibling call returned in the same second. Reuses
// model-batch's `Rejected an item` message with its own `reason`, so the Insights query
// `filter message = "Rejected an item" | stats count() by reason` stays whole.
const dedupeAcrossCalls = (batches: PhraseBatch[]): Phrase[] => {
  const seen = new Set<string>()

  return batches
    .flatMap((batch) => batch.phrases)
    .filter((phrase) => {
      const key = normalizeAnswer(phrase.text)
      if (seen.has(key)) {
        log('Rejected an item', { key, reason: 'repeated across calls', type: 'phrase' })
        return false
      }
      seen.add(key)
      return true
    })
}

/**
 * Asks the model for `count` phrases, seeded randomly and told what recent packs already used.
 *
 * One call for a night's ask; callSizes splits only a request larger than PHRASES_PER_CALL. The
 * result is returned in memory and never stored.
 *
 * Only the async puzzle builder calls this. Nothing on the request path may: a Bedrock call cannot
 * fit inside a request under any circumstances.
 */
export const generatePhrases = async (
  count: number,
  excluded: string[] = [],
  random: () => number = Math.random,
): Promise<PhraseSupply> => {
  const sizes = callSizes(count, PHRASES_PER_CALL)

  // Concurrently, because of the 900-second ceiling: reviewPhrases still needs its own call after
  // this returns.
  //
  // Promise.all never rejects here because requestPhraseBatch catches its own failure and returns
  // a batch marked failed. That is load-bearing: `all` abandons the rest on the first rejection,
  // so an uncaught throw in one call would discard two healthy batches already paid for.
  const batches = await Promise.all(sizes.map((size) => requestPhraseBatch(size, excluded, random)))
  const phrases = dedupeAcrossCalls(batches)

  // What LANDED, one line over the whole night, because these are properties of the POOL the
  // phrase generators share rather than of any one call. `phrazleBand5` counts phrases deriving EXACTLY to 5
  // over the returned batch, which poolBreadth cannot: it fires only when a band starves, sees
  // the pool remaining at that instant, and under DIFFICULTY_TOLERANCE = 1 counts every derived-4
  // phrase as usable at 5. No rejection and no retry for a light batch -- the pack already
  // degrades correctly.
  const phrazleUsable = phrases.filter((phrase) => meetsStructuralFloor(phrase))
  log('Phrase supply measured', {
    asked: count,
    calls: sizes.length,
    // Beside the supply it explains: a short supply reads as a starved batch until you know a call
    // never came back, and those want opposite fixes.
    callsFailed: batches.filter((batch) => batch.failed).length,
    long: phrases.filter((phrase) => phrase.text.trim().split(/\s+/).length >= MIN_LONG_PHRASE_WORDS).length,
    phrazleBand5: phrazleUsable.filter((phrase) => derivedDifficulty(phrase) === PHRAZLE_HARD_BAND).length,
    // Against maxLongWordPhrases: the ask is prose the model can agree with and not follow.
    phrazleLongWord: phrazleUsable.filter((phrase) => reluctanceOf(phrase) > 0).length,
    phrazleUsable: phrazleUsable.length,
    returned: phrases.length,
  })

  // Every call, and every one transient: anything less means at least one call reached the model,
  // so the handler should page. `sizes.length > 0` because `[].every(...)` is true, and a vacuous
  // "the outage explains it" is the reading this bit must never carry.
  const upstreamUnavailable = sizes.length > 0 && batches.every((batch) => batch.transient)

  return { phrases, upstreamUnavailable }
}
