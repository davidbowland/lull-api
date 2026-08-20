import { Difficulty } from '../types'

// Whether the category is shown AT ALL, as a function of difficulty. Shared by every phrase type
// rather than owned by one: Missing Vowels, Cryptogram and Phrazle are one phrase in three
// costumes, and a dial that moved on different steps per type would make the same number mean
// different things on the shelf.
//
//   1 -- category shown
//   2 -- category shown
//   3 -- category hidden
//   4 -- category shown
//   5 -- category hidden
export const CATEGORY_HIDDEN_BY_DIFFICULTY: Record<Difficulty, boolean> = {
  1: false,
  2: false,
  3: true,
  4: false,
  5: true,
}
