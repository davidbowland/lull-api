import { Difficulty } from '../../types'
import { containsChargedWord } from '../../utils/model-output-checks'
import { isAcceptableScramble } from './difficulty'
import { agreements, distinctPermutations } from './letters'

// The bound counts draws, not distinct candidates: a repeat still consumes an attempt. The visited
// set is a separate early exit -- reaching distinctPermutations(answer) proves the space exhausted.
export const SCRAMBLE_ATTEMPT_CAP = 5_000

// A multiple of the space, not a flat number: the visited set removes duplicate evaluations, not
// duplicate draws. Derived so an acceptable set of size 1 -- KETTLE has one band-4 scramble out of
// 180 -- is missed under 0.1% of the time: P(miss) ~ e^(-t/n), so t >= n * ln(1000) = 6.91n.
export const ATTEMPTS_PER_PERMUTATION = 7

export const attemptBudget = (answer: string): number =>
  Math.min(SCRAMBLE_ATTEMPT_CAP, ATTEMPTS_PER_PERMUTATION * distinctPermutations(answer))

/**
 * How many scrambles an entry may carry, and so how many times the board can reshuffle. A ceiling,
 * never a quota: KETTLE's band-4 acceptable set is a singleton and ROBOT's is empty, so a quota
 * would turn a reshuffle feature into missing puzzles. The list is 1 to 4, and the extras ride the
 * existing budget, which is sized against losing the FIRST scramble.
 */
export const SCRAMBLES_PER_ENTRY = 4

/**
 * How many positions two scrambles of the same answer may share: a third of the board, rounded down.
 * Agreements rather than longestSharedRun, the opposite call from the severity dial, because a
 * shared run at a different offset is the block having moved and both strings already clear the run
 * axis against the answer. Band-independent: this asks whether the board changed, not how hard it is.
 */
export const maxSharedPositions = (length: number): number => Math.floor(length / 3)

/**
 * The structural floor, applied at every difficulty and independent of the dial. The scramble is not
 * the answer, which also discharges the `S != A` premise of the uniqueness proof, false on exactly
 * this boundary case; and the first letter moves, which the agreement ceiling does not imply, since
 * a long word can clear it while keeping its head.
 */
const meetsStructuralFloor = (answer: string, scramble: string): boolean =>
  scramble !== answer && scramble[0] !== answer[0]

/**
 * The three things a candidate must be, in one place, so no caller can apply two of them.
 *
 * The charged check cannot live at build time: the string shown to the player is composed here, out
 * of an admitted answer's letters, while the key filter in scripts/build-anagram-index.ts only
 * covers the words someone listed. It runs before the severity dial because a slur is rejected at
 * every band, and a band-conditional gate would fire or not by difficulty.
 */
const isShippable = (answer: string, scramble: string, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(answer, scramble) &&
  !containsChargedWord(scramble) &&
  isAcceptableScramble(answer, scramble, difficulty)

// Clamped because `random` is injectable: an unclamped pick reads past the end of the array and the
// write-back extends it, so the swapped slot becomes `undefined` and the joined string carries the
// literal "undefined". Number.isFinite needs its own arm, since Math.min and Math.max propagate NaN.
const clampedIndex = (draw: number, limit: number): number => {
  if (!Number.isFinite(draw)) {
    return 0
  }
  return Math.min(Math.max(Math.floor(draw * (limit + 1)), 0), limit)
}

const shuffle = (letters: string[], random: () => number): string => {
  const shuffled = [...letters]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const pick = clampedIndex(random(), index)
    const held = shuffled[index]
    shuffled[index] = shuffled[pick]
    shuffled[pick] = held
  }
  return shuffled.join('')
}

/**
 * Whether this candidate is far enough from everything already taken. Pairwise over the whole list,
 * never the previous one only: a player reaches scramble 3 by pressing the button twice, so it has
 * to differ from scramble 1 as much as from scramble 2.
 */
const isSeparated = (candidate: string, taken: string[]): boolean =>
  taken.every((scramble) => agreements(scramble, candidate) <= maxSharedPositions(candidate.length))

/**
 * Up to `SCRAMBLES_PER_ENTRY` scrambles of `answer` hard enough for `difficulty`, and separated from
 * each other. One to four, or empty when this word cannot be shown at this band.
 *
 * Empty rather than `throw`, unlike goFigure: exhaustion is a normal outcome of a word property, an
 * acceptable set being either empty (ROBOT at the hardest band) or wholly charged (AGING at band 4).
 * Both exit `[]` and are counted by generator.ts's scrambleExhausted, because a caller that could
 * tell them apart could decide to ship one. The separation gate is greedy, so this finds A separated
 * set rather than the largest.
 */
export const drawScrambles = (answer: string, difficulty: Difficulty, random: () => number = Math.random): string[] => {
  const letters = [...answer]
  const budget = attemptBudget(answer)
  const space = distinctPermutations(answer)
  const visited = new Set<string>()
  const taken: string[] = []

  for (let attempt = 0; attempt < budget; attempt += 1) {
    const candidate = shuffle(letters, random)
    if (visited.has(candidate)) {
      continue
    }
    visited.add(candidate)
    // A rejection is a redraw: the candidate is already in `visited`, so a rejected draw still
    // consumes an attempt and counts toward the exhaustion proof below.
    if (isShippable(answer, candidate, difficulty) && isSeparated(candidate, taken)) {
      taken.push(candidate)
      if (taken.length === SCRAMBLES_PER_ENTRY) {
        return taken
      }
    }
    if (visited.size >= space) {
      // Proved exhausted: every distinct string this word's letters can spell has been examined.
      return taken
    }
  }
  return taken
}
