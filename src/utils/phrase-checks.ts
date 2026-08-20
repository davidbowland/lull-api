import { chargedWords } from '../assets/blocklist'
import { Familiarity, HintLadder } from '../types'
import { log } from './logging'

// One tokenizer, used by every check in this file: uppercase, then take letter-and-digit runs.
// NEVER substring -- the same rule the phrase-text blocklist has always used, so ASSESS, COCKTAIL
// and SCUNTHORPE survive. Splitting on the runs rather than on spaces means punctuation cannot
// smuggle a token past the check.
//
// Matching is exact-token. There is no stemming, so STRIKES in the text does not catch STRIKE in a
// hint. That gap is accepted rather than overlooked.
const tokenize = (text: string): string[] => text.toUpperCase().match(/[A-Z0-9]+/g) ?? []

// Moved here from phrases.ts so the generator's first draft and the reviewer's wholesale rewrite
// pass through ONE implementation rather than two that can drift.
export const containsChargedWord = (text: string): boolean => tokenize(text).some((token) => chargedWords.has(token))

// A strict whole-token check would drop nearly every quote-shape phrase: a hint for TO BE OR NOT TO
// BE cannot avoid "to", "be", "or" and "not". Two filters together, because neither works alone.
//
// The length floor catches the content words -- EMPIRE, STRIKES, FLIES, ARROW -- and clears the
// short function words. It does NOT clear the long ones: THAT, THIS, WITH, WHAT, WHERE, WHICH,
// ABOUT and LIKE are all four characters or more, so on the floor alone a hint for TIME FLIES LIKE
// AN ARROW could not say "like" and one for ALL THAT GLITTERS IS NOT GOLD could not say "that".
// Losing a good phrase over a word that gives nothing away is worse than the leak it prevents, and
// the same gate runs on the reviewer's replacements, so it also silently reverts good fixes.
//
// Hence the exemption list: function words only -- articles, pronouns, prepositions, conjunctions,
// auxiliaries and determiners. Never a content word. A noun, verb or adjective of the phrase in a
// hint is the leak this check exists to catch.
const MIN_LEAK_TOKEN_LENGTH = 4

const FUNCTION_WORDS = new Set([
  'ABOUT',
  'AFTER',
  'AGAIN',
  'ALSO',
  'BEEN',
  'BEING',
  'BOTH',
  'CANNOT',
  'COULD',
  'DOES',
  'DOWN',
  'EACH',
  'EVEN',
  'EVERY',
  'FROM',
  'HAVE',
  'HERE',
  'INTO',
  'JUST',
  'LIKE',
  'MORE',
  'MOST',
  'MUCH',
  'MUST',
  'ONLY',
  'ONTO',
  'OVER',
  'SHALL',
  'SHOULD',
  'SOME',
  'SUCH',
  'THAN',
  'THAT',
  'THEIR',
  'THEM',
  'THEN',
  'THERE',
  'THESE',
  'THEY',
  'THIS',
  'THOSE',
  'THROUGH',
  'UNDER',
  'UNTIL',
  'UPON',
  'VERY',
  'WERE',
  'WHAT',
  'WHEN',
  'WHERE',
  'WHICH',
  'WHILE',
  'WILL',
  'WITH',
  'WITHOUT',
  'WOULD',
  'YOUR',
  'YOURS',
])

export const leaksPhraseTokens = (text: string, prose: string): boolean => {
  const leaky = new Set(
    tokenize(text).filter((token) => token.length >= MIN_LEAK_TOKEN_LENGTH && !FUNCTION_WORDS.has(token)),
  )
  return tokenize(prose).some((token) => leaky.has(token))
}

// Distinctness compares PROSE, so punctuation is stripped and whitespace collapsed rather than
// discarded. NOT normalizeAnswer: that drops spacing entirely, which is right for a one-phrase
// answer and wrong for sentence-length prose.
const collapse = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const HINT_COUNT = 3

export const isHintLadder = (value: unknown): value is HintLadder => {
  const isThreeStrings =
    Array.isArray(value) &&
    value.length === HINT_COUNT &&
    value.every((hint) => typeof hint === 'string' && hint.trim() !== '')
  return isThreeStrings && new Set((value as string[]).map(collapse)).size === HINT_COUNT
}

const isFilledString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export const DEFAULT_FAMILIARITY: Familiarity = 3

const MIN_FAMILIARITY = 1
const MAX_FAMILIARITY = 5

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
 */
export const passesProseGates = ({ category, hints, text }: ProseCandidate): boolean => {
  if (!isHintLadder(hints)) {
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
  if (prose.some((entry) => leaksPhraseTokens(text, entry))) {
    log('Rejected phrase prose: a word of the phrase leaks into a hint or the category', { text })
    return false
  }
  return true
}
