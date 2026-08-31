import { CryptogramData, Difficulty, Puzzle } from '../../types'
import { cryptogramGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module
// rather than an export on the generator, so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * answer 80. MAX_TEXT_LENGTH in services/phrases.ts, the gate `text` passes before a phrase
//     becomes a puzzle, and `text` ships verbatim as `answer`.
//   * ciphertext 80. encipher() is a per-character substitution over [A-Z] with everything else
//     passed through, so the ciphertext is EXACTLY as long as the answer. Not an independent bound.
//   * category 120. MAX_CATEGORY_LENGTH in utils/phrase-checks.ts. Present, never undefined:
//     CATEGORY_HIDDEN_BY_DIFFICULTY drops it at bands 3 and 5, and a dropped field is smaller.
//
// NO HINTS ROW, and it was by far the biggest: three rungs at MAX_HINT_LENGTH is 600 of the 880
// characters this shape used to carry, more than the answer, the ciphertext and the category
// together. This type stopped shipping a ladder -- the shared prose rungs are semantic and a
// cryptogram is solved letter by letter -- so its hints are chosen on the device, by a builder that
// will live at src/rules/hint-cryptogram.ts once the branch authoring it merges and that is not in
// this repo today. Nothing on the wire replaces them, so nothing replaces the row, and the drop is
// measured in __tests__/unit/services/packs-size.test.ts rather than estimated here.
//
// The filler is plain ASCII, and that is an ASSUMPTION worth naming rather than hiding: these caps
// count CHARACTERS, and the category gate admits a quote, so a pathological 120-character category
// of nothing but `"` would serialize to 240 bytes. The ceiling this feeds carries better than four
// times the headroom that would cost, which is the reason the assumption is acceptable rather than a
// reason it is invisible.
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
