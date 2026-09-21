// The respacing rule. The catalog fixes only a worked example -- THE EMPIRE STRIKES BACK shown as
// THMP RSTR KSBCK, 4|4|5 against the real 2|3|5|3 -- so the algorithm below is the difficulty dial.
import { getRandomSample } from '../../utils/random-sample'

const VOWELS = /[AEIOU]/g
const NOT_ALPHANUMERIC = /[^A-Z0-9]/g

// Y is a consonant here. Treating it as a vowel would gut YELLOW SUBMARINE and MYTH, and no
// player expects it to vanish.
export interface StrippedPhrase {
  consonants: string
  // The real word lengths in consonants, checked against but never displayed
  wordSizes: number[]
}

export const stripVowels = (text: string): StrippedPhrase => {
  const words = text
    .trim()
    .split(/\s+/)
    .map((word) => word.toUpperCase().replace(NOT_ALPHANUMERIC, '').replace(VOWELS, ''))
  return { consonants: words.join(''), wordSizes: words.map((word) => word.length) }
}

// The internal split positions implied by a run of sizes, as offsets into the joined string. A word
// contributing no consonants (A, I) creates no visible boundary, so its duplicate position is
// collapsed; otherwise the coincidence check compares against a boundary nobody can see.
export const boundariesOf = (sizes: number[]): number[] => {
  const boundaries: number[] = []
  let offset = 0
  for (const size of sizes.slice(0, -1)) {
    offset += size
    if (offset > 0 && !boundaries.includes(offset)) {
      boundaries.push(offset)
    }
  }
  return boundaries
}

// 0 -- chunk count matches the word count and a boundary may coincide with a real one by chance.
// 1 -- chunk count matches, and no boundary may coincide.
// 2 -- chunk count deliberately differs, and no boundary may coincide.
export type Aggression = 0 | 1 | 2

// A one-letter chunk reads as a typo rather than a word.
const MIN_CHUNK = 2

// A redraw cap per chunk count, so no retry loop runs unbounded; the overall bound is this times
// the number of candidate counts. Exhausting it costs one puzzle, not the invocation.
const ATTEMPTS_PER_COUNT = 20

// A count whose chunks all sit at MIN_CHUNK admits exactly one split, because the move loop below
// is gated on a chunk above the minimum. Spending the full budget there is twenty identical draws.
export const attemptsFor = (length: number, count: number): number =>
  length === count * MIN_CHUNK ? 1 : ATTEMPTS_PER_COUNT

const drawChunkSizes = (length: number, count: number, random: () => number): number[] => {
  // The most even split, then single letters moved so one phrase is not always the same shape.
  const sizes = Array.from(
    { length: count },
    (_, index) => Math.floor(length / count) + (index < length % count ? 1 : 0),
  )

  for (let move = 0; move < count; move++) {
    const from = Math.floor(random() * count)
    const to = Math.floor(random() * count)
    if (from !== to && sizes[from] > MIN_CHUNK) {
      sizes[from] -= 1
      sizes[to] += 1
    }
  }

  return sizes
}

// The chunk counts to try, best first. Matching the word count is a nicety and for some phrases
// impossible -- RAIDERS OF THE LOST ARK leaves no four legal split positions two apart -- so
// aggression 1 prefers the word count and then widens rather than giving up.
const candidateCounts = (wordCount: number, length: number, aggression: Aggression, random: () => number): number[] => {
  // Never ask for more chunks than a two-letter minimum can fill.
  const max = Math.max(2, Math.floor(length / MIN_CHUNK))
  const preferred = Math.min(wordCount, max)
  if (aggression === 0) {
    return [preferred]
  }

  const all = Array.from({ length: max - 1 }, (_, index) => index + 2)
  const others = getRandomSample(
    all.filter((count) => count !== preferred),
    all.length,
    random,
  )

  if (aggression === 2) {
    // The word count last, never dropped: every lying count is tried first, and a phrase whose
    // alternatives are all infeasible (REAR WINDOW) still ships rather than failing generation.
    // The boundary check still applies, so the puzzle is honest, just less aggressive.
    return [...others, preferred]
  }
  return [preferred, ...others]
}

/**
 * Regroups the consonant run so the displayed spacing lies about where the words really end.
 * Nothing is added, removed or reordered -- the same letters, grouped differently.
 */
export const respace = (
  consonants: string,
  wordSizes: number[],
  aggression: Aggression,
  random: () => number = Math.random,
): string => {
  const realBoundaries = new Set(boundariesOf(wordSizes))
  const wordCount = wordSizes.filter((size) => size > 0).length

  // Whole counts are tried in turn rather than one count redrawn: feasibility is a property of the
  // count, and some admit no legal split that any number of redraws would find.
  for (const count of candidateCounts(wordCount, consonants.length, aggression, random)) {
    const attempts = attemptsFor(consonants.length, count)
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const sizes = drawChunkSizes(consonants.length, count, random)
      const coincides = boundariesOf(sizes).some((boundary) => realBoundaries.has(boundary))

      if (aggression === 0 || !coincides) {
        const chunks: string[] = []
        let offset = 0
        for (const size of sizes) {
          chunks.push(consonants.slice(offset, offset + size))
          offset += size
        }
        return chunks.join(' ')
      }
    }
  }

  throw new Error(`Could not respace "${consonants}" away from its word boundaries at any chunk count`)
}
