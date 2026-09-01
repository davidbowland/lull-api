// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. The tests travel with the rule so the copy is proved to BEHAVE
// rather than merely to match a diff.
//
// It lives here rather than shipping as data on the puzzle because the hint rules that read it run
// over what a player has established at play time, which no generator can enumerate in advance.
//
// THESE ARE ENGLISH LETTER FREQUENCIES AS PERCENTAGES, and they are a fixed table rather than
// something measured off a corpus. A frequency derived from the phrase corpus would drift every time
// the corpus grew, which would silently re-rank hints on puzzles that had already shipped.
//
// NOT USED BY CRYPTOGRAM, which ranks letters by their frequency in its OWN ciphertext instead. A
// letter that appears six times in one puzzle is worth more there than one that is common in the
// language and appears once. This table is Phrazle's, where the player is reasoning about the
// alphabet rather than about a fixed set of squares.
//
// FROZEN, like the two orderings below it. This table is the ranking behind every Phrazle letter
// rung, so a caller that could write one number into it would silently re-rank hints for the rest of
// the process's life -- and in lull-ui that process is a browser tab a player leaves open.
export const LETTER_STRENGTHS: Readonly<Record<string, number>> = Object.freeze({
  A: 8.4966,
  B: 2.072,
  C: 4.5388,
  D: 3.3844,
  E: 11.1607,
  F: 1.8121,
  G: 2.4705,
  H: 3.0034,
  I: 7.5448,
  J: 0.1965,
  K: 1.1016,
  L: 5.4893,
  M: 3.0129,
  N: 6.6544,
  O: 7.1635,
  P: 3.1671,
  Q: 0.1962,
  R: 7.5809,
  S: 5.7351,
  T: 6.9509,
  U: 3.6308,
  V: 1.0074,
  W: 1.2899,
  X: 0.2902,
  Y: 1.7779,
  Z: 0.2722,
})

// Computed once at module load rather than written out by hand, so the orderings cannot disagree
// with the table above. The tie-break is alphabetical and is stated rather than left to the sort's
// stability: no two entries in this table are equal today, so the comparator's second term is
// unreachable, and it is written anyway because a table someone edits later may have a tie.
const strongestFirst = (letters: string[]): string[] =>
  [...letters].sort((left, right) => LETTER_STRENGTHS[right] - LETTER_STRENGTHS[left] || (left < right ? -1 : 1))

/** Every letter A-Z, commonest first. */
export const STRONGEST_FIRST: readonly string[] = Object.freeze(strongestFirst(Object.keys(LETTER_STRENGTHS)))

/**
 * Every letter A-Z, rarest first.
 *
 * REVERSED FROM THE LIST ABOVE, not sorted a second time, and that is the whole reason this is not a
 * one-line call to the same comparator with the sign flipped. A second sort would break ties
 * alphabetically in BOTH directions, so the day two letters tie the two lists stop being reverses of
 * each other -- while letter-strengths.test.ts asserts exactly that reversal. Deriving it makes the
 * property hold by construction, and the cost is that ties here read reverse-alphabetically.
 */
export const WEAKEST_FIRST: readonly string[] = Object.freeze([...STRONGEST_FIRST].reverse())
