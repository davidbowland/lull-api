import { CryptogramData, Difficulty, Puzzle } from '../../types'
import { cryptogramContribution } from './contribution'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by nothing in src/ -- a leaf module rather than an
// export on the generator, so esbuild never pulls a string builder into GetPackByDateFunction.
//
// Each bound is derived from a constant in this repo: answer 100 from MAX_TEXT_LENGTH in
// generators/cryptogram/sentence.ts; ciphertext the same, since encipher() is a per-character
// substitution; category 40 from MAX_CATEGORY_LENGTH in services/cryptogram-sentences.ts. This
// type ships no hints.
//
// The filler is plain ASCII, which is an assumption: these caps count CHARACTERS, so a
// pathological 40-character category of `"` would serialize to 80 bytes. The ceiling this feeds
// carries better than four times that headroom.
const MAX_TEXT_LENGTH = 100
const MAX_CATEGORY_LENGTH = 40

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<CryptogramData> => ({
  data: {
    answer: 'a'.repeat(MAX_TEXT_LENGTH),
    category: 'c'.repeat(MAX_CATEGORY_LENGTH),
    ciphertext: 'Z'.repeat(MAX_TEXT_LENGTH),
  },
  difficulty,
  estimatedSeconds: cryptogramContribution.baseSeconds + cryptogramContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-20:cryptogram:${'f'.repeat(8)}`,
  type: 'cryptogram',
})
