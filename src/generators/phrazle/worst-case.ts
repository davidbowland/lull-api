import { Difficulty, PhrazleData, Puzzle } from '../../types'
import { phrazleGenerator } from './generator'
import { MAX_PHRAZLE_RUNG_LENGTH } from './hints'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module
// rather than an export on the generator, so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * answer 80. MAX_TEXT_LENGTH in services/phrases.ts, the gate `text` passes before a phrase
//     becomes a puzzle. This type ships the CANONICAL form rather than the text verbatim, and
//     canonicalization only removes characters, so 80 is still the ceiling.
//   * category 120. MAX_CATEGORY_LENGTH in utils/phrase-checks.ts. Filled here even though this type
//     never ships one -- CATEGORY_HIDDEN_BY_DIFFICULTY hides at 3 and 5, which are its only two
//     bands -- because a worst case is a bound on the SHAPE, and a band that stopped hiding is
//     exactly the change this row exists to have priced in advance.
//   * hints 3 x MAX_PHRAZLE_RUNG_LENGTH, which is 80 rather than the 200 utils/phrase-checks.ts
//     sizes for model prose. The rungs here are a fixed template -- the longest buildHints can
//     produce is `Letter 7 of word 3 is X.`, 24 characters -- so the tighter cap is free, and it is
//     what keeps this row inside its budget. MEASURED BOTH WAYS: at 200 this puzzle is 1,188 B
//     against the 1,030 B row the count table published, and does not fit; at 80 it is 828 B.
//   * metadata 3 x { kind, letter, position, word }. The only thing above Missing Vowels' shape: a
//     21-character `kind` string plus three short fields, three times over, and the component an
//     earlier estimate of this type's size missed.
//
// NOTHING FOR THE GUESS LIMIT, because there is no longer one. `maxGuesses` was filled with 9
// rather than the 6 that shipped -- a bound on the shape, and a one-digit number is the bound --
// and its removal takes `,"maxGuesses":9`, exactly 15 bytes, off every puzzle of this type.
//
// MEASURED AT 828 B, against the 1,030 B row the count table published as an ESTIMATE. It is now
// derived rather than estimated, and it comes in UNDER rather than over -- reported either way,
// which is the rule. 843 while the limit shipped. The pack total moves with it and MAX_DAYS does
// not: a smaller pack cannot break a bound derived from a larger one.
const MAX_TEXT_LENGTH = 80
const MAX_CATEGORY_LENGTH = 120

// The largest indices the structural floor admits: six words of eleven letters, so word 5 and
// position 10 are the widest numbers that can appear. Both moved with the floor -- they were 2 and 6
// against three words of seven, and a worst case that trails its own floor is not one.
const WIDEST_WORD = 5
const WIDEST_POSITION = 10

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<PhrazleData> => ({
  data: {
    answer: 'A'.repeat(MAX_TEXT_LENGTH),
    category: 'c'.repeat(MAX_CATEGORY_LENGTH),
    hints: [
      {
        metadata: { kind: 'phrazle-reveal', letter: 'A', position: WIDEST_POSITION, word: WIDEST_WORD },
        text: 'h'.repeat(MAX_PHRAZLE_RUNG_LENGTH),
      },
      {
        metadata: { kind: 'phrazle-reveal', letter: 'A', position: WIDEST_POSITION, word: WIDEST_WORD },
        text: 'h'.repeat(MAX_PHRAZLE_RUNG_LENGTH),
      },
      {
        metadata: { kind: 'phrazle-reveal', letter: 'A', position: WIDEST_POSITION, word: WIDEST_WORD },
        text: 'h'.repeat(MAX_PHRAZLE_RUNG_LENGTH),
      },
    ],
  },
  difficulty,
  estimatedSeconds: phrazleGenerator.baseSeconds + phrazleGenerator.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-23:phrazle:${'f'.repeat(8)}`,
  type: 'phrazle',
})
