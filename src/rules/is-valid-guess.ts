import { normalizeAnswer } from './normalize-answer'

// Shared rule, hand-copied into lull-ui like every file in this directory.
//
// THIS FILE IMPORTS ANOTHER RULES FILE, which is new for this directory. normalize-answer.ts states
// the vendoring rule as "no imports at all"; one rules file importing another is still pure and
// still bundles in both a Lambda and a Next.js build, but it means the copy into lull-ui must carry
// BOTH files with the relative path between them intact. "Copy this file" is otherwise a correct
// instruction that produces a broken build.
//
// NORMALIZEANSWER IS NOT PHRAZLE'S COMPARISON RULE, and the distinction is the point rather than a
// loophole. Applied to a WHOLE PHRASE it discards spacing on purpose, because Missing Vowels
// displays word boundaries that lie -- so it would erase the boundaries that ARE the Phrazle board
// and would accept TOEHOLD for TOE HOLD. Applied PER WORD, inside splitPhrase, it preserves every
// boundary and folds exactly the accents a phrase corpus produces. Duplicating its NFD fold here
// instead would put two copies of a Unicode rule in one repo, which is the drift hazard this whole
// directory exists to bound.

const A_TO_Z = /^[A-Z]+$/
const WHITESPACE = /\s+/

/**
 * The canonical words of a phrase: uppercase A-Z, single-spaced, no empty word.
 *
 * THE ONLY SPLITTER. generators/phrazle/difficulty.ts re-exports this as `wordsOf` and a test
 * asserts the two are the same function by identity, so the structural floor, the derived
 * difficulty, the dictionary clause, the hint ladder and the board all count the same words. Two
 * splitters over one phrase is the drift this directory exists to bound.
 */
export const splitPhrase = (input: string): string[] =>
  input
    .split(WHITESPACE)
    .map((word) => normalizeAnswer(word))
    .filter((word) => word.length > 0)

/**
 * Whether every word is in the guess dictionary.
 *
 * Case-sensitive, expecting canonical words: the committed slice is uppercase ^[A-Z]+$, and a
 * lookup that lowercased first would be a second normalization rule.
 *
 * Exported in its own right because the generator calls it directly at predicate time, where there
 * are no wordLengths to hand and isValidGuess is therefore unreachable.
 *
 * The length check is load-bearing rather than defensive: Array.every is vacuously true on an empty
 * array, so without it a phrase that split to nothing would clear the dictionary clause.
 */
export const everyWordInDictionary = (words: string[], dictionary: ReadonlySet<string>): boolean =>
  words.length > 0 && words.every((word) => dictionary.has(word))

/**
 * Whether this guess may be submitted at all.
 *
 * Four conjuncts, in this order, and this is the whole of what stands between a player typing and
 * markGuess's throw. Clauses 1 and 2 are what make that throw unreachable from a player.
 *
 * A guess failing any clause is rejected at the keyboard and DOES NOT CONSUME ONE OF THE SIX
 * ATTEMPTS -- an invalid guess never enters the stored progress.
 *
 * `wordLengths` at play time is splitPhrase(data.answer).map((word) => word.length). There is no
 * wordLengths field on the wire: the board derives it through the same splitter the guess goes
 * through, so grid and guess cannot disagree by construction.
 */
export const isValidGuess = (guess: string[], wordLengths: number[], dictionary: ReadonlySet<string>): boolean =>
  guess.length === wordLengths.length &&
  guess.every((word, index) => word.length === wordLengths[index]) &&
  // Guaranteed by splitPhrase, and re-checked here because this function's contract must not depend
  // on its caller having called the right splitter.
  guess.every((word) => A_TO_Z.test(word)) &&
  everyWordInDictionary(guess, dictionary)
