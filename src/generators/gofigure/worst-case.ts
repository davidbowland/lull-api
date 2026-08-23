import { Difficulty, GoFigureData, Puzzle } from '../../types'
import { goFigureGenerator } from './generator'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module
// rather than an export on the generator, so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle.
//
// DERIVED, not estimated, and NOT from the caps the phrase types use. goFigure's rung text is not
// model prose: utils/phrase-checks.ts says so in as many words ("goFigure's rung text is built by
// textFor from a closed set of templates and cannot exceed a known size"), so MAX_HINT_LENGTH's 200
// does not apply here and pricing this type against it would over-state its row by a factor of four.
// Every constant below was MEASURED against the code that produces it:
//
//   * 88 accepted solutions. The largest number of distinct expression strings any single positive
//     goal has, over every bank multiset 1-9 x 4 -- bank [1, 1, 2, 3], goal 6, seventeen operator
//     tuples. Each expression is exactly seven characters: four one-digit operands and three
//     operators, fixed by BANK_SIZE and MIN_DIGIT/MAX_DIGIT.
//   * goal 6,561. The largest positive goal reachable, which is 9*9*9*9 evaluated left to right.
//   * the rung text. The longest of textFor's four templates, at 49 UTF-8 bytes: the hedged
//     first-rung form carrying U+2212 MINUS SIGN, which is three bytes rather than one. Written as
//     an escape, never pasted -- U+2212 is not U+002D and not U+2013, and a diff cannot tell them
//     apart.
const MAX_ACCEPTED_SOLUTIONS = 88
const MAX_GOAL = 6_561
const LONGEST_RUNG_TEXT = 'One winning answer has "\u2212" as its 1st operator.'

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<GoFigureData> => ({
  data: {
    acceptedSolutions: Array.from({ length: MAX_ACCEPTED_SOLUTIONS }, () => '9-9-9-9'),
    bank: [9, 9, 9, 9],
    goal: MAX_GOAL,
    // The ladder is always three rungs, and every rung carries the same required metadata, so the
    // worst case is three copies of the longest text rather than a real ladder. This fixture is
    // sized, never played.
    hints: [0, 1, 2].map((slot) => ({
      metadata: { kind: 'gofigure-operator' as const, operator: '-' as const, slot: slot as 0 | 1 | 2 },
      text: LONGEST_RUNG_TEXT,
    })) as GoFigureData['hints'],
    operators: ['+', '-', '*', '/'],
  },
  difficulty,
  estimatedSeconds: goFigureGenerator.baseSeconds + goFigureGenerator.secondsPerDifficulty * (difficulty - 1),
  // A pack date is always ten characters and a short id always eight hex, so the id has one length.
  id: `2026-08-20:gofigure:${'f'.repeat(8)}`,
  type: 'gofigure',
})
