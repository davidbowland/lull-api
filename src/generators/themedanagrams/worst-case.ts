import { AnagramEntry, Difficulty, Puzzle, ThemedAnagramsData } from '../../types'
import { themedAnagramsContribution } from './contribution'
import { SCRAMBLES_PER_ENTRY } from './scramble'

// The LARGEST shape this type can emit, every bounded field filled to its bound. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * four entries at 9 letters plus FOUR scrambles of 9. MAX_WORD_LENGTH in words.ts and
//     SCRAMBLES_PER_ENTRY in scramble.ts, and every scramble is a permutation of the answer, so each
//     is EXACTLY as long -- neither the count nor the length is an independent bound.
//
//     FOUR IS THE CEILING AND THIS ROW ASSUMES IT EVERYWHERE, which is right for a worst case and
//     wrong as a description of a pack: the list is 1 to 4 and a word whose acceptable set is a
//     singleton ships one. A budget sized on the typical length would be a budget that fails on the
//     night every word happens to draw four.
//   * theme 40. MAX_THEME_LENGTH in services/anagram-sets.ts.
//   * three rungs at 80, plus metadata. MAX_ANAGRAM_RUNG_LENGTH in hints.ts, and the metadata is
//     three copies of a 23-character `kind` string plus two short fields, which is why this row is
//     the largest of the four and why an earlier estimate that ignored it came out 15% low.
//
// The real longest rung this composer can produce is under 50 characters. The figure asserted is the
// CAP-BOUNDED one, because that is the shape the size test builds and the only one that stays true
// if the templates change.
//
// SCRAMBLES_PER_ENTRY IS IMPORTED WHERE THE THREE LENGTHS BELOW ARE TRANSCRIBED, and the asymmetry is
// deliberate rather than an oversight. A transcribed bound that drifts LOW understates the worst case
// silently -- nothing goes red, because this file is the only thing the size test measures. The three
// lengths are caps on strings the size test would have to re-measure anyway; the scramble COUNT is a
// multiplier on the largest field in the shape, so drifting it low is the one that hides most. The
// import costs nothing: this module is read by the size test and by nothing in src/.
const MAX_WORD_LENGTH = 9
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_RUNG_LENGTH = 80

const entry = (): AnagramEntry => ({
  answer: 'A'.repeat(MAX_WORD_LENGTH),
  scrambles: Array.from({ length: SCRAMBLES_PER_ENTRY }, () => 'Z'.repeat(MAX_WORD_LENGTH)) as [string, ...string[]],
})

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
