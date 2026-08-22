import { chargedWords } from '../assets/blocklist'
import { Familiarity, PhraseHints } from '../types'
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

// Characters that DO something instead of saying something: Cc is the C0/C1 control codes (including
// the newline and NUL that no rung needs), Cf the invisible format codes (including U+202E
// RIGHT-TO-LEFT OVERRIDE, which reverses the rendering of everything after it). `trim()` removes
// none of them from the middle of a string.
//
// This exists because endpoints.rest tells every client to render `text` VERBATIM. React escapes a
// text node, but the contract is what a client obeys, and a rung is only as safe as the narrowest
// renderer that takes the instruction literally. Deliberately NOT a whitelist: hints and categories
// are prose and legitimately carry punctuation, digits, apostrophes and accents.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u

const isSafeProse = (value: string, maxLength: number): boolean =>
  value.trim() !== '' && value.length <= maxLength && !CONTROL_CHARACTERS.test(value)

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
  if (prose.some((entry) => leaksPhraseTokens(text, entry))) {
    log('Rejected phrase prose: a word of the phrase leaks into a hint or the category', { text })
    return false
  }
  return true
}
