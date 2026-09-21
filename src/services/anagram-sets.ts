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

// The ask. Rejection runs at two levels here -- per word and per set -- so the multiplier is
// higher than the phrase batch's 3x; the within-unit over-ask (WORDS_REQUESTED asked,
// WORDS_PER_PUZZLE shipped) is what keeps it at 4 rather than much larger.
export const SET_REQUEST_MULTIPLIER = 4

// Binds on exactly one kind of night, so it looks like dead code. `count` is the number of
// MISSING puzzles, so a repair run needing one puzzle would otherwise ask for four sets -- a coin
// flip against two-level rejection, on a night that is already a repair.
export const MINIMUM_SET_REQUEST = 8

// A theme is one to four words, so it gets its own cap rather than the 120 sized for a category
// that may be a descriptive phrase.
export const MAX_THEME_LENGTH = 40
export const MAX_THEME_WORDS = 4

// A positive whitelist, affordable for a short label and deliberately refused for prose; digits
// are allowed but may never lead, so "1980s toys" survives. Excluding `;` is load-bearing: `&`
// survives escapeXml unescaped, but without a semicolon a stored theme can never carry a literal
// `&lt;` or `&#60;` to be interpreted after escaping.
export const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

export const anagramSetTool: ToolSchema = {
  // The description does the work the schema is forbidden to do: under `items: {}` an element is
  // opaque to ajv, so this string is the model's only specification of a set. Interpolated from
  // the constants, never retyped, or it tells the model one thing while the context block tells
  // it another -- prose does not typecheck.
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
      // items: {} -- an element is opaque to ajv, on purpose. Any keyword below this line,
      // INCLUDING `type`, fails the entire payload over one malformed element: a per-item
      // `required: ['theme', 'words']` would cost all twelve sets over one missing key.
      sets: { items: {}, type: 'array' },
    },
    // The one surviving constraint: a payload with no `sets` key is not a batch at all.
    required: ['sets'],
    type: 'object',
  },
  name: 'submit_anagram_sets',
}

// The shape a set has AFTER the gates ran; `words` are UPPERCASE and already admissible. `seed`
// is reporting, not a gate, and never reaches the wire: asking the model to name the inspiration
// word each theme came from is most of the enforcement and makes compliance countable, while
// rejecting on it would cost a set per wrong self-report.
export interface AnagramSet {
  seed?: string
  theme: string
  words: string[]
}

// Why a set was dropped: a bare count reads identically for a model returning malformed JSON and
// one naming its own answers in every theme, and those want opposite fixes.
export type SetRejection = 'belowWordFloor' | 'shape' | 'themeGate' | 'themeLeak'

/*
 * How well the model followed the seeding rule, over the sets that SURVIVED. Seeds are the whole
 * anti-repetition mechanism: measured over live calls the model maps them to themes very nearly
 * one-for-one, so the collision rate of the pool is the repetition rate of the game.
 *
 * Three numbers because they fail differently: `named` short of the set count is a model ignoring
 * the field, `fromPool` short of `named` is a model inventing seeds it was never given, and
 * `distinct` short of `named` is two themes off one seed. One percentage would name none of them.
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
  britishSpelling: 0,
  charset: 0,
  displacedForm: 0,
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
 * The tool schema gives ajv no view of an element, so an element can be null, a number or absent.
 */
const toGeneratedSet = (value: unknown): GeneratedSet | undefined => {
  const candidate = value as Partial<GeneratedSet> | null | undefined
  if (typeof candidate?.theme !== 'string' || !Array.isArray(candidate.words) || candidate.words.length === 0) {
    return undefined
  }
  if (candidate.words.some((word) => typeof word !== 'string')) {
    return undefined
  }
  // Optional and never a rejection: a set missing its seed is still a usable set, and is counted
  // rather than dropped. See seedUse below.
  const seed = typeof candidate.seed === 'string' ? candidate.seed : undefined
  return { seed, theme: candidate.theme, words: candidate.words }
}

/**
 * The theme's own gates. It is this type's only model-authored player-visible string, so it takes
 * the full model-authored column plus a word count and this type's charset. G6, the typeable
 * charset, is NOT applied: a theme is a label, not the string the player types.
 */
export const passesThemeGates = (theme: string): boolean =>
  passesStringGates({ maxLength: MAX_THEME_LENGTH, value: theme }) &&
  THEME_CHARSET.test(theme) &&
  theme.trim().split(/\s+/).length <= MAX_THEME_WORDS

const getModelContext = (setCount: number, themes: string[], words: string[], random: () => number) => {
  // Seeding is load-bearing and degrades to nothing SILENTLY: an absent count is NaN,
  // getRandomSample computes Math.min(NaN, len), the loop never runs and it returns [] -- and the
  // symptom, themes converging over a week, is invisible in every other instrument this type has.
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
    // An independent draw from the phrase call's: two calls in one invocation sharing one sample
    // would correlate their output. All three pools, not nouns alone -- `frozen` and `swim` seed
    // kinds of category a noun-only draw reaches by accident, and the union is what bounds how
    // alike two nights can be.
    inspirationAdjectives: getRandomSample(adjectives, inspirationAdjectivesCount, random),
    inspirationNouns: getRandomSample(nouns, inspirationNounsCount, random),
    inspirationVerbs: getRandomSample(verbs, inspirationVerbsCount, random),
    maxWordLength: MAX_WORD_LENGTH,
    minWordLength: MIN_WORD_LENGTH,
    // The computed value, never a literal: a repair run asking for eight sets while the prompt
    // says twelve is a prompt whose stated count is a lie.
    setCount,
    // Shown as well as enforced: rejecting a repeat the model was never told about kills a
    // generation for nothing.
    themesAlreadyUsed: themes,
    wordsAlreadyUsed: words,
    wordsPerSet: WORDS_REQUESTED,
  }
}

/**
 * One model call for `max(count * 4, 8)` themed sets, gated per set and per word. A batch that
 * comes back short is a shortfall this type logs, never a retry.
 *
 * Never a combined "pack materials" call with the phrase batch: one tool returning phrases and
 * themed sets is one schema, and one bad item in it fails the whole payload.
 */
export const fetchAnagramSets = async (
  count: number,
  recentThemeList: string[],
  recentWordList: string[],
  random: () => number = Math.random,
): Promise<AnagramSetBatch> => {
  const setCount = Math.max(count * SET_REQUEST_MULTIPLIER, MINIMUM_SET_REQUEST)
  // Built once and kept: the seeds offered are what `seedUse.fromPool` is measured against, so
  // re-sampling would score the model against words it never saw.
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

    // A copy, committed back only if this set is accepted. Admitting as we go makes W9 catch a
    // word repeated WITHIN one set as well as across two; keeping it provisional stops a set
    // about to be discarded from burning words the next set could use.
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

    // Once, here, over the words that SURVIVED: running it in the theme pass would measure it
    // against words about to be dropped. Two known limits, both pushed into the tool description
    // rather than a type-local token rule that can drift: FUNCTION_WORDS exempts tokens
    // regardless of length, and there is no stemming, so "Kettles..." against KETTLE passes.
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
    // This REBUILDS the set rather than spreading it, because `words` is the admitted subset and
    // not what arrived -- so a field added to AnagramSet and not named here is silently dropped.
    return { seed: candidate.seed, theme: candidate.theme, words: admitted }
  }

  const sets = await requestBatch<unknown, AnagramSet>({
    accept,
    asked: setCount,
    context,
    excludedKeys: new Set(recentThemeList.map(normalizeAnswer)),
    itemsOf: (payload) => {
      const items = (payload as { sets: unknown[] }).sets
      // Counted here because requestBatch returns only what survived, and "the batch was thin"
      // and "every set was rejected" want opposite fixes.
      setsReturned = items.length
      return items
    },
    keyOf: (set) => normalizeAnswer(set.theme),
    promptId: llmAnagramPromptId,
    tool: anagramSetTool,
    type: 'themedanagrams',
  })

  // Over the SURVIVING sets, not the returned ones: a set discarded for its words says nothing
  // about whether the seeding rule was followed.
  const named = sets.filter((set) => set.seed !== undefined)
  const seedUse: SeedUse = {
    distinct: new Set(named.map((set) => normalizeAnswer(set.seed as string))).size,
    fromPool: named.filter((set) => offered.has(normalizeAnswer(set.seed as string))).length,
    named: named.length,
  }

  return { droppedByGate, seedUse, sets, setsDiscardedByReason, setsReturned }
}
