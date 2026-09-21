import { Familiarity, PhraseHints } from '../types'
import { log } from './logging'
import {
  collapse,
  containsBritishSpelling,
  containsChargedWord,
  isSafeProse,
  leaksAnswerTokens,
} from './model-output-checks'

const HINT_COUNT = 3

// Length bounds on the model prose this API relays: phraseTool types hints and category as bare
// strings with no `maxLength`. Both are capped -- leaving `category` unbounded is what let a
// reviewer replacement of `{ category: 'x'.repeat(5000) }` clear every gate. Generous on purpose,
// because rejection drops the whole phrase and the longest hint in any fixture is 70 characters.
const MAX_HINT_LENGTH = 200
const MAX_CATEGORY_LENGTH = 120

// PhraseHints, not HintLadder: this checks three bare strings, what the model returns, while
// HintLadder is the wire's three { text } objects. Under the other name a caller trusting it would
// gate a ladder of objects and pass everything.
export const isPhraseHints = (value: unknown): value is PhraseHints => {
  const isThreeStrings =
    Array.isArray(value) &&
    value.length === HINT_COUNT &&
    value.every((hint) => typeof hint === 'string' && isSafeProse(hint, MAX_HINT_LENGTH))
  return isThreeStrings && new Set((value as string[]).map(collapse)).size === HINT_COUNT
}

// The same three checks the ladder gets: the category is player-visible model prose on the same
// payload, rendered by the same client.
const isFilledString = (value: unknown): value is string =>
  typeof value === 'string' && isSafeProse(value, MAX_CATEGORY_LENGTH)

export const DEFAULT_FAMILIARITY: Familiarity = 3

// Exported only so tool-schemas.test.ts can tie them to reviewTool.description, which states this
// band to the model as prose. Widening the band without widening that sentence leaves the new
// ratings unaskable-for. Nothing in src/ imports them.
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
 * exactly what the generator's first draft passed. A failure drops that phrase, never the batch.
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
  // On `text` alone: it is the string the player types, so TRUE COLOURS is unsolvable rather than
  // merely misspelled. A hint or category is only read, and the reviewer is asked to fix those
  // rather than drop the phrase -- and `text` is the one field the reviewer may not rewrite.
  if (containsBritishSpelling(text)) {
    log('Rejected phrase prose: a British spelling in the phrase text', { text })
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
