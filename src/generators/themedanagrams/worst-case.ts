import { Difficulty, Puzzle, ThemedAnagramsData } from '../../types'
import { themedAnagramsContribution } from './contribution'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * four entries at 9 + 9 letters. MAX_WORD_LENGTH in words.ts, and the scramble is a permutation
//     of the answer, so it is EXACTLY as long -- not an independent bound.
//   * theme 40. MAX_THEME_LENGTH in services/anagram-sets.ts.
//   * three rungs at 80, plus metadata. MAX_ANAGRAM_RUNG_LENGTH in hints.ts, and the metadata is
//     three copies of a 23-character `kind` string plus two short fields, which is why this row is
//     the largest of the four and why an earlier estimate that ignored it came out 15% low.
//
// The real longest rung this composer can produce is under 50 characters. The figure asserted is the
// CAP-BOUNDED one, because that is the shape the size test builds and the only one that stays true
// if the templates change.
const MAX_WORD_LENGTH = 9
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_RUNG_LENGTH = 80

const entry = () => ({ answer: 'A'.repeat(MAX_WORD_LENGTH), scramble: 'Z'.repeat(MAX_WORD_LENGTH) })

const rung = (entryIndex: number, reveal: 'answer' | 'bookends' | 'initial') => ({
  metadata: { entryIndex, kind: 'themedanagrams-entry' as const, reveal },
  text: 'h'.repeat(MAX_ANAGRAM_RUNG_LENGTH),
})

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<ThemedAnagramsData> => ({
  data: {
    entries: [entry(), entry(), entry(), entry()],
    hints: [rung(2, 'initial'), rung(3, 'bookends'), rung(1, 'answer')],
    theme: 't'.repeat(MAX_THEME_LENGTH),
  },
  difficulty,
  estimatedSeconds:
    themedAnagramsContribution.baseSeconds + themedAnagramsContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-20:themedanagrams:${'f'.repeat(8)}`,
  type: 'themedanagrams',
})
