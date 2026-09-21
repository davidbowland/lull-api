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

// A redraw cap, not a retry budget: every band is reachable from at least 94.6% of random banks, so
// this only fires against a stuck source. Throws rather than recursing -- createPack catches per
// generate() call, so a throw costs one puzzle instead of the whole 900-second invocation.
const MAX_DRAW_ATTEMPTS = 100

// How hard each operator is to reach for, not how hard it is to compute: sums come first, then
// products, then overshooting the goal, then spotting a factor relationship. These are distances,
// so the gap from '-' to '/' doubles the gap from '+' to '-'.
const OPERATOR_WEIGHT: Record<Operator, number> = { '*': 1, '+': 0, '-': 2, '/': 4 }

/**
 * How much searching an operator arrangement costs a player, ignoring the digits entirely. Both
 * terms matter: without the max, "+-+" and "+*+" tie; without the variety term, "---" and "-+-" do.
 */
export const operatorCost = (tuple: Operator[]): number =>
  Math.max(...tuple.map((operator) => OPERATOR_WEIGHT[operator])) + (new Set(tuple).size - 1)

// The band an arrangement of a given cost may reach: a ceiling, never a floor. The bottom is 2
// rather than 1 because 1 is not in `difficulties` below, so capping there would stop "7+7+7+7"
// shipping. No band requires a particular operator, which would be a free constraint for a player.
const capForCost = (cost: number): Difficulty => (cost <= 1 ? 2 : cost === 2 ? 3 : cost === 3 ? 4 : 5)

// A solution is as easy as its cheapest arrangement, so the cap is the minimum over the tuples and
// not the cap of tuples[0], which is sorted on raw ASCII rather than by cost.
const costCapForSolution = (solution: Solution): Difficulty =>
  solution.operatorTuples.reduce<Difficulty>((cap, tuple) => {
    const candidate = capForCost(operatorCost(tuple))
    return candidate < cap ? candidate : cap
  }, 5)

// Two signals: how many distinct ideas reach the goal (see idea.ts), capped by operator cost.
// Ideas, not expressions and not tuples -- "a+b+c+d" is twenty-four expressions and one answer,
// while one tuple can carry two different routes (5/2*2 and 2*5/2 are one idea, 2/2*5 another).
// The cap is there because ambiguity alone gets shapes backwards: a goal reachable only by
// "7+7+7+7" is one idea, yet the player never searches.
//
// Contract for hints: 5 is the one-idea band and an idea never spans two tuples, so 5 implies a
// unique operator tuple. 4 does not -- about 61% of that band is one-tuple -- so hints.ts reads
// the tuple count itself rather than trusting a difficulty.
export const difficultyForSolution = (solution: Solution): Difficulty => {
  const ideaCount = solution.ideas.length
  const byAmbiguity: Difficulty =
    ideaCount === 1 ? 5 : ideaCount === 2 ? 4 : ideaCount <= 4 ? 3 : ideaCount <= 9 ? 2 : 1
  const cap = costCapForSolution(solution)
  return byAmbiguity < cap ? byAmbiguity : cap
}

const drawBank = (random: () => number): number[] =>
  Array.from({ length: BANK_SIZE }, () => MIN_DIGIT + Math.floor(random() * (MAX_DIGIT - MIN_DIGIT + 1)))

// Sorted before selection: Map insertion order follows the permutation walk inside
// enumerateSolutions, so selecting from unsorted entries would make the generator irreproducible
// the day that walk changes. Positive goals only -- a pack should not open with "make -1".
const goalsAtDifficulty = (bank: number[], difficulty: Difficulty): [number, Solution][] =>
  [...enumerateSolutions(bank, OPERATORS).entries()]
    .filter(([goal, solution]) => goal > 0 && difficultyForSolution(solution) === difficulty)
    .sort(([left], [right]) => left - right)

const defaultShortId = (): string => randomBytes(4).toString('hex')

// The difficulty is an input, never derived from a slot, and the id carries no position: identity
// is an opaque address, so a regenerated puzzle need not keep an old one's content.
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
          // The whole solution list, not the difficulty: buildHints reads the hedge and the slot
          // order off the tuple count in these expressions, and a second input could disagree.
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

// `generate` above reads baseSeconds and secondsPerDifficulty off this binding at call time. These
// are own properties of an exported object, so `const` protects the binding and not the fields --
// an importer can write them, which is why the numbers are pinned by assertion.
export const goFigureGenerator: Generator<GoFigureData> = {
  // A literal matching PACK_START_DATE and never read from config.ts: this is the date the type
  // shipped, and wiring it to an env var would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog gives goFigure a 1-3 minute range; base is the low end and secondsPerDifficulty is
  // (high - low) / 4, so difficulty 5 lands exactly on 180.
  baseSeconds: 60,
  // The measured 9.7 ms worst case rounded up, never the 2.3 ms p50: a budget is spent at the worst.
  budgetMsPerPuzzle: 10,
  countPerDay: 3,
  // The bands come from the pack-wide count table rather than from this file. Measured over every
  // positive goal of every bank multiset 1-9 x 4, the spread is 10/23/44/15/8 percent across bands
  // 5 down to 1 and every band is reachable from at least 94.6% of draws.
  difficulties: [2, 4, 5],
  generate,
  // Measured by `npm run benchmark-generators` over 200 trials: 2.3 ms per puzzle at p50, 9.7 ms at
  // worst. No model, no network, no corpus. Re-run before flipping another generator to inRequest.
  inRequest: true,
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
