import { AnagramEntry, Difficulty, Puzzle, ThemedAnagramsData } from '../../types'
import { themedAnagramsContribution } from './contribution'
import { SCRAMBLES_PER_ENTRY } from './scramble'

// The largest shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by nothing in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// Derived, not estimated: four entries at MAX_WORD_LENGTH (words.ts) plus SCRAMBLES_PER_ENTRY
// scrambles of the same length, since every scramble is a permutation of its answer; theme 40 from
// MAX_THEME_LENGTH in services/anagram-sets.ts. Four scrambles is the ceiling, not the typical count.
//
// SCRAMBLES_PER_ENTRY is imported while the two lengths below are transcribed, deliberately: a
// transcribed bound that drifts low understates the worst case silently, and the scramble count
// multiplies the largest field in the shape, so drifting it low hides most.
const MAX_WORD_LENGTH = 9
const MAX_THEME_LENGTH = 40

const entry = (): AnagramEntry => ({
  answer: 'A'.repeat(MAX_WORD_LENGTH),
  scrambles: Array.from({ length: SCRAMBLES_PER_ENTRY }, () => 'Z'.repeat(MAX_WORD_LENGTH)) as [string, ...string[]],
})

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<ThemedAnagramsData> => ({
  data: {
    entries: [entry(), entry(), entry(), entry()],
    theme: 't'.repeat(MAX_THEME_LENGTH),
  },
  difficulty,
  estimatedSeconds:
    themedAnagramsContribution.baseSeconds + themedAnagramsContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-08-20:themedanagrams:${'f'.repeat(8)}`,
  type: 'themedanagrams',
})
