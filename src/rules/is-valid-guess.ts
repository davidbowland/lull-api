import { normalizeAnswer } from './normalize-answer'

// HAZARD: this file is hand-copied into the sibling lull-ui repo and nothing verifies the copies
// match. It must stay dependency-free -- no Node built-ins, no SDK -- so it compiles in both a
// Lambda and a Next.js bundle, and it imports normalize-answer.ts, so the copy must carry BOTH
// files with the relative path between them intact.
//
// normalizeAnswer is applied per word here, never to the whole phrase: folding a phrase discards
// spacing and would accept TOEHOLD for TOE HOLD.

const A_TO_Z = /^[A-Z]+$/
const WHITESPACE = /\s+/

/**
 * The canonical words of a phrase: uppercase A-Z, single-spaced, no empty word.
 *
 * The only splitter. generators/phrazle/difficulty.ts re-exports it as `wordsOf`, so the structural
 * floor, the difficulty, the dictionary clause, the hint ladder and the board count the same words.
 */
export const splitPhrase = (input: string): string[] =>
  input
    .split(WHITESPACE)
    .map((word) => normalizeAnswer(word))
    .filter((word) => word.length > 0)

/**
 * Whether every word is in the guess dictionary.
 *
 * Case-sensitive, expecting canonical words: the committed slice is uppercase ^[A-Z]+$, and
 * lowercasing first would be a second normalization rule. Exported because the generator calls it
 * at predicate time, where there are no wordLengths to hand. The length check matters: Array.every
 * is vacuously true on an empty array, so a phrase that split to nothing would otherwise pass.
 */
export const everyWordInDictionary = (words: string[], dictionary: ReadonlySet<string>): boolean =>
  words.length > 0 && words.every((word) => dictionary.has(word))

/**
 * Whether this guess may be submitted at all.
 *
 * The whole of what stands between a player typing and markGuess's throw; clauses 1 and 2 make that
 * throw unreachable from a player. A failing guess is rejected at the keyboard and does not consume
 * one of the six attempts. `wordLengths` at play time is splitPhrase(data.answer).map((word) =>
 * word.length); there is no wordLengths field on the wire, so grid and guess cannot disagree.
 */
export const isValidGuess = (guess: string[], wordLengths: number[], dictionary: ReadonlySet<string>): boolean =>
  guess.length === wordLengths.length &&
  guess.every((word, index) => word.length === wordLengths[index]) &&
  // Re-checked although splitPhrase guarantees it: this contract must not depend on the caller
  // having used the right splitter.
  guess.every((word) => A_TO_Z.test(word)) &&
  everyWordInDictionary(guess, dictionary)
