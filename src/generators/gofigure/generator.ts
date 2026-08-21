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

// The catalog gives goFigure a 1-3 minute range; this puts the midpoint at difficulty 3. The shelf
// PRINTS this number on every row; it no longer sorts on it (lull-ui orders difficulty, then bench,
// then id). It is still the one figure comparable ACROSS types, which is what a reader choosing by
// time actually needs.
const BASE_SECONDS = 60
const SECONDS_PER_DIFFICULTY = 30

// Distinct operator tuples is the primary signal, with expression count breaking the tie inside
// tuple-count 1 -- see enumerate.ts. Measured over 500 random banks this spreads roughly
// 39/14/16/14/17 percent across difficulties 5 down to 1, and every band is reachable from at
// least 98.8% of banks. The original game's own puzzle (goal 154 from bank 6,9,7,7: one tuple, six
// expressions) lands at 4.
export const difficultyForSolution = (solution: Solution): Difficulty => {
  if (solution.operatorTuples === 1) {
    return solution.expressions.length <= 2 ? 5 : 4
  }
  return solution.operatorTuples === 2 ? 3 : solution.operatorTuples <= 4 ? 2 : 1
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
          hints: buildHints(solution.expressions, difficulty),
          operators: OPERATORS,
        },
        difficulty,
        estimatedSeconds: BASE_SECONDS + SECONDS_PER_DIFFICULTY * (difficulty - 1),
        id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
        type: PUZZLE_TYPE,
      }
    }
  }

  throw new Error(`Could not draw a goFigure bank reaching difficulty ${difficulty} in ${MAX_DRAW_ATTEMPTS} attempts`)
}

export const goFigureGenerator: Generator<GoFigureData> = {
  countPerDay: 5,
  difficulties: [1, 2, 3, 4, 5],
  generate,
  // Measured over 200 trials: a full five-puzzle pack is 2.3ms at p50, 9.7ms at worst. No model,
  // no network, no corpus.
  inRequest: true,
  type: PUZZLE_TYPE,
}
