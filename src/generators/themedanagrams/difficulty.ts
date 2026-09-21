import { Difficulty } from '../../types'
import { agreements, longestSharedRun } from './letters'

// The dial is scramble severity: a generation INPUT code sets before the model is paid, never a
// rating derived from what came back, so it cannot starve on theme content. With the dial on word
// length instead, a night whose sets come back short leaves a band unfillable and isComplete never
// clears. It can still starve on word SHAPE, and that residual is what the over-ask absorbs.

export interface Severity {
  // A ceiling on positions that may still hold the answer's letter. Length-aware, so one row means
  // the same thing at 5 letters and at 9.
  maxAgreements: (length: number) => number
  // The longest run of the answer's letters, at any offset, that may survive.
  maxPreservedRun: number
}

// Two axes, because one is not enough: an agreement ceiling is integer-valued over five positions,
// so at length 5 floor(5/3) and band 3's ceiling are both 1 and those bands accept identical sets.
// The second axis is the preserved run, which Hamming cannot see. difficulty.test.ts asserts the
// separation per length and carries a ceiling-only control against removing the run.
//
// Rows 2 and 5 are undeclared -- this type declares [1, 3, 4] -- and exist so the lookup is total
// over Difficulty. Row 5 duplicates row 4 because the metric bottoms out there.
export const SEVERITY_BY_DIFFICULTY: Record<Difficulty, Severity> = {
  1: { maxAgreements: (length) => Math.floor(length / 2), maxPreservedRun: 4 },
  2: { maxAgreements: (length) => Math.floor(length / 3), maxPreservedRun: 3 },
  3: { maxAgreements: () => 1, maxPreservedRun: 2 },
  4: { maxAgreements: () => 0, maxPreservedRun: 1 },
  5: { maxAgreements: () => 0, maxPreservedRun: 1 },
}

/**
 * Whether this scramble is hard enough for this band. Severity only -- the structural floor that
 * applies at every band lives in scramble.ts, because it is not a function of the dial. The
 * catalog's "reject any scramble within one transposition" is subsumed by the same number that sets
 * the difficulty: one transposition leaves N-2 agreements, below every declared ceiling for N in 6-9.
 */
export const isAcceptableScramble = (answer: string, scramble: string, difficulty: Difficulty): boolean => {
  const severity = SEVERITY_BY_DIFFICULTY[difficulty]
  return (
    agreements(answer, scramble) <= severity.maxAgreements(answer.length) &&
    longestSharedRun(answer, scramble) <= severity.maxPreservedRun
  )
}
