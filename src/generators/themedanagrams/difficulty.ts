import { Difficulty } from '../../types'
import { agreements, longestSharedRun } from './letters'

// THE DIAL IS SCRAMBLE SEVERITY, and it is a generation INPUT code sets before the model is paid --
// never a rating derived from what came back. src/generators/cryptogram/difficulty.ts is the written
// post-mortem of the last derived dial. Word length is a GATE, not the dial; theme breadth is never
// measured, because "is this theme broad" needs a semantic oracle.
//
// A dial code sets after the model has been paid cannot STARVE ON THEME CONTENT. With the dial on
// word length, a night whose sets come back at six letters leaves a band unfillable, isComplete never
// clears, and the incomplete-pack logError fires every night with no code path able to clear it.
//
// It can still starve on word SHAPE -- a short word with a repeated pair has a tiny acceptable set
// and sometimes an empty one -- and that residual is what the over-ask absorbs, not something this
// table removes.

export interface Severity {
  // A CEILING on positions that may still hold the answer's letter. Length-aware, so one row means
  // the same thing at 5 letters and at 9.
  maxAgreements: (length: number) => number
  // The longest run of the answer's letters, at ANY offset, that may survive.
  maxPreservedRun: number
}

// TWO AXES, AND ONE IS NOT ENOUGH. An agreement ceiling is integer-valued over a range of five
// positions, so three bands cannot be separated by it at every admissible length: at length 5,
// floor(5/3) is 1 and band 3's ceiling is also 1, so those two bands accept the IDENTICAL set of
// scrambles under the ceiling alone. Every single-axis table the panel proposed collapsed a band
// somewhere, and the worst of them produced a ceiling of -1 -- a band that accepts nothing, which is
// a permanently incomplete pack rather than two bands that feel similar.
//
// The second axis is the preserved run, which Hamming cannot see at all. difficulty.test.ts asserts
// the separation exhaustively, per length, and carries the ceiling-only control that goes red the
// moment someone decides the run is redundant.
//
// ROW 5 EXISTS SO THE LOOKUP IS TOTAL, and it is a DELIBERATE DUPLICATE of row 4: the metric bottoms
// out at zero agreements and no surviving bigram, and there is nothing below it. This type declares
// [1, 3, 4] and never asks for 5. The duplicate is recorded because an unexplained duplicate row is
// exactly the thing someone later "fixes" by inventing a rule for a band nobody declared.
//
// ROW 2 IS NOW THE UNDECLARED ONE, and it is NOT a duplicate of anything -- it is a real row between
// two declared bands. It stays because the lookup must be total over Difficulty and because the band
// choice is a pack-wide decision this file does not own: 2 was declared until 2026-08-26 and may be
// again.
export const SEVERITY_BY_DIFFICULTY: Record<Difficulty, Severity> = {
  1: { maxAgreements: (length) => Math.floor(length / 2), maxPreservedRun: 4 },
  2: { maxAgreements: (length) => Math.floor(length / 3), maxPreservedRun: 3 },
  3: { maxAgreements: () => 1, maxPreservedRun: 2 },
  4: { maxAgreements: () => 0, maxPreservedRun: 1 },
  5: { maxAgreements: () => 0, maxPreservedRun: 1 },
}

/**
 * Whether this scramble is hard enough for this band. Severity only -- the structural floor that
 * applies at EVERY band lives in scramble.ts, because it is not a function of the dial.
 *
 * The catalog's "reject any scramble within one transposition of the answer" is subsumed here, at
 * every band this type declares, by the same number that sets the difficulty. One transposition of
 * an N-letter word leaves N-2 agreements; band 2's ceiling is floor(N/3), which is below N-2 for
 * every N in 6-9. One rule, not two.
 */
export const isAcceptableScramble = (answer: string, scramble: string, difficulty: Difficulty): boolean => {
  const severity = SEVERITY_BY_DIFFICULTY[difficulty]
  return (
    agreements(answer, scramble) <= severity.maxAgreements(answer.length) &&
    longestSharedRun(answer, scramble) <= severity.maxPreservedRun
  )
}
