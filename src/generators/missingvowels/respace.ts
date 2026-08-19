// The respacing rule. The catalog fixes only a worked example -- THE EMPIRE STRIKES BACK shown as
// THMP RSTR KSBCK, which is 4|4|5 against the real 2|3|5|3 -- so the algorithm below is what makes
// "respacing aggression" an implementable difficulty dial rather than a description.
import { getRandomSample } from '../../utils/random-sample'

const VOWELS = /[AEIOU]/g
const NOT_ALPHANUMERIC = /[^A-Z0-9]/g

// Y is a consonant here. Treating it as a vowel would gut YELLOW SUBMARINE and MYTH, and no
// player expects it to vanish.
export interface StrippedPhrase {
  consonants: string
  // The REAL word lengths in consonants. Kept so the respacing can be checked against the
  // boundaries it must avoid -- it is never displayed.
  wordSizes: number[]
}

export const stripVowels = (text: string): StrippedPhrase => {
  const words = text
    .trim()
    .split(/\s+/)
    .map((word) => word.toUpperCase().replace(NOT_ALPHANUMERIC, '').replace(VOWELS, ''))
  return { consonants: words.join(''), wordSizes: words.map((word) => word.length) }
}

// The internal split positions implied by a run of sizes, as offsets into the joined string. A
// word that contributed no consonants (A, I, an all-vowel word) creates no visible boundary, so
// its duplicate position is collapsed -- otherwise the coincidence check below would compare
// against a boundary the player cannot see.
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

// 0 -- chunk count matches the word count and a boundary MAY coincide with a real one by chance.
// 1 -- chunk count matches, and no boundary may coincide.
// 2 -- chunk count deliberately differs, and no boundary may coincide.
export type Aggression = 0 | 1 | 2

// A one-letter chunk reads as a typo rather than as a word, so chunks are kept to two letters
// where the phrase is long enough to allow it.
const MIN_CHUNK = 2

// A redraw cap per chunk count, not a retry budget -- the project rule is that no retry loop runs
// unbounded. The overall bound is this times the number of candidate counts. It fires only for a
// phrase with no legal respacing at any count, which costs one puzzle through createPack's
// per-generate catch rather than burning the invocation.
const ATTEMPTS_PER_COUNT = 20

const drawChunkSizes = (length: number, count: number, random: () => number): number[] => {
  // Start from the most even split, then move single letters between chunks so the result is not
  // always the same shape for a given phrase.
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

// The chunk counts to try, best first.
//
// Keeping the count equal to the word count is a nicety, not a requirement, and for some phrases
// it is impossible. RAIDERS OF THE LOST ARK gives RDRSFTHLSTRK -- 12 consonants whose real
// boundaries are {4,5,7,10}, so the only legal split positions left are {2,3,6,8,9}, and no four
// of those sit two apart. Locking the count there made a perfectly good phrase unrespaceable, so
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
    // A phrase too short to offer any other count falls back to matching it. The boundary check
    // still has to pass, so the puzzle stays honest -- it is just less aggressive than the band
    // asked for.
    return others.length > 0 ? others : [preferred]
  }
  return [preferred, ...others]
}

/**
 * Regroups the consonant run so the displayed spacing lies about where the words really end.
 *
 * Nothing is added, removed, or reordered: the displayed string holds exactly the letters the
 * player has to recognize, only grouped differently.
 */
export const respace = (
  consonants: string,
  wordSizes: number[],
  aggression: Aggression,
  random: () => number = Math.random,
): string => {
  const realBoundaries = new Set(boundariesOf(wordSizes))
  const wordCount = wordSizes.filter((size) => size > 0).length

  // Whole counts are tried in turn rather than one count being redrawn, because feasibility is a
  // property of the count: some counts admit no legal split at all, and no number of redraws at
  // that count will find one.
  for (const count of candidateCounts(wordCount, consonants.length, aggression, random)) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_COUNT; attempt++) {
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
