import { CryptogramData, Difficulty, Puzzle } from '../../types'
import { cryptogramGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by nothing in src/ -- a leaf module rather than an
// export on the generator, so esbuild never pulls a string builder into GetPackByDateFunction.
//
// Each bound is derived from a constant in this repo: answer 80 from MAX_TEXT_LENGTH in
// services/phrases.ts; ciphertext the same, since encipher() is a per-character substitution;
// category 120 from MAX_CATEGORY_LENGTH in utils/phrase-checks.ts, always present because a
// category dropped by CATEGORY_HIDDEN_BY_DIFFICULTY is smaller. This type ships no hints.
//
// The filler is plain ASCII, which is an assumption: these caps count CHARACTERS, so a
// pathological 120-character category of `"` would serialize to 240 bytes. The ceiling this feeds
// carries better than four times that headroom.
const MAX_TEXT_LENGTH = 80
const MAX_CATEGORY_LENGTH = 120

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<CryptogramData> => ({
  data: {
    answer: 'a'.repeat(MAX_TEXT_LENGTH),
    category: 'c'.repeat(MAX_CATEGORY_LENGTH),
    ciphertext: 'Z'.repeat(MAX_TEXT_LENGTH),
  },
  difficulty,
  estimatedSeconds: cryptogramGenerator.baseSeconds + cryptogramGenerator.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-20:cryptogram:${'f'.repeat(8)}`,
  type: 'cryptogram',
})
