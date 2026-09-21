import { Difficulty, PhrazleData, Puzzle } from '../../types'
import { phrazleGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by nothing in src/ -- a leaf module rather than an
// export on the generator, so esbuild never pulls a string builder into GetPackByDateFunction.
//
// Each bound is derived from a constant in this repo: answer 80 from MAX_TEXT_LENGTH in
// services/phrases.ts, still the ceiling because canonicalization only removes characters;
// category 120 from MAX_CATEGORY_LENGTH in utils/phrase-checks.ts, which this type does ship,
// since CATEGORY_HIDDEN_BY_DIFFICULTY hides it only at 3 and 5 and the declared bands are
// [2, 3, 5]. No hints and no maxGuesses: what is left is a phrase and a category.
const MAX_TEXT_LENGTH = 80
const MAX_CATEGORY_LENGTH = 120

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<PhrazleData> => ({
  data: {
    answer: 'A'.repeat(MAX_TEXT_LENGTH),
    category: 'c'.repeat(MAX_CATEGORY_LENGTH),
  },
  difficulty,
  estimatedSeconds: phrazleGenerator.baseSeconds + phrazleGenerator.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-23:phrazle:${'f'.repeat(8)}`,
  type: 'phrazle',
})
