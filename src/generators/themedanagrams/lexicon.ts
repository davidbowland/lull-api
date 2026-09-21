import { uniqueAnagramWords } from './data/anagram-words'

// The oracle, and only the oracle: this type never draws a word from ENABLE, it only disposes of
// what the model proposes. The Set is built once at module init, inside CreateModelPuzzlesFunction,
// which is not on the read path. The registry-bundle probe in __tests__/unit/generators/index.test.ts
// keeps it that way -- resolving src/generators must not pull in data/anagram-words.
const index = new Set(uniqueAnagramWords)

/**
 * Whether this word's letter multiset is shared by no other ENABLE entry.
 *
 * Takes any case and lowercases before the lookup: gates in this type run on `word.toUpperCase()`
 * while the committed list is `a-z`, so taking the caller's case at face value would reject every
 * word every night, with no symptom but a counter at the batch size -- which reads exactly like a
 * bad model night. lexicon.test.ts pins the case contract.
 *
 * Membership proves the word is a word and that no other word is an anagram of it, so no scramble
 * of it other than itself can be a word. It does NOT prove that no scramble is a CHARGED word, and
 * no list can, since the player's string is composed at generate time; scramble.ts gates that.
 */
export const hasUniqueAnagram = (word: string): boolean => index.has(word.toLowerCase())
