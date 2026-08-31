import { Difficulty, PhrazleData, Puzzle } from '../../types'
import { phrazleGenerator } from './generator'

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
//
// NO HINTS ROW AND NO METADATA ROW, and together they were most of this shape: three rungs at
// MAX_PHRAZLE_RUNG_LENGTH plus three copies of a 21-character `kind` string and its three short
// fields. This type stopped shipping a ladder. Its rungs were code-built positional reveals, and
// they were blind -- they named a letter position without regard for what the player's guesses had
// already colored in -- so they are chosen on the device now, from src/rules/hint-phrazle.ts,
// against the guesses actually made. What is left here is a phrase and a category.
//
// TWO FIELDS HAVE NOW LEFT THIS SHAPE and both were removals rather than shrinks, which is worth
// noting because a worst case usually only grows. `maxGuesses` went first, taking `,"maxGuesses":9`
// -- exactly 15 bytes -- off every puzzle of this type; the ladder went second and took far more.
//
// The MEASURED figure lives in __tests__/unit/services/packs-size.test.ts and is not restated here.
// It came in at 828 B with the ladder, against the 1,030 B row the count table published as an
// ESTIMATE, and the row is now slack rather than tight. The pack total moves down with it and
// MAX_DAYS does not: a smaller pack cannot break a bound derived from a larger one.
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
