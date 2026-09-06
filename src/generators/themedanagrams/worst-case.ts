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
//
// NO HINTS ROW, AND THE SENTENCE THAT USED TO STAND HERE IS NOW FALSE. It said the rung line was the
// LARGEST FIELD IN THE SHAPE -- measured at 508 B against 341 B of entries and 42 B of theme, three
// capped rungs plus three copies of a 23-character `kind` string -- and that the reshuffle list
// closed the gap from 4.5x to 1.5x without crossing it. There is no rung line left to be largest.
// THE ENTRIES ARE NOW THE LARGEST FIELD, uncontested, and the scramble count is the only multiplier
// left on this shape.
//
// This type stopped shipping a ladder because its ladder picked three target entries by ANSWER
// LENGTH, ranked once at generate time, so a player who had already solved the longest entry still
// had the whole-answer reveal spent on it. Which entries are still unsolved is a fact about a board
// that does not exist yet, so the rungs are chosen on the device instead, by the builder in lull-ui
// at src/components/themedanagrams/rungs.ts. Nothing here imports it and nothing here runs it, which
// is why it stopped living in this repo.
//
// SCRAMBLES_PER_ENTRY IS IMPORTED WHERE THE TWO LENGTHS BELOW ARE TRANSCRIBED, and the asymmetry is
// deliberate rather than an oversight. A transcribed bound that drifts LOW understates the worst case
// silently -- nothing goes red, because this file is the only thing the size test measures. The two
// lengths are caps on strings the size test would have to re-measure anyway; the scramble COUNT is a
// multiplier on the largest field in the shape, so drifting it low is the one that hides most -- and
// it hides MORE than it did, now that the field it multiplies is no longer the second-largest. The
// import costs nothing: this module is read by the size test and by nothing in src/.
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
