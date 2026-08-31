import { Difficulty, MissingVowelsData, Puzzle } from '../../types'
import { missingVowelsGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module
// rather than an export on the generator, so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. answer and category carry the same bounds Cryptogram's row does --
// MAX_TEXT_LENGTH and MAX_CATEGORY_LENGTH -- and see that file for the plain-ASCII filler
// assumption, which applies here unchanged.
//
// THE THREE RUNGS ARE THIS ROW'S ALONE NOW. Cryptogram carried the same 3 x MAX_HINT_LENGTH line
// until it stopped shipping a ladder, so this is the only worst case in the repo that prices model
// prose at 200 a rung -- and the plain-ASCII assumption bites hardest here, since isSafeProse admits
// a quote and a pathological 200-character rung of nothing but `"` would serialize to 400 bytes. The
// ceiling this feeds still carries better than four times that.
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
