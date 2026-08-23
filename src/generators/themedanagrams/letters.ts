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

/**
 * How many positions of the scramble still hold the answer's letter. Hamming, never Cayley.
 *
 * OVER THE STRINGS, not over the permutation, and that is a correctness choice. With a repeated
 * letter the underlying permutation is not unique -- KETTLE's two Ts can be exchanged by a
 * permutation of Cayley distance 1 that produces a string identical to the answer -- so a gate keyed
 * on permutation distance is keyed on an unobservable implementation detail of the shuffler, and a
 * gate keyed on an unobservable will one day silently pass.
 *
 * On the domain that matters the two agree anyway: two strings that are anagrams and differ in
 * exactly two positions must hold each other's letters there, so Hamming distance 2 IS one
 * transposition. That is what lets the agreement ceiling subsume the catalog's "within one
 * transposition" rule with the same number that sets the difficulty.
 */
export const agreements = (answer: string, scramble: string): number =>
  [...answer].filter((letter, index) => letter === scramble[index]).length

/**
 * The longest run of letters the scramble shares with the answer, AT ANY OFFSET.
 *
 * The second severity axis, and the one Hamming cannot see at all: TOASTER -> ERTOAST agrees in zero
 * positions and hands the reader TOAST intact. It is how a person actually reads a scramble.
 *
 * Always at least 1 for a real scramble, since the two are anagrams and therefore share every
 * letter -- so a ceiling of 1 means "no answer BIGRAM survives anywhere", and 2 means no trigram.
 */
export const longestSharedRun = (answer: string, scramble: string): number => {
  // Classic dynamic programming over one rolling row rather than a full table: the words are at most
  // nine characters, so this is about clarity rather than about the constant.
  let longest = 0
  let previous: number[] = new Array(scramble.length + 1).fill(0)
  for (let left = 1; left <= answer.length; left += 1) {
    const current: number[] = new Array(scramble.length + 1).fill(0)
    for (let right = 1; right <= scramble.length; right += 1) {
      if (answer[left - 1] !== scramble[right - 1]) {
        continue
      }
      current[right] = previous[right - 1] + 1
      longest = Math.max(longest, current[right])
    }
    previous = current
  }
  return longest
}

/**
 * How many DISTINCT strings this word's letters can spell: `len! / product(count_i!)`.
 *
 * The honest quantity, and the one the scrambler's attempt budget is a multiple of. Computed
 * exactly; at nine letters or fewer every intermediate fits a double with room to spare, so there is
 * no precision caveat to state.
 *
 * It is also the generator's sparseness gate: a five-letter word with two repeated pairs has 30, and
 * that is exactly the shape whose hardest-band acceptable set is routinely empty.
 */
export const distinctPermutations = (word: string): number => {
  const counts = new Map<string, number>()
  for (const letter of word.toUpperCase()) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1)
  }
  const factorial = (value: number): number => (value <= 1 ? 1 : value * factorial(value - 1))
  return [...counts.values()].reduce((total, count) => total / factorial(count), factorial(word.length))
}

/** The largest number of times any one letter appears. KETTLE is 2; BANANA is 3. */
export const maxLetterCount = (word: string): number => {
  const counts = new Map<string, number>()
  for (const letter of word.toUpperCase()) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1)
  }
  return Math.max(...counts.values())
}
