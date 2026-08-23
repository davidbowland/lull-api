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

// A redraw cap, not a retry budget. Every difficulty band is reachable from ~99% of random banks,
// so this only ever fires against a stuck random source. It throws rather than recursing because
// createPack catches per generate() call: a throw costs one puzzle, while an unbounded retry would
// burn the whole 900-second invocation with nothing in the logs to explain it.
const MAX_DRAW_ATTEMPTS = 100

// Distinct operator tuples is the primary signal, with expression count breaking the tie inside
// tuple-count 1 -- see enumerate.ts. Measured over 500 random banks this spreads roughly
// 39/14/16/14/17 percent across difficulties 5 down to 1, and every band is reachable from at
// least 98.8% of banks. The original game's own puzzle (goal 154 from bank 6,9,7,7: one tuple, six
// expressions) lands at 4.
// The one-tuple test in the first branch is load-bearing beyond difficulty. It is what makes
// "difficulty 4 or 5" mean exactly "the operator tuple is unique", and hints.ts spends that
// equivalence: it drops the hedge -- printing the UNQUALIFIED "The 2nd operator from the left is X"
// -- on precisely the puzzles whose tuple count is 1. Move this boundary and a puzzle graded 4 can
// have alternatives, so a rung starts asserting something false about solutions it does not
// describe. hints.ts reads the tuple count itself rather than trusting a difficulty, and
// generator.test.ts pins the two ends together on real generated puzzles.
export const difficultyForSolution = (solution: Solution): Difficulty => {
  const tupleCount = solution.operatorTuples.length
  if (tupleCount === 1) {
    return solution.expressions.length <= 2 ? 5 : 4
  }
  return tupleCount === 2 ? 3 : tupleCount <= 4 ? 2 : 1
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
// 98.4%, so the 100-attempt cap remains unreachable in practice.
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
  // looked at. goFigure takes the three ODD bands because it is the only self-contained type -- the
  // only one that can cover a band without spending a phrase -- so the two corpus consumers cover 2
  // and 4 between them and every band is covered exactly by the type that can afford it.
  //
  // Bands 2 and 4 remain gradeable and generatable: difficultyForSolution still returns them, and
  // generate() accepts any difficulty it is handed. They are simply not what a pack asks for.
  difficulties: [1, 3, 5],
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
