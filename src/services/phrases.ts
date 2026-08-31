import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmPhrasePromptId } from '../config'
import { derivedDifficulty, meetsStructuralFloor } from '../generators/phrazle/difficulty'
import { normalizeAnswer } from '../rules/normalize-answer'
import { Phrase, PhraseHints, PhraseShape, ToolSchema } from '../types'
import { log, logError } from '../utils/logging'
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

// The share of the batch asked for at FOUR OR MORE WORDS, and the reason it is asked for at all:
// left to itself this prompt returns two- and three-word phrases almost exclusively, so a day built
// from the pool is the same puzzle three times over.
//
// IT REPLACES COMPACT_SHARE, WHICH ASKED FOR THE OPPOSITE AND MEASURABLY BACKFIRED. That number fed
// a <compact_supply> section demanding "at least TWO narrow letter-sharing" phrases out of a quota
// that was itself 2 -- so the entire compact ask was spent on two-word phrases of seven letters or
// fewer, and under the old structural floor (2-3 words, 3-7 letters each) that shape has only three
// arrangements: 3+3, 3+4 and 4+3. Measured over four live calls it produced 8 narrow phrases out of
// 13 compacts, TEA LEAF and TEA SET in the same night, and two of the day's three Phrazles on the
// same shape. Deleting the section entirely was measured too: the batch still returned 10 usable
// compact phrases against a need of 3, so the quota was never load-bearing for SUPPLY -- it was only
// ever forcing the monotony.
const LONG_PHRASE_SHARE = 1 / 3

// What "long" MEANS, in one place, because two things count it: the context field asks for this many
// words or more, and the closing log line measures how many landed. Two literals would drift and the
// drift would show up as a meter that disagrees with its own request.
const MIN_LONG_PHRASE_WORDS = 4

// The band whose supply the tripwire watches, restated here rather than imported from the generator:
// this file measures a property of the BATCH, and the day Phrazle's declared bands move, the number
// this instrument reports against is a decision rather than a follow-on.
const PHRAZLE_HARD_BAND = 5

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

// How many phrases ONE model call is asked for. See the block above generatePhrases for the
// measurement this number comes from; it is a ceiling read off the live prompt, not a round number.
const PHRASES_PER_CALL = 6

/**
 * The per-call sizes for a request of `count`, BALANCED rather than filled-then-remainder.
 *
 * 18 goes out as 6/6/6 either way, but 13 goes out as 5/4/4 and not as 6/6/1 -- and a call asked for
 * ONE phrase is a call whose hint ladder has nothing to check itself against. <hint_rules> rung 1
 * requires at least two OTHER phrases in the batch to still fit, so a thin tail does not merely
 * waste a call, it asks for rungs the prompt's own self-check cannot evaluate.
 *
 * Zero calls for a count of zero, not one call asking for nothing.
 */
const callSizes = (count: number, perCall: number): number[] => {
  const calls = Math.ceil(count / perCall)
  const base = Math.floor(count / calls)
  const remainder = count % calls

  return Array.from({ length: calls }, (_unused, index) => base + (index < remainder ? 1 : 0))
}

// What one call produced, and WHETHER IT CAME BACK AT ALL -- which an empty array cannot say. A call
// whose every phrase failed the gates and a call that threw both return nothing, and those two
// readings want opposite fixes: one is a prompt that is not being followed, the other is a budget, a
// throttle or a truncation. The closing line reports them apart because this type keeps them apart.
interface PhraseBatch {
  failed: boolean
  phrases: Phrase[]
}

const getModelContext = (count: number, excluded: string[], random: () => number): Record<string, unknown> => ({
  // How many of `phraseCount` should sit at the harder end of recognizability. Handed over as a
  // number rather than described in prose, so the instruction is countable and the model has
  // something to check its own batch against.
  challengingPhraseCount: Math.ceil(count * CHALLENGING_SHARE),
  // How many of `phraseCount` should run to four words or more. Countable for the same reason
  // challengingPhraseCount is: a described property is one the model can agree with and not supply.
  longPhraseCount: Math.ceil(count * LONG_PHRASE_SHARE),
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
 * ONE call, gated and deduped by requestBatch, and it NEVER THROWS.
 *
 * This is the containment the whole split exists for. requestBatch rejects an ITEM and never the
 * batch; this rejects a CALL and never the night. invokeModel throws on a truncated generation, a
 * throttle that outlived its retries, and a payload ajv would not validate -- and until this catch
 * existed every one of those propagated to the handler and cost the pack six puzzles.
 */
const requestPhraseBatch = async (count: number, excluded: string[], random: () => number): Promise<PhraseBatch> => {
  const context = getModelContext(count, excluded, random)

  try {
    // <unknown, Phrase>, NOT <GeneratedPhrase, Phrase>. TRaw is what came back from the model before
    // any gate ran, and the tool schema deliberately describes nothing below `phrases` -- an element
    // can be null, a number, or absent. Naming GeneratedPhrase here would be the compiler agreeing
    // with a claim nothing has checked.
    const phrases = await requestBatch<unknown, Phrase>({
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

    return { failed: false, phrases }
  } catch (error: unknown) {
    // logError, because this stack's ONE alarm is a CloudWatch subscription filtering on
    // level="ERROR" and a contained failure that raises nothing is how three calls quietly become
    // one. `asked` is on the line because "a call failed" and "a third of the night's supply failed"
    // are different pages.
    logError('Could not generate a phrase batch; keeping the other calls', { asked: count, error })
    return { failed: true, phrases: [] }
  }
}

// ACROSS CALLS, which is the one dedupe requestBatch cannot do: it sees its own batch and the
// exclusion list, and neither of those contains what a SIBLING call returned in the same second.
// Three calls seeded from three independent draws still land on the same idiom often enough to
// matter, and two identical answers in one pack is a visible defect where a thin pack is only a
// short one.
//
// Reuses model-batch's `Rejected an item` message ON PURPOSE, with its own `reason`. That module
// chose one message name with the outcome in `reason` so an Insights query is
// `filter message = "Rejected an item" | stats count() by reason`; a new message name here would
// split that query in half on the day the split shipped.
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
 * SEVERAL CALLS, NOT ONE, and that is the whole of what changed on 2026-08-26. `count` is still the
 * night's ask; what it is not any more is one request. See callSizes above for the sizing and
 * requestPhraseBatch for the containment -- together they turn a truncated generation from six lost
 * puzzles into six lost phrases, out of a request that already over-asks threefold.
 *
 * The result is returned in memory and never stored. An earlier design persisted a nightly corpus
 * in its own table with a used-id set, a TTL lock, and a fallback to the most recent stored corpus.
 * All of it existed to stop many dates repeating each other out of ONE shared list, which is not a
 * problem when every build generates its own phrases from its own seed.
 *
 * Only the async puzzle builder calls this. Nothing on the request path may: a Bedrock call cannot
 * fit inside a request under any circumstances.
 *
 * Ask, gate, dedupe and log all live in services/model-batch.ts; what stays here is the context, the
 * gate, the fan-out and the one dedupe that spans calls.
 */
export const generatePhrases = async (
  count: number,
  excluded: string[] = [],
  random: () => number = Math.random,
): Promise<Phrase[]> => {
  const sizes = callSizes(count, PHRASES_PER_CALL)

  // CONCURRENTLY, and the reason is the 900-second ceiling rather than tidiness. Serial calls of six
  // cost roughly what the single call of eighteen cost -- around 170s each, measured -- and
  // CreatePhrasePuzzlesFunction still owes reviewPhrases its own call after this returns. Run
  // together they cost one call's wall clock, which is strictly less than the arrangement they
  // replace.
  //
  // Promise.all NEVER REJECTS HERE because requestPhraseBatch catches its own failure and returns a
  // batch marked failed. That is load-bearing: Promise.all rejects on the FIRST rejection and
  // abandons the rest, so an uncaught throw in one call would discard two healthy batches that had
  // already been paid for -- the exact whole-night loss this split removes, rebuilt one level up.
  const batches = await Promise.all(sizes.map((size) => requestPhraseBatch(size, excluded, random)))
  const phrases = dedupeAcrossCalls(batches)

  // THE TWO METERS THE PROMPT CANNOT PROVIDE, and a SECOND line rather than more fields on
  // requestBatch's closing one -- deliberately, because they are a different quantity. `challenging`
  // and `compactPhraseCount` are what was ASKED and are known before the call; these are what
  // LANDED and are only knowable after it. requestBatch's logContext is static by design, and
  // widening that shared seam to carry a function of the results would be a registration point
  // outside its caller.
  //
  // `phrazleUsable` is the line distinguishing "the prompt is not being followed" from "the request
  // was never made" -- the same argument `challenging` already makes. It is also what measures, for
  // real, how hard the dictionary clause cuts: a phrase clearing the structural floor whose words
  // include a proper noun counts here and is still invisible to Phrazle.
  //
  // IT WAS NAMED `compact` AND THE RENAME IS NOT COSMETIC. That word meant one specific shape -- two
  // or three words of three to seven letters -- and the floor it read no longer has that meaning:
  // meetsStructuralFloor now admits two to six words of two to eleven. A field still called
  // `compact` would be a count of something that no longer exists, read by whoever next opens the
  // log group expecting the old shape.
  //
  // `long` IS THE NEW TRIPWIRE'S INSTRUMENT and it replaces nothing -- there was no meter on phrase
  // LENGTH before, which is why a batch of nothing but two-word phrases ran for weeks without
  // registering anywhere. It counts what landed at four words or more against `longPhraseCount`,
  // which is what was asked.
  //
  // `phrazleBand5` still counts phrases deriving EXACTLY to 5, over the whole returned batch, before
  // any generator touches it: poolBreadth's usableByDifficulty logs ONLY when a band finds nothing,
  // measures the pool REMAINING at that instant, and under DIFFICULTY_TOLERANCE = 1 counts every
  // derived-4 phrase as "usable at 5".
  //
  // Read at day 7 and day 14. No rejection and no retry for a light batch: the pack already degrades
  // correctly, and a second model call to fix a countable instruction is the wrong trade.
  const phrazleUsable = phrases.filter((phrase) => meetsStructuralFloor(phrase))
  log('Phrase supply measured', {
    asked: count,
    // ONE LINE OVER THE WHOLE NIGHT, and this is why the fan-out is in this function rather than in
    // the handler. Everything below is a property of the POOL the three generators share, not of
    // whichever call a phrase arrived in, and phrazleBand5 in particular is a tripwire read at day 7
    // and day 14 -- three per-call lines each reporting zero would have to be summed by whoever
    // reads them, and a tripwire that needs arithmetic is not one.
    calls: sizes.length,
    // BESIDE the supply it explains, not on a line of its own. Six phrases where eighteen were asked
    // for reads as a starved batch until you know that two of the three calls never came back, and
    // those two readings want opposite fixes -- a prompt that is not being followed against a budget
    // or a throttle. On separate lines that is a join across a log group; here it is a glance.
    callsFailed: batches.filter((batch) => batch.failed).length,
    long: phrases.filter((phrase) => phrase.text.trim().split(/\s+/).length >= MIN_LONG_PHRASE_WORDS).length,
    phrazleBand5: phrazleUsable.filter((phrase) => derivedDifficulty(phrase) === PHRAZLE_HARD_BAND).length,
    phrazleUsable: phrazleUsable.length,
    returned: phrases.length,
  })

  return phrases
}
