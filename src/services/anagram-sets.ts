import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import { inspirationAdjectivesCount, inspirationNounsCount, inspirationVerbsCount, llmAnagramPromptId } from '../config'
import {
  MAX_WORD_LENGTH,
  MIN_WORD_LENGTH,
  WORDS_PER_PUZZLE,
  WORDS_REQUESTED,
  WordGate,
  wordGateFailure,
} from '../generators/themedanagrams/words'
import { normalizeAnswer } from '../rules/normalize-answer'
import { ToolSchema } from '../types'
import { log, logError } from '../utils/logging'
import { leaksAnswerTokens, passesStringGates } from '../utils/model-output-checks'
import { getRandomSample } from '../utils/random-sample'
import { requestBatch } from './model-batch'

// The ask. Rejection here runs at TWO levels -- per word and per set -- so the multiplier is higher
// than the phrase batch's 3x, and the within-unit over-ask of six-asked-four-shipped is what keeps it
// at 4 rather than the much larger number pure set-level rejection would demand.
export const SET_REQUEST_MULTIPLIER = 4

// It binds on exactly one kind of night and is therefore easy to mistake for dead code. `count` is
// the number of MISSING puzzles, so a repair run that needs one puzzle would otherwise ask for four
// sets -- a coin flip against two-level rejection, on a night that is already a repair.
export const MINIMUM_SET_REQUEST = 8

// 120 is sized for a category that may be a descriptive phrase; a theme is one to four words.
// Reusing a number chosen for a different string is how a cap stops being a bound.
export const MAX_THEME_LENGTH = 40
export const MAX_THEME_WORDS = 4

// A POSITIVE WHITELIST, which is affordable here and deliberately refused for prose: a theme is a
// short label, not a sentence. Digits are allowed but may never lead, so "1980s toys" survives.
//
// IT EXCLUDES `;`, and that is load-bearing rather than incidental. `&` survives escapeXml
// unescaped, so a stored theme reaches the next twenty nights' prompts with its ampersand intact --
// but without a semicolon it can never carry a literal `&lt;` or `&#60;` to be interpreted after
// escaping. That is why `&` is affordable in a label that round-trips through an XML-structured
// prompt.
export const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

export const anagramSetTool: ToolSchema = {
  // The description does the work the schema is forbidden to do. Under `items: {}` an element is
  // OPAQUE to ajv, so this string is the only thing that specifies a set to the model -- it names
  // both keys, both types, the word count, the length band and the two cross-set rules. A
  // one-sentence description here would pay the cost of the opaque element and buy nothing.
  //
  // INTERPOLATED FROM THE CONSTANTS, never retyped. This string said "an array of six strings, each
  // one single English word of 5 to 9 letters" while WORDS_REQUESTED was 8 and MIN_WORD_LENGTH was
  // 6 -- the schema description telling the model one thing and the context block another, in the
  // one place that is the model's ONLY specification of an element. It was missed twice, by the
  // change that moved each number, because prose does not typecheck. Now it cannot drift: move a
  // constant and this sentence moves with it.
  description:
    'Submit themed word sets for this pack. Call once with every set. Each element of `sets` is an ' +
    'object with two keys: `theme`, a string of at most four words naming a category; and `words`, ' +
    `an array of ${WORDS_REQUESTED} strings, each one single English word of ${MIN_WORD_LENGTH} to ` +
    `${MAX_WORD_LENGTH} letters that belongs to that theme, ordered best first; and \`seed\`, the one ` +
    'inspiration word from the context block that this theme came from, copied exactly. Use a ' +
    'different seed for every set. No proper nouns, no ' +
    'hyphens, no apostrophes, no accents. Do not repeat a word across ' +
    'sets, and do not use a word that appears in the theme.',
  input_schema: {
    properties: {
      // items: {} -- an element is opaque to ajv, on purpose. ANY keyword below this line, INCLUDING
      // `type`, fails the ENTIRE payload over one malformed element, which is the opposite of a
      // per-set filter. At two levels of nesting the blast radius is strictly worse: a per-item
      // `required: ['theme', 'words']` would fail all twelve sets over one set missing one key,
      // which is three puzzles and a night.
      sets: { items: {}, type: 'array' },
    },
    // The one surviving constraint, and it is at the top level: a payload with no `sets` key is not a
    // batch at all, and there is nothing left for a per-item filter to do.
    required: ['sets'],
    type: 'object',
  },
  name: 'submit_anagram_sets',
}

// The shape a set has AFTER the gates ran. `words` are UPPERCASE and already admissible.
//
// `seed` is REPORTING, NOT A GATE, and it never reaches the wire. Asking the model to name the
// inspiration word each theme came from is itself most of the enforcement -- a set that has to
// declare its seed is a set that has to have one -- and it makes compliance countable where it was
// previously invisible. Rejecting on it was considered and deliberately not done: the cost of a
// wrong self-report is a discarded set and a thinner night, against a rule the model already
// follows closely. `toCandidate` reads only `theme` and `words`, so this dies with the batch.
export interface AnagramSet {
  seed?: string
  theme: string
  words: string[]
}

// Why a set was dropped. `setsDiscarded` alone reads identically for a model that returned malformed
// JSON and one that named its own answers in every theme, and those two want opposite fixes.
export type SetRejection = 'belowWordFloor' | 'shape' | 'themeGate' | 'themeLeak'

/*
 * How well the model followed the seeding rule, over the sets that SURVIVED.
 *
 * The seeds are the whole anti-repetition mechanism -- measured over live calls the model maps them
 * to themes very nearly one-for-one, so the collision rate of the pools is the repetition rate of
 * the game -- and until the model was asked to name the seed, whether it used them at all was
 * unmeasurable. `Weather` turning up on a night whose seeds contain nothing weather-shaped is the
 * failure this counts.
 *
 * THREE NUMBERS BECAUSE THEY FAIL DIFFERENTLY. `named` short of the set count is a model ignoring
 * the field; `fromPool` short of `named` is a model inventing seeds it was never given, which is the
 * same fallback wearing a label; `distinct` short of `named` is two themes off one seed, which is
 * the convergence the "different seed per set" rule exists to stop. A single compliance percentage
 * would average all three into a number that names none of them.
 */
export interface SeedUse {
  distinct: number
  fromPool: number
  named: number
}

export interface AnagramSetBatch {
  droppedByGate: Record<WordGate, number>
  seedUse: SeedUse
  sets: AnagramSet[]
  setsDiscardedByReason: Record<SetRejection, number>
  setsReturned: number
}

const emptyGateCounts = (): Record<WordGate, number> => ({
  blocklist: 0,
  charset: 0,
  duplicateInBatch: 0,
  length: 0,
  multiplicity: 0,
  notUnique: 0,
  permutations: 0,
  recentlyUsed: 0,
  tokens: 0,
})

const emptyRejectionCounts = (): Record<SetRejection, number> => ({
  belowWordFloor: 0,
  shape: 0,
  themeGate: 0,
  themeLeak: 0,
})

interface GeneratedSet {
  seed?: string
  theme: string
  words: string[]
}

/**
 * Narrows `unknown` one set at a time. NEVER throws: a failure costs that set, never the batch.
 *
 * Takes `unknown` and narrows rather than taking GeneratedSet and hoping -- the tool schema gives ajv
 * no view of an element at all, so an element can be null, a number, or absent.
 */
const toGeneratedSet = (value: unknown): GeneratedSet | undefined => {
  const candidate = value as Partial<GeneratedSet> | null | undefined
  if (typeof candidate?.theme !== 'string' || !Array.isArray(candidate.words) || candidate.words.length === 0) {
    return undefined
  }
  if (candidate.words.some((word) => typeof word !== 'string')) {
    return undefined
  }
  // OPTIONAL and never a rejection: a set missing its seed, or carrying a number where a string
  // belongs, is still a usable set. It is counted rather than dropped -- see seedUse below.
  const seed = typeof candidate.seed === 'string' ? candidate.seed : undefined
  return { seed, theme: candidate.theme, words: candidate.words }
}

/**
 * The theme's own gates. It is this type's ONLY model-authored player-visible string, so it takes the
 * full model-authored column: non-empty after trim, the per-field cap, no control or format codes,
 * the blocklist -- plus a word count and this type's charset.
 *
 * G6, the typeable charset, is NOT applied. A theme is a label, not "the one string the player
 * types", and G6 is not a default anything inherits.
 */
export const passesThemeGates = (theme: string): boolean =>
  passesStringGates({ maxLength: MAX_THEME_LENGTH, value: theme }) &&
  THEME_CHARSET.test(theme) &&
  theme.trim().split(/\s+/).length <= MAX_THEME_WORDS

const getModelContext = (setCount: number, themes: string[], words: string[], random: () => number) => {
  // SEEDING IS LOAD-BEARING, not a nicety: an unseeded model asked for themes returns Kitchen, Ocean,
  // Weather every night. It is also the mechanism that degrades to NOTHING, silently, with no log
  // line -- INSPIRATION_NOUNS_COUNT absent is NaN, getRandomSample computes Math.min(NaN, len), the
  // loop never runs and it returns []. A quiet degradation of an anti-repetition mechanism is worth
  // one line at ERROR, because the symptom -- themes converging over a week -- is invisible in every
  // other instrument this type has.
  // ALL THREE, because all three are now load-bearing here. The check used to name nouns alone, which
  // was complete while nouns were the only seed pool this call read and became a hole the moment they
  // were not: a missing INSPIRATION_VERBS_COUNT is NaN, getRandomSample computes Math.min(NaN, len),
  // the loop never runs and it returns [] -- so a third of the seed vocabulary would vanish with
  // nothing logged, and the symptom is themes converging over a WEEK, which no instrument here sees.
  const counts = {
    INSPIRATION_ADJECTIVES_COUNT: inspirationAdjectivesCount,
    INSPIRATION_NOUNS_COUNT: inspirationNounsCount,
    INSPIRATION_VERBS_COUNT: inspirationVerbsCount,
  }
  for (const [name, value] of Object.entries(counts)) {
    if (!Number.isFinite(value)) {
      logError(`${name} is not a number; generating with that pool unseeded`, { [name]: value })
    }
  }
  return {
    // An INDEPENDENT draw from the phrase call's. Two calls in one invocation sharing one sample
    // would correlate their output.
    // ALL THREE POOLS, not nouns alone, and this is the cheapest variety this call can buy.
    //
    // A theme is a CATEGORY, and a category is seeded just as well by a verb or an adjective as by a
    // noun: `quilt` gives "Bedding and blankets", but `frozen` gives "Frozen foods" and `swim` gives
    // "Swimming gear" -- kinds of theme a noun-only draw reaches only by accident. theme_rules
    // already asks the model to "vary the KIND of theme across the batch" and then handed it one
    // kind of seed to do it with.
    //
    // It also widens the seed VOCABULARY from 2000 words to the union of all three, which is what
    // actually bounds how alike two nights can be: measured over four live calls the model maps
    // seeds to themes very nearly one-for-one and IN ORDER, so a repeated seed is a repeated theme
    // and the collision rate of the pool IS the repetition rate of the game.
    inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
    inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
    inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
    maxWordLength: MAX_WORD_LENGTH,
    minWordLength: MIN_WORD_LENGTH,
    // The COMPUTED value, never a literal: a repair run that asks for eight sets while the prompt
    // says twelve is a prompt whose stated count is a lie.
    setCount,
    // Shown as well as enforced. Rejecting a repeat the model was never told about kills a generation
    // with no way for it to have done better.
    themesAlreadyUsed: themes,
    wordsAlreadyUsed: words,
    wordsPerSet: WORDS_REQUESTED,
  }
}

/**
 * One model call for `max(count * 4, 8)` themed sets, gated per set and per word.
 *
 * ONE invokeModel per invocation. A batch that comes back short is a shortfall this type LOGS, never
 * a retry: a second call on a thin batch is the cheaper mistake a spec that only rules out a review
 * pass leaves available.
 *
 * Never a combined "pack materials" call with the phrase batch. One tool returning phrases and themed
 * sets is one schema, and one bad item in it fails the whole payload -- the coupling the per-puzzle
 * isolation rule exists to prevent, arriving one level above where the rule is written.
 */
export const fetchAnagramSets = async (
  count: number,
  recentThemeList: string[],
  recentWordList: string[],
  random: () => number = Math.random,
): Promise<AnagramSetBatch> => {
  const setCount = Math.max(count * SET_REQUEST_MULTIPLIER, MINIMUM_SET_REQUEST)
  // Built ONCE and kept, because the seeds offered are what `seedUse.fromPool` is measured against.
  // Re-sampling for the measurement would draw a different pool and score the model against words it
  // never saw.
  const context = getModelContext(setCount, recentThemeList, recentWordList, random)
  const offered = new Set(
    [context.inspirationAdjectives, context.inspirationNouns, context.inspirationVerbs]
      .flat()
      .map((word) => normalizeAnswer(word)),
  )
  const droppedByGate = emptyGateCounts()
  const setsDiscardedByReason = emptyRejectionCounts()
  // Batch-local, and shared across every set, so one night cannot ship the same word under two
  // themes. Only words that were ACCEPTED join it.
  const seen = new Set<string>()
  const used = new Set(recentWordList.map(normalizeAnswer))
  let setsReturned = 0

  const accept = (raw: unknown): AnagramSet | undefined => {
    const candidate = toGeneratedSet(raw)
    if (candidate === undefined) {
      setsDiscardedByReason.shape += 1
      log('Rejected an anagram set', { reason: 'shape' })
      return undefined
    }
    if (!passesThemeGates(candidate.theme)) {
      setsDiscardedByReason.themeGate += 1
      log('Rejected an anagram set', { reason: 'themeGate', theme: candidate.theme })
      return undefined
    }

    // A COPY of the batch-local set, committed back only if this set is accepted. Admitting into it
    // as we go is what makes W9 catch a word repeated WITHIN one set as well as across two; keeping
    // it provisional is what stops a set that is about to be discarded from burning words the next
    // set could have used.
    const local = new Set(seen)
    const admitted: string[] = []
    for (const word of candidate.words) {
      const failure = wordGateFailure(word, { seen: local, used })
      if (failure !== undefined) {
        droppedByGate[failure] += 1
        continue
      }
      local.add(normalizeAnswer(word))
      admitted.push(word.toUpperCase())
    }

    // THE LEAK CHECK RUNS ONCE, HERE, over the words that SURVIVED. Running it in the theme pass
    // would measure it against words about to be dropped, and running it in both is the same check
    // twice under two names. A hit rejects the SET: a theme that names one of its own answers is a
    // theme the model wrote wrong.
    //
    // Two honest limits. FUNCTION_WORDS exempts tokens regardless of length, so a handful of
    // admissible answers -- SHOULD, THOSE, WITHOUT -- pass it vacuously. Larger: there is no
    // stemming, so a theme of "Kettles and other kitchen tools" against KETTLE tokenizes to KETTLES,
    // which is not KETTLE, and the set passes cleanly with a quarter of the puzzle named on screen.
    // Both are pushed into the tool description rather than into a second, type-local token rule that
    // can drift from the shared one.
    if (admitted.some((word) => leaksAnswerTokens(word, candidate.theme))) {
      setsDiscardedByReason.themeLeak += 1
      log('Rejected an anagram set', { reason: 'themeLeak', theme: candidate.theme })
      return undefined
    }
    if (admitted.length < WORDS_PER_PUZZLE) {
      setsDiscardedByReason.belowWordFloor += 1
      log('Rejected an anagram set', { admitted: admitted.length, reason: 'belowWordFloor' })
      return undefined
    }

    for (const word of admitted) {
      seen.add(normalizeAnswer(word))
    }
    // `seed` carried through. This function REBUILDS the set rather than spreading it -- `words` is
    // the admitted subset, not what arrived -- so a field added to AnagramSet and not named here is
    // silently dropped, which is how seedUse first read zero for every batch.
    return { seed: candidate.seed, theme: candidate.theme, words: admitted }
  }

  const sets = await requestBatch<unknown, AnagramSet>({
    accept,
    asked: setCount,
    context,
    excludedKeys: new Set(recentThemeList.map(normalizeAnswer)),
    itemsOf: (payload) => {
      const items = (payload as { sets: unknown[] }).sets
      // Counted HERE because requestBatch returns only what survived, and "the batch was thin" and
      // "every set was rejected" want opposite fixes. itemsOf is called exactly once per call.
      setsReturned = items.length
      return items
    },
    keyOf: (set) => normalizeAnswer(set.theme),
    promptId: llmAnagramPromptId,
    tool: anagramSetTool,
    type: 'themedanagrams',
  })

  // Over the SURVIVING sets, not the returned ones: a set discarded for its words says nothing about
  // whether the seeding rule was followed, and counting it would move this number for reasons that
  // have nothing to do with seeds.
  const named = sets.filter((set) => set.seed !== undefined)
  const seedUse: SeedUse = {
    distinct: new Set(named.map((set) => normalizeAnswer(set.seed as string))).size,
    fromPool: named.filter((set) => offered.has(normalizeAnswer(set.seed as string))).length,
    named: named.length,
  }

  return { droppedByGate, seedUse, sets, setsDiscardedByReason, setsReturned }
}
