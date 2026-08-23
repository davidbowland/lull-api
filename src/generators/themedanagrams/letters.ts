// The letter arithmetic this type is built on. Pure, no I/O, no lexicon: the committed word list is
// one module away in data/ and is reached only through lexicon.ts, so scripts/build-anagram-index.ts
// can import from here without dragging 76,000 words into a build step that is producing them.

/**
 * The anagram class key: a word's letters, uppercased, in order.
 *
 * UPPERCASED HERE, so a caller may pass either case. The committed list is `a-z` and every runtime
 * gate in this type runs on `word.toUpperCase()`; a key function that took the caller's case at face
 * value would make those two populations disjoint, and the symptom would be every word rejected
 * every night with nothing in the logs but a counter at the batch size.
 */
export const sortedLetters = (word: string): string => [...word.toUpperCase()].sort().join('')
