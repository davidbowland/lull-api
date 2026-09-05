import { normalizeAnswer } from '../../rules/normalize-answer'
import { containsChargedWord } from '../../utils/model-output-checks'
import { distinctPermutations, maxLetterCount } from './letters'
import { hasUniqueAnagram } from './lexicon'

// WORD ADMISSIBILITY, every number fixed here rather than left for a retry bound to enforce by
// accident -- which is how an unreachable backstop turns into the normal exit path.
//
// Below 5 letters the hardest band's acceptable set is too sparse to draw from and the
// distinct-permutation floor is unreachable outright (4! is 24). Above 9 the puzzle leaves the
// catalog's one-to-two minutes. The 5-letter floor is the FIRST number to move if supply turns out
// thin, and the counter that says so is droppedByGate.notUnique read per band.
export const MIN_WORD_LENGTH = 5
export const MAX_WORD_LENGTH = 9

// A word with three of one letter has a scramble space dominated by arrangements a reader cannot
// tell apart. KETTLE survives; BANANA does not.
export const MAX_LETTER_MULTIPLICITY = 2

// The size of the space the scrambler draws from, and its attempt budget is a multiple of this. It
// binds only at length 5: a five-letter word with two repeated pairs has 30, which is exactly the
// shape whose hardest-band acceptable set is routinely empty.
export const MIN_DISTINCT_PERMUTATIONS = 60

// Asked of the model. The within-unit over-ask that keeps the set multiplier at 4 rather than the
// much larger number pure set-level rejection would demand.
//
// SIX UNTIL IT WAS MEASURED, and eight because of what the measurement said. Five live calls
// (2026-09-04, empty exclusion lists, the most permissive case there is) returned twelve sets each
// and yielded 6, 3, 9, 4 and 6 usable ones against a countPerDay of 3 -- one run landed exactly on
// the floor. EVERY discarded set died at `belowWordFloor`, and the gate doing the killing was
// notUnique at 22-27 words a run, against 5 for length and 3 for multiplicity and zero for
// everything else.
//
// That is not a gate to loosen. Membership in the index proves nothing else anagrams to the word,
// which is the whole reason no scramble of it can be another word, and it is a LEXICON fact the
// model cannot check -- prompts/create-anagram-sets.txt already tells it plainly and it still loses
// about 42% of words. The dial that answers a per-word failure rate is how many words a set is
// asked for, not how strictly they are judged.
//
// A set ships on WORDS_PER_PUZZLE of these, so at the measured rate the arithmetic is binomial:
// four survivors out of six is ~47% of sets, four out of eight is ~80%.
//
// PREDICTED ~9.6 USABLE, MEASURED 9.75, over four more live calls at eight. Usable sets went 6/3/9/4/6
// to 10/8/10/11 -- the floor moved from 3, which is countPerDay exactly, to 8 -- and belowWordFloor
// went from a mean of 6.2 discarded sets to 1.5. notUnique did NOT fall and was never expected to:
// it is a per-word property and it still takes 16-32 words a run. What changed is that a set can now
// afford to lose four of them. Output went 552 to ~650 tokens of the 8000 the prompt is allowed, so
// both the before and the after sit under a tenth of the budget.
//
// prompts/create-anagram-sets.txt STATES THIS NUMBER IN PROSE as well as receiving it as
// `wordsPerSet`, and the two must move together -- a prompt whose sentences say six while its
// context says eight is the same defect the setCount comment one file over already names.
export const WORDS_REQUESTED = 8

// Shipped on the wire. FIXED, and `entries` is a 4-tuple in the type, so this is the tuple's arity.
// There is deliberately no MIN_WORDS_PER_SET beside it: a set is usable at a difficulty exactly when
// it yields this many scrambles, and a separate floor constant would be a knob that can be set to a
// value the wire shape cannot express.
export const WORDS_PER_PUZZLE = 4

// One key per gate, and every gate has a counter: a gate that can drop a word and cannot be counted
// is a night nobody can diagnose. "The batch was thin" and "every word failed uniqueness" read
// identically in a bare count and want opposite fixes.
export type WordGate =
  | 'blocklist'
  | 'charset'
  | 'duplicateInBatch'
  | 'length'
  | 'multiplicity'
  | 'notUnique'
  | 'permutations'
  | 'recentlyUsed'
  | 'tokens'

// A preserved space in a scramble gives the word boundary away; a destroyed one is unfair. Written
// as a PRESENCE test rather than a whole-string shape so an empty string falls through to the
// charset gate, which is the reason a reader would want for it.
const TOKEN_SEPARATORS = /[\s'-]/
const LETTERS_ONLY = /^[A-Z]+$/

export interface WordContext {
  // Normalized keys already used ANYWHERE in this batch. Mutated by the caller as words are admitted,
  // so one night cannot ship SPATULA twice under two themes.
  seen: Set<string>
  // Normalized keys from recent packs.
  used: Set<string>
}

/**
 * Which gate this word fails, or `undefined` when it is admissible. Cheapest first.
 *
 * THE TOKEN CHECK RUNS BEFORE THE CHARSET CHECK, and that is a deliberate departure from the order
 * the design table numbers them in. `/^[A-Z]+$/` already rejects a space, a hyphen and an
 * apostrophe, so a charset check placed first makes the token counter unreachable -- it would read
 * zero on every night forever, which is a counter that cannot fail rather than a gate that never
 * fires. Running the specific check first makes ICE CREAM diagnosable as a multi-word answer and
 * CAFE-AU-LAIT as a hyphenated one, while the general check keeps its own reason for everything else.
 *
 * ACCENTS ARE REJECTED, NEVER FOLDED: a scramble of CAFE is not a scramble of the CAFÉ a player
 * would have to type. Stated as an IDENTITY against normalizeAnswer rather than as a second regex,
 * because that is what makes src/rules/normalize-answer.ts's promise about O-slash, AE and
 * sharp-s CHECKABLE from here rather than restated in a form that can drift from it. The promise is
 * one third false and that is worth knowing: 'straße' uppercases to 'STRASSE' and normalizes to
 * 'STRASSE', so the identity holds and the word is admitted -- at length 7, not 6, because the fold
 * changes the length the gates below then measure. That is harmless, because the answer ships as
 * STRASSE and the player types STRASSE, and the round trip is over the folded string throughout.
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
  // Whole-token, never substring, and it gates the ANSWER only -- over utils/charged-terms.ts, whose
  // inflections are what make a no-stemming whole-token check safe. On the 21 vendored base forms
  // alone this admitted FUCKS, BITCHES, FAGGOTS and BASTARDS as answers.
  //
  // The SCRAMBLE is gated TWICE and neither is here: by sorted-letter key at build time in
  // scripts/build-anagram-index.ts, because a charged word absent from ENABLE is invisible to any
  // check that counts ENABLE entries; and on the composed string itself at generate time in
  // scramble.ts, because the key filter only ever covers the inflections someone listed.
  if (containsChargedWord(upper)) {
    return 'blocklist'
  }
  // The gate that does the most work. Membership proves the word is a word AND that nothing else
  // anagrams to it, so no scramble of it other than itself can be a word -- which is why there is no
  // runtime LEXICON membership check on the scramble anywhere in this type. The runtime check that
  // does exist, in scramble.ts, is the blocklist rather than the lexicon, and it is there precisely
  // because a charged string need not be an ENABLE word for this proof to have missed it.
  if (!hasUniqueAnagram(upper)) {
    return 'notUnique'
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
