import { randomBytes } from 'node:crypto'

import { Difficulty, Generator, GoFigureData, Operator, PackDate, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { enumerateSolutions, Solution } from './enumerate'
import { buildHints } from './hints'

const PUZZLE_TYPE = 'gofigure'

const OPERATORS: Operator[] = ['+', '-', '*', '/']

const BANK_SIZE = 4
const MIN_DIGIT = 1
const MAX_DIGIT = 9

// A redraw cap, not a retry budget. Every difficulty band is reachable from at least 94.6% of
// random banks, so this only ever fires against a stuck random source. Re-measured over all 6,561
// equally likely draws after the operator-cost cap replaced the mix cap: 5 is the tightest at
// 94.65%, and 100 attempts against it is a miss probability around 10^-127. It throws rather than
// recursing because
// createPack catches per generate() call: a throw costs one puzzle, while an unbounded retry would
// burn the whole 900-second invocation with nothing in the logs to explain it.
const MAX_DRAW_ATTEMPTS = 100

// How hard each operator is to REACH FOR, which is not how hard it is to compute. A player scanning
// a bank tries sums first and products second; a difference means deliberately overshooting the goal
// and coming back, and a quotient means spotting a factor relationship among four digits and is the
// only one that can fail outright on whole numbers.
//
// The gap from '-' to '/' is double the gap from '+' to '-' on purpose. These are search costs
// rather than a ranking, so the arithmetic below reads them as distances, and '/' really is further
// out than the other three are from each other.
const OPERATOR_WEIGHT: Record<Operator, number> = { '*': 1, '+': 0, '-': 2, '/': 4 }

/**
 * How much searching an operator arrangement costs a player, ignoring the digits entirely.
 *
 * TWO TERMS, and dropping either one collapses a distinction that matters. The MAX says how far out
 * the arrangement's worst operator is -- an arrangement is only as findable as its least obvious
 * step -- and the variety term says how many different keys the player had to think of at all.
 * Without the max, "+-+" and "+*+" tie; without the variety term, "---" and "-+-" do.
 *
 * Its predecessor sorted tuples into same/family/cross and so could not tell '+' from '/'. That
 * rated "++*" -- two of the three cheapest operators -- a full cross-family search, equal to "-/*",
 * while rating the dearer "+-+" below both for sitting inside one family. The families are simply
 * the wrong axis: what costs a player is which operators, not which halves of the keypad.
 */
export const operatorCost = (tuple: Operator[]): number =>
  Math.max(...tuple.map((operator) => OPERATOR_WEIGHT[operator])) + (new Set(tuple).size - 1)

// The band an arrangement of a given cost is ALLOWED to reach. A ceiling, never a floor -- see
// difficultyForSolution.
//
// 2 at the bottom rather than 1, and that is a content decision rather than a fallout. 1 is not in
// `difficulties` below, so capping there would stop these puzzles reaching a player at all; capping
// at 2 keeps "7+7+7+7" shipping daily, in the easy slot where it belongs.
//
// NO OPERATOR IS REQUIRED BY ANY BAND, which is a property of this table and not an accident.
// Reaching the 4 that admits difficulty 5 takes a '/' OR a '-' alongside two other kinds, so over
// every bank multiset 1-9 x 4 a '/' turns up in the cheapest route of 33% of difficulty-5 goals and
// 7% of difficulty-4 goals. A table that made the top band mean "there is a division in here" would
// hand the player a free constraint every time the shelf printed a difficulty.
const capForCost = (cost: number): Difficulty => (cost <= 1 ? 2 : cost === 2 ? 3 : cost === 3 ? 4 : 5)

// A solution is as easy as its CHEAPEST arrangement, because a player only has to find one of them.
// So the cap is the minimum over the tuples, not the cap of the canonical tuple hints.ts picks and
// not the cap of tuples[0]: enumerateSolutions sorts on raw ASCII, where '*' precedes '+', so the
// giveaway all-plus arrangement is routinely somewhere in the middle of the list.
const costCapForSolution = (solution: Solution): Difficulty =>
  solution.operatorTuples.reduce<Difficulty>((cap, tuple) => {
    const candidate = capForCost(operatorCost(tuple))
    return candidate < cap ? candidate : cap
  }, 5)

// TWO SIGNALS, and the second only ever lowers the first.
//
// HOW MANY ANSWERS THERE ARE is primary, counted as distinct IDEAS -- see idea.ts. Not expressions,
// and not operator tuples:
//
//   * EXPRESSIONS overcount, badly. "a+b+c+d" is twenty-four expressions and one answer; over every
//     bank multiset 1-9 x 4, 81% of positive goals have more expressions than ideas. This count used
//     to break the tie between difficulty 5 and 4, which meant the boundary between the two hardest
//     bands this type ships was drawn on how permutable the operands happened to be. 99% of goals
//     with a unique operator tuple are a single idea, so the median idea count at difficulty 4 and
//     at difficulty 5 was 1 and 1: the split separated nothing.
//   * TUPLES undercount, because one tuple can carry two genuinely different routes -- 5/2*2 and
//     2*5/2 are one idea while 2/2*5 is another, all reaching 5 from bank 5,2,2.
//
// The idea count sits between them and is the number a player would give if asked how many ways
// there are. Ungated it spreads 52/15/12/12/8 percent across difficulties 5 down to 1.
//
// OPERATOR COST is a ceiling on that, and it is here because ambiguity alone got a whole shape
// backwards. A goal reachable only by "7+7+7+7" is exactly one idea, so the ambiguity grade calls it
// the hardest thing this type emits, while a player solves it by tapping one operator three times
// and never searching at all. Uniqueness is only hard when finding the unique thing is hard.
//
// The spread AFTER the cap is 10/23/44/15/8 percent across 5 down to 1, and that is the number
// quoted on `difficulties`. The original game's own puzzle -- goal 154 from bank 6,9,7,7: one idea
// carried by six expressions, tuple "++*" -- lands at 3, down from the 4 the expression tiebreaker
// gave it. One answer, made of the two cheapest operators, is a middling puzzle and not a hard one.
//
// WHAT THE HARD BANDS STILL GUARANTEE, since hints.ts drops the hedge -- printing the UNQUALIFIED
// "The 2nd operator from the left is X" -- on precisely the puzzles whose tuple count is 1:
// difficulty 5 is the ONE-IDEA band, and an idea never spans two tuples, so 5 still implies a unique
// tuple. FOUR NO LONGER DOES: it is the two-idea band, and two ideas may sit in one tuple or in two
// -- measured, 61% of difficulty-4 goals are one-tuple. Nothing may be built on the converse in
// either direction. hints.ts reads the tuple count itself rather than trusting a difficulty, so it
// was never exposed; generator.test.ts states the surviving direction at 5 as its own assertion and
// keys the hedge and slot-order tests on the tuple count instead of the band.
export const difficultyForSolution = (solution: Solution): Difficulty => {
  const ideaCount = solution.ideas.length
  const byAmbiguity: Difficulty =
    ideaCount === 1 ? 5 : ideaCount === 2 ? 4 : ideaCount <= 4 ? 3 : ideaCount <= 9 ? 2 : 1
  const cap = costCapForSolution(solution)
  return byAmbiguity < cap ? byAmbiguity : cap
}

const drawBank = (random: () => number): number[] =>
  Array.from({ length: BANK_SIZE }, () => MIN_DIGIT + Math.floor(random() * (MAX_DIGIT - MIN_DIGIT + 1)))

// Sorted before selection on purpose: Map insertion order follows the permutation walk inside
// enumerateSolutions, so selecting from the unsorted entries would make the generator quietly
// irreproducible the day that walk changes.
// Positive goals only. Without the filter about 28% of reachable goals are negative (36% at
// difficulty 5), so a pack would routinely open with "make -1" -- a content decision that would
// have fallen out of uniform selection rather than being made. The original game and the catalog
// both only ever show a positive target. The cost is nil: per-band bank reachability stays above
// 94.6% with this filter AND the operator-cost cap both applied, so the 100-attempt cap remains
// unreachable in practice.
const goalsAtDifficulty = (bank: number[], difficulty: Difficulty): [number, Solution][] =>
  [...enumerateSolutions(bank, OPERATORS).entries()]
    .filter(([goal, solution]) => goal > 0 && difficultyForSolution(solution) === difficulty)
    .sort(([left], [right]) => left - right)

const defaultShortId = (): string => randomBytes(4).toString('hex')

// The difficulty is an INPUT, never derived from a slot or an index, and the id carries no
// position -- identity is an opaque address, generated once, so a regenerated puzzle is not
// obliged to keep an old one's content.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  random: () => number = Math.random,
  createShortId: () => string = defaultShortId,
): Promise<Puzzle<GoFigureData>> => {
  for (let attempt = 1; attempt <= MAX_DRAW_ATTEMPTS; attempt++) {
    const bank = drawBank(random)
    const candidates = goalsAtDifficulty(bank, difficulty)

    if (candidates.length > 0) {
      const [goal, solution] = candidates[Math.floor(random() * candidates.length)]
      log('Generated goFigure puzzle', { attempt, bank, date, difficulty, goal })
      return {
        data: {
          acceptedSolutions: solution.expressions,
          bank,
          goal,
          // Derived, not generated: a pure synchronous function over the expressions just computed.
          // It cannot fail on anything this generator can hand it, so it widens no per-puzzle
          // failure surface -- and one regex strip per accepted solution over a list already in
          // memory does not move a p50 of 2.3 ms, so inRequest stays true.
          //
          // The whole solution list, and NOT the difficulty. buildHints reads the hedge and the slot
          // order off the tuple count in these expressions; handing it a difficulty as well would be
          // a second, independent input describing the same fact, and the two could disagree.
          hints: buildHints(solution.expressions),
          operators: OPERATORS,
        },
        difficulty,
        estimatedSeconds: goFigureGenerator.baseSeconds + goFigureGenerator.secondsPerDifficulty * (difficulty - 1),
        id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
        type: PUZZLE_TYPE,
      }
    }
  }

  throw new Error(`Could not draw a goFigure bank reaching difficulty ${difficulty} in ${MAX_DRAW_ATTEMPTS} attempts`)
}

// `generate` above reads baseSeconds and secondsPerDifficulty off this binding, and the fact worth a
// reader's attention is WRITABILITY rather than order.
//
// Order is a non-issue: `generate` is a const arrow declared before this literal but only reads it at
// CALL time, and no call can precede module evaluation, because nothing under src/generators imports
// back into the registry index -- there is no cycle here for a dead zone to open in.
//
// What actually changed when these stopped being module constants is that they became reachable from
// outside. BASE_SECONDS was a module `const`: no importer could write it. These are own properties of
// an exported object, and `const` protects the BINDING, not the fields -- measured, the descriptor is
// { writable: true, enumerable: true, configurable: true }, and `goFigureGenerator.baseSeconds = 9999`
// moves the next puzzle's estimatedSeconds from 60 to 9999. No untrusted input reaches this object, so
// it is not a security property; it is a fact about what an importer can now do, and the reason the
// numbers are pinned by assertion at every shipped difficulty rather than left to the compiler.
export const goFigureGenerator: Generator<GoFigureData> = {
  // 2026-08-01, a LITERAL matching PACK_START_DATE and never read from config.ts. It is the date
  // this TYPE shipped, not the date the stack's floor happens to sit at, and wiring it to an env var
  // would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog gives goFigure a 1-3 minute range; BASE is the low end and PER is (high - low) / 4,
  // so difficulty 5 lands exactly on 180. The shelf PRINTS estimatedSeconds on every row; it no
  // longer sorts on it (lull-ui orders difficulty, then bench, then id). It is still the one figure
  // comparable ACROSS types, which is what a reader choosing by time actually needs -- and it is
  // what a pack-duration ceiling would be summed from, which is why the two numbers live on this
  // literal rather than as module constants a test over the registry cannot reach.
  baseSeconds: 60,
  // The measured 9.7 ms WORST rounded up, never the 2.3 ms p50: a budget is spent at the worst case.
  budgetMsPerPuzzle: 10,
  countPerDay: 3,
  // One target per puzzle, and the bands come from the pack-wide count table rather than from this
  // file: a number chosen per generator produces a pack whose difficulty histogram nobody has
  // looked at.
  //
  // ALL THREE ARE GENERATABLE, which is the only thing this file gets to assert about them:
  // difficultyForSolution returns every band from 1 to 5, generate() accepts any band it is handed,
  // and the measured spread over every positive goal of every bank multiset 1-9 x 4 is 10/23/44/15/8
  // percent across 5 down to 1, with every band reachable from at least 94.6% of the 6,561 equally
  // likely draws. The 100-attempt redraw cap is nowhere near binding at any of these. Re-measured
  // when grading moved to idea count with an operator-cost cap; the previous pair of signals put 35%
  // of goals at band 5, and most of what left was a one-idea goal whose only route is cheap.
  //
  // BAND 3 IS THE BIG ONE at 44%, and it does not ship. That is a consequence of the cap table
  // rather than a target: cost 2 is "+", "*" and nothing dearer, which is a great many arrangements.
  // It matters only if a fourth band is ever added here.
  //
  // 4 AND 5 ARE NO LONGER THE SAME REGIME, which is the part not visible from the numbers. 5 is the
  // ONE-IDEA band and 4 is the TWO-IDEA band, and only the first of those implies a unique operator
  // tuple. hints.ts drops the hedge and prints the unqualified "The 2nd operator from the left is X"
  // on the one-tuple puzzles, so the daily difficulty-5 puzzle always carries an unhedged operator
  // rung, the difficulty-4 one does about 61% of the time, and the difficulty-2 one about 13%. All
  // three are correct copy on a genuinely unique tuple, and hints.ts reads the tuple count itself
  // rather than trusting a difficulty, so nothing asserts anything false.
  difficulties: [2, 4, 5],
  generate,
  // Measured over 200 trials, on the FIVE-puzzle pack this type used to build: 2.3ms at p50, 9.7ms
  // at worst, PER PUZZLE. The count table has since taken it to three, so the measured pair is now a
  // conservative reading of a smaller draw -- the per-puzzle figure budgetMsPerPuzzle carries is the
  // one the registry budget assertion spends, and it did not move. No model, no network, no
  // corpus.
  //
  // Re-taken on the three-puzzle day by `npm run benchmark-generators` (2026-08-23, local dev
  // machine, 200 trials): 0.42ms per puzzle at p50, 1.75ms at worst. The declaration STAYS at 10 --
  // the 9.7ms it rounds up is a slower reading on a bigger draw, and a budget spent at the worst
  // case does not get relaxed because one machine on one day was faster. Re-run before flipping any
  // OTHER generator to inRequest, and read the number off `| tail -1`; generate() logs as it goes.
  inRequest: true,
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
