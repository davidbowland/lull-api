import { Difficulty, MissingVowelsData, Puzzle } from '../../types'
import { missingVowelsGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module
// rather than an export on the generator, so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. answer, category and the three rungs carry the same bounds Cryptogram's
// row does -- MAX_TEXT_LENGTH, MAX_CATEGORY_LENGTH and MAX_HINT_LENGTH -- and see that file for the
// plain-ASCII filler assumption, which applies here unchanged.
//
// `displayed` is the one bound this type has to argue for, because no constant states it. respace
// emits chunks of the answer's CONSONANTS joined by single spaces, and MIN_CHUNK is two letters, so
// at most 80 consonants come back in at most 40 chunks with at most 39 separators between them:
// 119 characters. That is the arithmetic bound rather than a reachable one -- a real answer is a
// two-to-six word phrase whose vowels are gone, so the measured strings are a fraction of it -- and
// a worst case is the right place to be wrong upward.
const MAX_TEXT_LENGTH = 80
const MAX_CATEGORY_LENGTH = 120
const MAX_HINT_LENGTH = 200
const MAX_DISPLAYED_LENGTH = MAX_TEXT_LENGTH + Math.floor(MAX_TEXT_LENGTH / 2) - 1

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<MissingVowelsData> => ({
  data: {
    answer: 'a'.repeat(MAX_TEXT_LENGTH),
    // Present, never undefined: CATEGORY_HIDDEN_BY_DIFFICULTY drops it at bands 3 and 5, and a
    // dropped field is smaller. This type ships neither band today, so it is always present in a
    // real pack too.
    category: 'c'.repeat(MAX_CATEGORY_LENGTH),
    displayed: 'Z'.repeat(MAX_DISPLAYED_LENGTH),
    hints: [
      { text: 'h'.repeat(MAX_HINT_LENGTH) },
      { text: 'h'.repeat(MAX_HINT_LENGTH) },
      { text: 'h'.repeat(MAX_HINT_LENGTH) },
    ],
  },
  difficulty,
  estimatedSeconds: missingVowelsGenerator.baseSeconds + missingVowelsGenerator.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-20:missingvowels:${'f'.repeat(8)}`,
  type: 'missingvowels',
})
