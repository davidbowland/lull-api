import { uniqueAnagramWords } from './data/anagram-words'

// The oracle, and only the oracle. This type never DRAWS a word from ENABLE -- the model proposes
// and this disposes. nouns.ts is the source of things shown to a player and seeds the prompt; the two
// lexicons keep one job each.
//
// The Set is built once at module init, inside CreateModelPuzzlesFunction. That function is not on
// the read path, and the registry-bundle probe in __tests__/unit/generators/index.test.ts is what
// keeps it that way: resolving src/generators must not pull in data/anagram-words.
const index = new Set(uniqueAnagramWords)

/**
 * Whether this word's letter multiset is shared by no other ENABLE entry.
 *
 * TAKES ANY CASE and lowercases before the lookup. The two halves of this check are written in
 * different cases on purpose -- every gate in this type runs on `word.toUpperCase()` and the
 * committed list is `a-z` -- and a lookup that took the caller's case at face value would reject
 * EVERY word EVERY night, with no symptom but one counter equal to the batch size. That reads
 * exactly like a bad model night, which is why the case contract is pinned in lexicon.test.ts rather
 * than left to this comment.
 *
 * Membership is what proves the two facts this type needs of an answer: it is a word, and no other
 * word is an anagram of it -- so no scramble of it, other than itself, can be a word. The third
 * fact, that no scramble of it is a CHARGED word, is NOT proved here and is not proved by any list.
 * The build script's key filter narrows it -- membership cannot, because a charged word absent from
 * ENABLE is invisible to a filter that only counts ENABLE entries -- but a key filter covers only the
 * inflections someone wrote down, and the string a player sees is composed at generate time. That
 * fact is established by the charged-scramble gate in scramble.ts, on the composed string.
 */
export const hasUniqueAnagram = (word: string): boolean => index.has(word.toLowerCase())
