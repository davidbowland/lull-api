import { Difficulty } from '../../types'
import { containsChargedWord } from '../../utils/model-output-checks'
import { isAcceptableScramble } from './difficulty'
import { agreements, distinctPermutations } from './letters'

// BOUNDED per CLAUDE.md, and the bound is on DRAWS: every Fisher-Yates draw consumes one attempt,
// including a repeat. A bound that only counted NEW candidates would not be a bound -- it permits an
// unbounded spin on repeats, which is the outcome the rule exists to forbid.
//
// The visited set is an EXIT, never a budget. When it reaches distinctPermutations(answer) the space
// is provably exhausted and the loop returns `undefined` early, having PROVED there is no acceptable
// scramble rather than having merely failed to find one.
export const SCRAMBLE_ATTEMPT_CAP = 5_000

// WHY A MULTIPLE OF THE SPACE, rather than a flat number. A visited set removes duplicate
// EVALUATIONS; it does not remove duplicate DRAWS. Exhausting a 60-string space by random draw is
// coupon collection -- about 281 draws in expectation -- so a flat 200 stops on the cap without
// having exhausted anything nine times in ten, and the "or the space is reached" exit becomes
// decoration. That matters because the hardest band's acceptable sets are small: KETTLE, the
// catalog's own example, has exactly ONE acceptable band-4 scramble out of 180, and 200 draws finds
// it two times in three.
//
// So the bound is derived from a stated requirement instead. For the worst admissible case -- an
// acceptable set of size exactly 1 -- the loop must miss it with probability under 0.1%. With t draws
// over n distinct permutations, P(miss) is about e^(-t/n), and under 0.1% needs t >= n * ln(1000) =
// 6.91n. Hence 7, with the cap so the multiple cannot run away at length 9.
export const ATTEMPTS_PER_PERMUTATION = 7

export const attemptBudget = (answer: string): number =>
  Math.min(SCRAMBLE_ATTEMPT_CAP, ATTEMPTS_PER_PERMUTATION * distinctPermutations(answer))

/**
 * How many scrambles an entry may carry, and therefore how many times the board can reshuffle.
 *
 * FOUR IS A CEILING, NEVER A QUOTA, and the difference is the whole of this module's contract. The
 * acceptable set is sometimes smaller than four and sometimes EMPTY -- KETTLE's band-4 set is a
 * singleton and ROBOT's is empty -- so a quota would drop words that ship perfectly well today and
 * turn a reshuffle feature into missing puzzles. The list is 1 to 4 and the caller reads its length.
 *
 * THE BUDGET IS NOT RAISED FOR IT. `ATTEMPTS_PER_PERMUTATION` is 7 because ln(1000) buys a
 * one-in-n target at under 0.1% miss, and that derivation is about not losing the FIRST scramble,
 * which costs a puzzle slot. Missing a fourth costs a shorter list, which is the graceful outcome
 * this ceiling is designed around -- so the extras ride the existing budget rather than inflating it
 * for a failure that does not matter.
 */
export const SCRAMBLES_PER_ENTRY = 4

/**
 * How many positions two scrambles OF THE SAME ANSWER may share.
 *
 * A THIRD OF THE BOARD, rounded down: 1 at five letters, 3 at nine. A reshuffle that leaves most of
 * the tiles where they were is a reshuffle the player did not get, and position agreement is exactly
 * what "the tiles did not move" means to someone looking at the board.
 *
 * AGREEMENTS, NOT longestSharedRun, and that is the opposite call from the severity dial. The run
 * axis exists there because a run of the ANSWER surviving anywhere hands the reader the answer. Two
 * scrambles sharing a run at different offsets is the block having MOVED, which reads as a genuine
 * reshuffle; and both strings already clear the run axis against the answer, so nothing is unguarded.
 *
 * BAND-INDEPENDENT, deliberately. This asks whether the board changed, not how hard it is. Folding it
 * into SEVERITY_BY_DIFFICULTY would make "did pressing the button do anything" a function of the
 * difficulty dial, which is not a thing the dial means.
 */
export const maxSharedPositions = (length: number): number => Math.floor(length / 3)

/**
 * THE STRUCTURAL FLOOR, applied at every difficulty and independent of the dial.
 *
 * 1. The scramble is not the answer. This is ALSO what discharges the `S != A` premise of the
 *    uniqueness proof -- the proof that no scramble of an admitted word is a word is false on
 *    exactly this boundary case, because the answer is a permutation of its own letters and the
 *    answer IS a word. Weakening this rule makes that proof false, so it is not merely a fairness
 *    check.
 * 2. The first letter moves. It is the single largest giveaway and is NOT implied by the agreement
 *    ceiling, which a long word can clear while keeping its head.
 */
const meetsStructuralFloor = (answer: string, scramble: string): boolean =>
  scramble !== answer && scramble[0] !== answer[0]

/**
 * THE THREE THINGS A CANDIDATE MUST BE, in one place, so no caller can apply two of them.
 *
 * The charged check is the one that could not live at build time, and the reason is the whole point.
 * The string shown to the player is not drawn from any list -- it is composed HERE, at generate time,
 * out of an admitted answer's letters -- so here is the only place it can be checked. Everything
 * upstream is a bet that somebody wrote the right word down: the key filter in
 * scripts/build-anagram-index.ts drops an anagram class only when a LISTED form has that exact letter
 * multiset, which is why NIGGER being listed did nothing for NIGGA, TRANNY nothing for TRANNIE and
 * WANKER nothing for WANKERS. AGING cleared every admissibility gate -- five letters, multiplicity 2,
 * exactly 60 distinct permutations, a unique anagram, not itself charged -- and its band-4 acceptable
 * set had exactly one member, which was a slur. Two hundred band-4 runs out of two hundred shipped it.
 *
 * The list has since been widened, so AGING is no longer admitted at all. That is the belt; this is
 * the braces, and it is the half that still holds when the next unlisted form turns up. A widened
 * list covers the words someone thought of. This covers the string.
 *
 * Ordered cheapest first, and the charged check runs BEFORE the severity dial deliberately: a slur is
 * rejected at every band, so making it conditional on the band it happened to be drawn for would be a
 * gate that fires or not depending on the difficulty.
 */
const isShippable = (answer: string, scramble: string, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(answer, scramble) &&
  !containsChargedWord(scramble) &&
  isAcceptableScramble(answer, scramble, difficulty)

// CLAMPED, copied from cryptogram/cipher.ts including the reason: `random` is injectable, and an
// out-of-range or NaN draw is silent corruption rather than a crash. An unclamped pick reads past the
// end of the array and the write-back EXTENDS it, so the swapped slot becomes `undefined` and the
// joined string carries the literal "undefined" -- which would surface as the generator's round-trip
// assertion throwing with a nonsense message instead of the real one.
//
// Number.isFinite needs its own arm: Math.min and Math.max both propagate NaN.
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
 * Whether this candidate is far enough from everything already taken.
 *
 * PAIRWISE OVER THE WHOLE LIST, never against the previous one only. A player reaches scramble 3 by
 * pressing the button twice, so it has to differ from scramble 1 as much as from scramble 2 --
 * neighbour-checking passes every two-element case and then ships a third board that looks like the
 * first.
 */
const isSeparated = (candidate: string, taken: string[]): boolean =>
  taken.every((scramble) => agreements(scramble, candidate) <= maxSharedPositions(candidate.length))

/**
 * Up to `SCRAMBLES_PER_ENTRY` scrambles of `answer` hard enough for `difficulty`, and separated from
 * each other. One to four, or EMPTY when this word cannot be shown at this band.
 *
 * EMPTY, NOT `throw`, and this is a deliberate departure from goFigure's worked example. That one
 * earns its throw with a measured claim -- every band is reachable from ~99% of random banks, so it
 * only fires against a stuck random source. That claim is FALSE here by construction: at the hardest
 * band a five-letter word with a repeated pair can have a genuinely empty acceptable set, and ROBOT
 * is a real example. Exhaustion is a normal outcome of a word property, so throwing would name the
 * wrong cause at 3am and convert a word-shape problem into a missing puzzle. The rule is about
 * BOUNDING; what changes is what the bound does when it is reached.
 *
 * THERE ARE NOW TWO WAYS TO EXHAUST, and they exit identically on purpose. The acceptable set can be
 * empty (ROBOT), or every member of it can be charged (AGING at band 4, whose set is a single slur).
 * Both mean this word cannot be shown at this band, both return `[]`, and both are counted by
 * generator.ts's scrambleExhausted -- because a caller that could tell them apart would be a caller
 * that could decide to ship one of them.
 *
 * A SHORT LIST IS A NORMAL RETURN and never an error, which is why the two "not four" exits below --
 * the exhaustion proof and the spent budget -- return what they have rather than discarding it. The
 * counting happens in generator.ts, which logs the length distribution; deciding here would mean
 * deciding what a shortfall is worth, and that is a pack-wide question this module does not own.
 *
 * THE SEPARATION GATE IS GREEDY AND FIRST-COME. An early pick can block a later one, so this finds A
 * separated set rather than the LARGEST separated set. Searching for the maximum is a combinatorial
 * problem to buy at most one extra reshuffle, and the bound on draws is the thing that must not move.
 *
 * ONE COST CHANGED. This no longer returns on the first hit, so a word that cannot reach four spends
 * its whole budget where it used to return in two draws -- exhausting the budget goes from rare to
 * routine. At the SCRAMBLE_ATTEMPT_CAP of 5,000 Fisher-Yates passes over at most nine characters
 * that is microseconds, which is why the cap rather than the multiple is what keeps this safe.
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
    // A REJECTION IS A REDRAW, NEVER A FALL-THROUGH. The candidate is already in `visited`, so a
    // charged draw consumes an attempt exactly like any other rejection and still counts toward the
    // exhaustion proof below. A word whose whole acceptable set is charged therefore leaves by the
    // same `[]` the empty-set case uses, and entriesAt drops it down the existing scrambleExhausted
    // path. There is deliberately no branch that ships a rejected string.
    if (isShippable(answer, candidate, difficulty) && isSeparated(candidate, taken)) {
      taken.push(candidate)
      if (taken.length === SCRAMBLES_PER_ENTRY) {
        return taken
      }
    }
    if (visited.size >= space) {
      // PROVED exhausted rather than merely not found. Every distinct string this word's letters can
      // spell has now been examined, so `taken` is everything this word HAS at this band.
      return taken
    }
  }
  return taken
}
