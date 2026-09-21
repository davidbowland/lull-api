import { britishSpellings } from './british-spellings'
import { chargedTerms } from './charged-terms'

// Gates that apply to a string by its provenance (model- or code-authored) and its role (answer,
// clue, prose, label) -- never by puzzle type and never by position in the wire shape.
// phrase-checks.ts holds the phrase-shaped composition and imports from here.

// One tokenizer for every check here: uppercase, then letter-and-digit runs. Never substring, so
// ASSESS, COCKTAIL and SCUNTHORPE survive, and punctuation cannot smuggle a token past a check.
// No stemming, so each word list must carry its own inflections.
const tokenize = (text: string): string[] => text.toUpperCase().match(/[A-Z0-9]+/g) ?? []

// `chargedTerms`, never the 21 base forms in `chargedWords`: with no stemming, base forms alone
// admit FUCKS and BITCHES as answers. utils/charged-terms.ts carries the inflections.
export const containsChargedWord = (text: string): boolean => tokenize(text).some((token) => chargedTerms.has(token))

// A British spelling is only fatal where the player types the string -- a scramble of COLOUR
// answered COLOR is marked wrong with nothing on screen to explain it -- so callers run this on
// answer surfaces only. Hints and categories are prose a reviewer is asked to fix rather than drop.
export const containsBritishSpelling = (text: string): boolean =>
  tokenize(text).some((token) => britishSpellings.has(token))

// Two filters, because neither works alone: a hint for TO BE OR NOT TO BE cannot avoid "to" and
// "be", and the length floor alone still bars THAT, WITH, WHICH, ABOUT and LIKE. FUNCTION_WORDS
// holds function words only -- never a content word, since a noun, verb or adjective of the phrase
// in a hint is the leak this catches.
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

export const leaksAnswerTokens = (answer: string, prose: string): boolean => {
  const leaky = new Set(
    tokenize(answer).filter((token) => token.length >= MIN_LEAK_TOKEN_LENGTH && !FUNCTION_WORDS.has(token)),
  )
  return tokenize(prose).some((token) => leaky.has(token))
}

// Distinctness compares prose, so whitespace is collapsed rather than discarded as normalizeAnswer
// would: that is right for a one-phrase answer and wrong for a sentence.
export const collapse = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// Cc control codes and Cf format codes (including U+202E RIGHT-TO-LEFT OVERRIDE, which reverses
// everything rendered after it); `trim()` removes neither from mid-string. endpoints.rest tells
// every client to render `text` verbatim, so a rung is only as safe as the narrowest renderer
// obeying that. Deliberately not a whitelist: prose carries punctuation and accents.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u

export const isSafeProse = (value: string, maxLength: number): boolean =>
  value.trim() !== '' && value.length <= maxLength && !CONTROL_CHARACTERS.test(value)

// Letters and spaces only, for the one string a player types: digits survive vowel-stripping, so
// CATCH 22 reaches a Missing Vowels board with its digits in plaintext. Never for a label,
// category or hint, which legitimately carry punctuation, digits and accents.
export const isTypeable = (value: string): boolean => /^[A-Za-z ]+$/.test(value)

// NaN and Infinity are typeof number and JSON.stringify writes them as `null`, so an unguarded
// model-authored number produces a puzzle invalid only once persisted. The redundant `typeof`
// stops a later edit swapping in the global isFinite, which coerces and grades '5' as a number.
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Like leaksAnswerTokens but with no length floor and no function-word exemption, so a three-letter
// or function-word answer standing in the prose is caught. Returns a plain boolean, so a caller may
// assert either polarity.
//
// HAZARD: this and leaksAnswerTokens share a `(string, string) => boolean` signature and differ
// only on short and function-word tokens, so a substituted call reads as correct almost everywhere.
export const containsAnswerToken = (answer: string, prose: string): boolean => {
  const answerTokens = new Set(tokenize(answer))
  return tokenize(prose).some((token) => answerTokens.has(token))
}

export interface StringGateOptions {
  // Omit to waive the answer-leak gate, G5 -- the waived roles are a cryptic clue, whose puzzle IS
  // the answer's letters inside the clue, and a string that IS the answer (utils/exclusions.ts).
  // Only omitting waives: an empty or whitespace-only string is rejected.
  answer?: string
  // Per field and required rather than defaulted: leaving `category` unbounded is what let
  // { category: 'x'.repeat(5000) } clear every gate.
  maxLength: number
  // true applies the typeable charset, G6. Prose fields -- hint, category, theme label -- must not.
  typeable?: boolean
  // `unknown` deliberately: a caller that had already proved it was a string would not need G1.
  value: unknown
}

/**
 * Gates 1-6 of the gate table, composed, in table order.
 *
 * G1 typeof + non-empty after trim; G2 the per-field cap; G3 no Cc and no Cf; G4 not a charged word;
 * G5 does not leak the answer, waived by omitting `answer` and never by supplying an empty one;
 * G6 the typeable charset, opt in.
 */
export const passesStringGates = ({ answer, maxLength, typeable, value }: StringGateOptions): boolean => {
  // G1, G2 and G3; the typeof is separate because isSafeProse takes a string.
  if (typeof value !== 'string' || !isSafeProse(value, maxLength)) {
    return false
  }
  if (containsChargedWord(value)) {
    return false
  }
  // G5 also fails on an empty answer: it tokenizes to nothing, so the gate would run and pass every
  // value. `answer: puzzle.answer ?? ''` is a caller error and fails closed.
  if (answer !== undefined && (answer.trim() === '' || leaksAnswerTokens(answer, value))) {
    return false
  }
  return typeable !== true || isTypeable(value)
}
