import { chargedWords } from '../assets/blocklist'

// The gates that apply to a string by its PROVENANCE (model-authored or code-authored) and its ROLE
// (answer, clue, prose shown before the answer, label) -- never by its puzzle type and never by its
// position in the wire shape. Two types with the same role get the same row. One type with two roles
// gets two.
//
// Split out of phrase-checks.ts, which keeps only the phrase-shaped composition and imports from
// here. The name is the point rather than the tidiness: phrase-checks.ts:144-147 is an explicit
// warning that a gate's name is part of its safety, and a module named `phrase-checks` holding the
// gate a cryptic clue's answer must pass is exactly the misleading name that warning is about.
//
// NOTHING here is re-exported from phrase-checks.ts. A re-export is a second name for one thing.

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

export const leaksAnswerTokens = (answer: string, prose: string): boolean => {
  const leaky = new Set(
    tokenize(answer).filter((token) => token.length >= MIN_LEAK_TOKEN_LENGTH && !FUNCTION_WORDS.has(token)),
  )
  return tokenize(prose).some((token) => leaky.has(token))
}

// Distinctness compares PROSE, so punctuation is stripped and whitespace collapsed rather than
// discarded. NOT normalizeAnswer: that drops spacing entirely, which is right for a one-phrase
// answer and wrong for sentence-length prose.
export const collapse = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

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

export const isSafeProse = (value: string, maxLength: number): boolean =>
  value.trim() !== '' && value.length <= maxLength && !CONTROL_CHARACTERS.test(value)

// Letters and spaces only, hoisted from services/phrases.ts:23 and generalized. That comment's
// reasoning -- "a phrase the player cannot type is worse than a missing one", and digits survive
// vowel-stripping so CATCH 22 would reach a Missing Vowels board with its digits in plaintext -- is
// a property of ANY answer a player types, not of Phrase.text. It applies to every string in the
// role "the one string the player types", and to nothing else: it does NOT generalize to labels. A
// theme label, a category or a hint legitimately carries punctuation, digits and accents, and
// applying this to one would reject legitimate content over a Missing Vowels fact.
export const isTypeable = (value: string): boolean => /^[A-Za-z ]+$/.test(value)

// Number.isFinite, never `typeof === 'number'`. NaN and Infinity are both typeof number and
// JSON.stringify writes them as `null`, so an unguarded value produces a puzzle that is invalid only
// AFTER it is persisted -- and nothing in this repo rewrites a stored pack. Any model-authored
// number is exposed to this. It was written for a type that is no longer in Phase 1 and it is not
// that type's rule; removing a gate with the type that motivated it is how a gate gets re-derived
// from an incident later.
//
// The `typeof` conjunct is redundant with Number.isFinite, which never coerces -- Number.isFinite('5')
// is already false. It is kept because it is what stops a later edit swapping in the GLOBAL isFinite,
// which does coerce and which grades '5' as a number. No test can falsify it; that is stated here
// rather than dressed up as a covered branch.
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Whole-token, over the module-private tokenizer, and (answer, prose) in THAT order -- the same
// order leaksAnswerTokens takes.
//
// NO length floor and NO function-word exemption, which is the difference from leaksAnswerTokens and
// is not an oversight. Those two exist so a hint for TO BE OR NOT TO BE may say "to" and "be"; here
// the whole question is whether the answer itself stands in the prose, and a three-letter answer or
// an answer that happens to be a function word is exactly the case to catch.
//
// Two polarities, one definition: Cryptic Clue asserts this FALSE over its clue, Themed Anagrams
// asserts it TRUE over rung 3. A gate that says "must not leak" and a gate that says "must reveal"
// are the same measurement pointed in opposite directions.
//
// THE ARGUMENT ORDER DOES NOT MATTER AND CANNOT MATTER, so do not spend any alarm on it. This is
// `tokens(answer) INTERSECT tokens(prose) is non-empty`, and intersection is commutative, so a
// swapped call returns the IDENTICAL boolean. leaksAnswerTokens is the same: its length and
// function-word filter is per token, so it applies to the intersection whichever way round the
// arguments arrive. A swap is provably free. No test can pin the order because there is no order to
// pin, and one that claimed to would pass unconditionally.
//
// THE LIVE HAZARD IS WHICH OF THE TWO YOU CALL. They share the exact `(string, string) => boolean`
// signature over one tokenizer, so the compiler is no help -- but this is not the untestable kind of
// risk. The two agree everywhere except on tokens shorter than MIN_LEAK_TOKEN_LENGTH or listed in
// FUNCTION_WORDS, so a substituted call reads as correct across most inputs and is wrong exactly
// where those two constants earn their keep. That difference IS testable, and it is pinned twice:
// directly, on an ARM/THAT pair, and through passesStringGates, whose G5 must call leaksAnswerTokens
// and would begin rejecting a hint for saying a three-letter word of its own answer if it did not.
export const containsAnswerToken = (answer: string, prose: string): boolean => {
  const answerTokens = new Set(tokenize(answer))
  return tokenize(prose).some((token) => answerTokens.has(token))
}

export interface StringGateOptions {
  // Omit to WAIVE the answer-leak gate, G5. Waivers are written down in a spec, never discovered,
  // and G5 has TWO -- one by ROLE and one by PROVENANCE. This parameter encodes the ROLE waiver
  // only:
  //   * a cryptic clue, where the answer's letters sitting inside the clue IS the puzzle, so the
  //     gate would reject every valid hidden clue; and
  //   * a string that IS the answer, which is the case in utils/exclusions.ts -- every entry in an
  //     exclusion list is an answer, so leaksAnswerTokens(answer, answer) is true for every entry of
  //     four characters or more, and running G5 there would empty the list every night.
  // The PROVENANCE waiver -- a code-authored rung -- is NOT expressed by omitting this field. A
  // code-authored string does not call this function's model-authored rows at all; it passes G1, G2
  // and G3, and G4 on whatever it interpolates.
  //
  // OMITTING waives. Supplying an empty or whitespace-only string does NOT: it is rejected. There is
  // no third state where the gate looks applied and is not.
  answer?: string
  // PER FIELD, and required rather than defaulted. One global number is not a bound: bounding hints
  // and leaving `category` unbounded is what let { category: 'x'.repeat(5000) } clear every gate.
  // Generous on purpose, because rejection costs the whole item.
  maxLength: number
  // true applies the typeable charset, G6. Prose fields -- a hint, a category, a theme label --
  // legitimately carry punctuation, digits and accents and must NOT set it.
  typeable?: boolean
  // `unknown` deliberately: these gates run over model output, and a caller that had already proved
  // it was a string would not need G1.
  value: unknown
}

/**
 * Gates 1-6 of the reconciled gate table, composed, in TABLE ORDER.
 *
 * G1 typeof + non-empty after trim; G2 the per-field cap; G3 no Cc and no Cf; G4 not a charged word;
 * G5 does not leak the answer, waived by OMITTING `answer` and never by supplying an empty one;
 * G6 the typeable charset, opt in.
 *
 * It applies to a string for WHAT THE STRING IS -- its provenance and its role -- never for its
 * puzzle type and never for its position in the wire shape.
 */
export const passesStringGates = ({ answer, maxLength, typeable, value }: StringGateOptions): boolean => {
  // G1, G2 and G3 together: isSafeProse is non-empty after trim, bounded, and free of control and
  // format codes. The typeof is separate because isSafeProse takes a string.
  if (typeof value !== 'string' || !isSafeProse(value, maxLength)) {
    return false
  }
  if (containsChargedWord(value)) {
    return false
  }
  // G5. Two ways to fail: the answer leaks, or the answer is empty. The second is not pedantry --
  // `answer !== undefined` alone is true for `''`, which tokenizes to nothing, so the gate would run
  // and pass EVERY value. That is a waiver that looks applied, and `answer: puzzle.answer ?? ''`
  // produces one silently. Waivers here are written down in a spec and never discovered, so an empty
  // or whitespace-only answer is a caller error and fails CLOSED.
  if (answer !== undefined && (answer.trim() === '' || leaksAnswerTokens(answer, value))) {
    return false
  }
  return typeable !== true || isTypeable(value)
}
