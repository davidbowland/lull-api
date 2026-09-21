import { normalizeAnswer } from '../../rules/normalize-answer'
import { containsBritishSpelling, containsChargedWord } from '../../utils/model-output-checks'
import { distinctPermutations, maxLetterCount } from './letters'
import { hasUniqueAnagram } from './lexicon'

// Below 6 the hardest band's acceptable set is too sparse to draw from, and anagram-uniqueness
// survival falls with length: over scripts/data/enable.txt, words that clear MAX_LETTER_MULTIPLICITY
// with no anagram partner run 55.3% at five letters, 63.2% at six, rising to 88.2% at nine. Above 9
// the puzzle leaves the catalog's one-to-two minutes. Difficulty is owned by the scrambler.
export const MIN_WORD_LENGTH = 6
export const MAX_WORD_LENGTH = 9

// A word with three of one letter has a scramble space dominated by arrangements a reader cannot
// tell apart. KETTLE survives; BANANA does not.
export const MAX_LETTER_MULTIPLICITY = 2

// The space the scrambler draws from, and its attempt budget is a multiple of this. It binds only
// below the length floor: a five-letter word with two repeated pairs has 30.
export const MIN_DISTINCT_PERMUTATIONS = 60

// Asked of the model; WORDS_PER_PUZZLE of these ship. The over-ask absorbs per-word rejection, most
// of it anagram-uniqueness, a lexicon fact the model cannot check. Per-word survival is ~48.3% (the
// rates above at the length mix a themed category produces, less ~22.9 points because a model
// proposes everyday words, which collide more than ENABLE at large), so four-of-eleven survives
// ~86% of the time, at ~900 output tokens of the prompt's 8000. displacedForm rejection is
// knowingly not priced in; if it comes back high in live packs, this number moves, not the gate.
export const WORDS_REQUESTED = 11

// Shipped on the wire; `entries` is a 4-tuple in the type, so this is the tuple's arity, and a
// separate MIN_WORDS_PER_SET would be a knob settable to a value the wire cannot express.
// prompt.test.ts asserts the prompt's prose "FOUR" in <why_the_over_ask> against it.
export const WORDS_PER_PUZZLE = 4

// One key per gate: "the batch was thin" and "every word failed uniqueness" read identically in a
// bare count and want opposite fixes.
export type WordGate =
  | 'blocklist'
  // The gate half of a rule create-anagram-sets.txt also states, so the counter reads as compliance.
  // The lexicon never stood behind it -- ENABLE carries COLOUR and HONOUR as ordinary entries.
  | 'britishSpelling'
  | 'charset'
  // An S-inflection standing in for a citation form that could have shipped instead; `plural` would
  // be a lie about a rule that admits SPONGES. A high count means WORDS_REQUESTED is paying for the
  // model ignoring the prompt's base-form request.
  | 'displacedForm'
  | 'duplicateInBatch'
  | 'length'
  | 'multiplicity'
  | 'notUnique'
  | 'permutations'
  | 'recentlyUsed'
  | 'tokens'

// A preserved space in a scramble gives the word boundary away; a destroyed one is unfair. A
// presence test, not a whole-string shape, so an empty string falls through to the charset gate.
const TOKEN_SEPARATORS = /[\s'-]/
const LETTERS_ONLY = /^[A-Z]+$/

export interface WordContext {
  // Normalized keys used anywhere in this batch. Mutated by the caller as words are admitted, so one
  // night cannot ship SPATULA twice under two themes.
  seen: Set<string>
  // Normalized keys from recent packs.
  used: Set<string>
}

/*
 * Every candidate base, never the first match: BLEACHES yields BLEACHE, which is not a word, and then
 * BLEACH, which is. The VES pair covers F/FE singulars, whose plural changes a letter the other rules
 * cannot see. Non-S inflections are deliberately out of scope -- no -ED, -ING, -ER or -EST.
 */
const candidateBases = (word: string): string[] => {
  if (!word.endsWith('S') || word.endsWith('SS')) {
    return []
  }
  const bases = [word.slice(0, -1)]
  if (word.endsWith('ES')) {
    bases.push(word.slice(0, -2))
  }
  if (word.endsWith('IES')) {
    bases.push(`${word.slice(0, -3)}Y`)
  }
  if (word.endsWith('VES')) {
    bases.push(`${word.slice(0, -3)}F`, `${word.slice(0, -3)}FE`)
  }
  return bases
}

/*
 * Could this base have shipped in the inflection's place? hasUniqueAnagram's index means "in ENABLE,
 * 6-9 letters, anagram-unique, not charged", so one lookup answers four gates; maxLetterCount is
 * ANDed on because the index build never filters letter multiplicity.
 */
const isShippableBase = (base: string): boolean =>
  hasUniqueAnagram(base) && maxLetterCount(base) <= MAX_LETTER_MULTIPLICITY

/**
 * Which gate this word fails, or `undefined` when it is admissible. Cheapest first, except that the
 * token check runs before the charset check: `/^[A-Z]+$/` already rejects a space, hyphen and
 * apostrophe, so a charset check placed first would leave the token counter reading zero forever.
 *
 * Accents are rejected, never folded -- a scramble of CAFE is not a scramble of the CAFÉ a player
 * types -- and stated as an identity against normalizeAnswer rather than a second regex, so that
 * module's folding promise stays checkable from here.
 */
export const wordGateFailure = (word: string, context: WordContext): WordGate | undefined => {
  const upper = word.toUpperCase()

  if (TOKEN_SEPARATORS.test(upper)) {
    return 'tokens'
  }
  if (!LETTERS_ONLY.test(upper) || upper !== normalizeAnswer(word)) {
    return 'charset'
  }
  if (upper.length < MIN_WORD_LENGTH || upper.length > MAX_WORD_LENGTH) {
    return 'length'
  }
  if (maxLetterCount(upper) > MAX_LETTER_MULTIPLICITY) {
    return 'multiplicity'
  }
  if (distinctPermutations(upper) < MIN_DISTINCT_PERMUTATIONS) {
    return 'permutations'
  }
  // Whole-token, never substring, over utils/charged-terms.ts, whose inflections make a no-stemming
  // check safe; blocklist.ts's 21 base forms alone admitted FUCKS and BASTARDS. This gates the
  // ANSWER; the scramble is gated in scripts/build-anagram-index.ts and again in scramble.ts.
  if (containsChargedWord(upper)) {
    return 'blocklist'
  }
  // Before notUnique: COLOUR, DEFENCE, ORGANISE and the rest are in ENABLE and anagram-unique, so
  // they pass the gate below, and placed after it one cause would split across two counter keys.
  if (containsBritishSpelling(upper)) {
    return 'britishSpelling'
  }
  // Membership proves the word is a word AND that nothing else anagrams to it, so no scramble of it
  // other than itself can be a word -- which is why nothing checks a scramble against the lexicon at
  // runtime. scramble.ts checks the blocklist instead, since a charged string need not be in ENABLE.
  if (!hasUniqueAnagram(upper)) {
    return 'notUnique'
  }
  // After notUnique, because this asks whether a BASE clears the other gates and the word here has
  // already proved it is in the index. isShippableBase ignores context.used and context.seen, so
  // BLEACHES is rejected even on a night that already shipped BLEACH; the alternative makes
  // admissibility depend on the day, which no corpus bound can be tested against. The rule is "a
  // plural where a singular would have done", not "no plurals": SPONGES stays because SPONGE
  // anagrams to PONGES, and rejecting every S-inflection would lose 293 of the 3,174 nouns in
  // src/assets/nouns.ts whose plural this admits while the singular cannot ship.
  if (candidateBases(upper).some((base) => isShippableBase(base))) {
    return 'displacedForm'
  }
  const key = normalizeAnswer(upper)
  if (context.used.has(key)) {
    return 'recentlyUsed'
  }
  if (context.seen.has(key)) {
    return 'duplicateInBatch'
  }
  return undefined
}
