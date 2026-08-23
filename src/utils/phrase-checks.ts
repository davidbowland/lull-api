import { Familiarity, PhraseHints } from '../types'
import { log } from './logging'
import { collapse, containsChargedWord, isSafeProse, leaksAnswerTokens } from './model-output-checks'

const HINT_COUNT = 3

// The length half of "validate all external inputs", applied to the player-visible strings this API
// RELAYS rather than authors. goFigure's rung text is built by textFor from a closed set of
// templates and cannot exceed a known size; a phrase puzzle's hints and category are model prose,
// and phraseTool types both as bare strings with no `maxLength` (services/phrases.ts:47-53).
//
// Both caps, not just the hint one. The category ships on PhrasePuzzleData beside the ladder and is
// rendered by the same client, so bounding one and leaving the other is not a bound -- a reviewer
// replacement of `{ category: 'x'.repeat(5000) }` cleared every gate before this existed.
//
// Generous on purpose, because rejection drops the whole phrase. The longest hint in any fixture is
// 70 characters ("The one where a lightsaber duel ends with a revelation about parentage", which is
// the create-phrases prompt's own worked example of a good rung 3), and hint_rules asks rung 3 to
// name the work specifically enough to force recognition -- so long rungs are the design, not an
// accident. These reject a runaway generation, not a wordy one.
const MAX_HINT_LENGTH = 200
const MAX_CATEGORY_LENGTH = 120

// PhraseHints, not HintLadder, and the name matters: this checks three bare STRINGS -- what the
// model returns and what the gates below read -- while HintLadder is the wire's three { text }
// objects. Named isHintLadder it would be an exported predicate asserting the opposite of what it
// tests, and the first caller to trust the name would gate a ladder of objects and pass everything.
export const isPhraseHints = (value: unknown): value is PhraseHints => {
  const isThreeStrings =
    Array.isArray(value) &&
    value.length === HINT_COUNT &&
    value.every((hint) => typeof hint === 'string' && isSafeProse(hint, MAX_HINT_LENGTH))
  return isThreeStrings && new Set((value as string[]).map(collapse)).size === HINT_COUNT
}

// Same three checks the ladder gets -- non-empty, bounded, no control or format codes -- because the
// category is player-visible model prose on the same payload and rendered by the same client.
const isFilledString = (value: unknown): value is string =>
  typeof value === 'string' && isSafeProse(value, MAX_CATEGORY_LENGTH)

export const DEFAULT_FAMILIARITY: Familiarity = 3

// Exported for the reason SHAPES is (services/phrases.ts): the band these two bound is stated to
// the model only as prose in reviewTool.description, and a rating outside them is silently replaced
// by the default here. Widening the band without widening the sentence would leave the new ratings
// unaskable-for. tool-schemas.test.ts is what ties the two together; nothing in src/ imports them.
export const MIN_FAMILIARITY = 1
export const MAX_FAMILIARITY = 5

// A bad value is replaced rather than rejected: familiarity is a rating nothing in this spec
// consumes yet, and losing a whole phrase over it would cost more than it is worth.
export const toFamiliarity = (value: unknown): Familiarity => {
  const isRated =
    Number.isInteger(value) && (value as number) >= MIN_FAMILIARITY && (value as number) <= MAX_FAMILIARITY
  if (isRated) {
    return value as Familiarity
  }
  log('Defaulted an unusable familiarity rating', { value })
  return DEFAULT_FAMILIARITY
}

export interface ProseCandidate {
  category: unknown
  hints: unknown
  text: string
}

/**
 * Every gate that applies to player-visible model prose, in one place.
 *
 * Both generatePhrases and reviewPhrases call it, so a reviewer's wholesale rewrite has to pass
 * exactly what the generator's first draft passed. A failure drops THAT PHRASE, individually, and
 * never the batch.
 *
 * The type-agnostic halves live in utils/model-output-checks.ts and are imported rather than
 * re-exported. This function is the PHRASE-shaped composition and nothing else.
 */
export const passesProseGates = ({ category, hints, text }: ProseCandidate): boolean => {
  if (!isPhraseHints(hints)) {
    log('Rejected phrase prose: hints are not three distinct non-empty strings', { text })
    return false
  }
  if (!isFilledString(category)) {
    log('Rejected phrase prose: the category is empty', { text })
    return false
  }
  const prose = [category, ...hints]
  if (prose.some(containsChargedWord)) {
    log('Rejected phrase prose: a blocklisted term in a hint or the category', { text })
    return false
  }
  if (prose.some((entry) => leaksAnswerTokens(text, entry))) {
    log('Rejected phrase prose: a word of the phrase leaks into a hint or the category', { text })
    return false
  }
  return true
}
