// Pure, no I/O, no lexicon: the committed word list is reached only through lexicon.ts, so
// scripts/build-anagram-index.ts can import from here without dragging 76,000 words into the build
// step that produces them.

/**
 * The anagram class key: a word's letters, uppercased, in order. Uppercased here so a caller may
 * pass either case -- the committed list is `a-z` while every runtime gate runs on
 * `word.toUpperCase()`, and taking the caller's case at face value would reject every word, nightly.
 */
export const sortedLetters = (word: string): string => [...word.toUpperCase()].sort().join('')

/**
 * How many positions of the scramble still hold the answer's letter: Hamming over the strings, never
 * Cayley over the permutation. With a repeated letter the permutation is not unique -- KETTLE's two
 * Ts can be exchanged by a Cayley-distance-1 permutation that reproduces the answer -- so
 * permutation distance is keyed on an unobservable detail of the shuffler.
 */
export const agreements = (answer: string, scramble: string): number =>
  [...answer].filter((letter, index) => letter === scramble[index]).length

/**
 * The longest run of letters the scramble shares with the answer, at any offset. The second severity
 * axis, and the one Hamming cannot see: TOASTER -> ERTOAST agrees in zero positions and hands the
 * reader TOAST intact. Always at least 1, so a ceiling of 1 means no answer bigram survives.
 */
export const longestSharedRun = (answer: string, scramble: string): number => {
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
 * How many distinct strings this word's letters can spell: `len! / product(count_i!)`. The
 * scrambler's attempt budget is a multiple of this, and it doubles as the sparseness gate. Computed
 * exactly; at nine letters or fewer every intermediate fits a double.
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
