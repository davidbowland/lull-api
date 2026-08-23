import { CrypticClueData, Difficulty, Puzzle } from '../../types'
import { crypticClueContribution } from './contribution'
import { MAX_CRYPTIC_RUNG_LENGTH } from './hints'
import { MAX_CLUE_LENGTH } from './verify'

// The LARGEST shape this type can emit, every capped string filled to its cap. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * clue MAX_CLUE_LENGTH = 120, the per-field G2 cap in verify.ts.
//   * answer 8 letters -- the top of the 4-8 band answers.ts draws, and enumeration follows from it.
//   * two spans of two integers each, both indexing the clue, so both are bounded by its length.
//   * three rungs. Rungs 1 and 3 are literals: the longest device rung is 109 characters and the
//     longest enumeration rung is 31. Rung 2 is the only one that can grow, and it is bounded at
//     MAX_CRYPTIC_RUNG_LENGTH = MAX_CLUE_LENGTH + 21 by construction, because the definition is a
//     substring of the clue and `The definition is "X".` is 21 characters of frame.
//
// The REAL longest rung this composer produces is far shorter -- a definition is at most four words.
// The figure asserted is the CAP-BOUNDED one, because that is the shape the size test builds and the
// only one that stays true if the templates change.
//
// NO METADATA ON ANY RUNG, and that is this type's decision rather than an omission: rung 2 QUOTES
// the definition instead of pointing at it, so HintMetadata gains no member. A substring degrades to
// no highlight; an offset degrades to a wrong one.
export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<CrypticClueData> => ({
  data: {
    answer: 'A'.repeat(8),
    clue: 'x'.repeat(MAX_CLUE_LENGTH),
    definitionSpan: { end: MAX_CLUE_LENGTH, start: 0 },
    device: 'anagram',
    enumeration: [8],
    fodderSpan: { end: MAX_CLUE_LENGTH, start: 0 },
    hints: [
      { text: 'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.' },
      { text: `The definition is "${'x'.repeat(MAX_CRYPTIC_RUNG_LENGTH - 21)}".` },
      { text: 'Eight letters, beginning with A.' },
    ],
  },
  difficulty,
  estimatedSeconds:
    crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-10-01:crypticclue:${'f'.repeat(8)}`,
  type: 'crypticclue',
})
