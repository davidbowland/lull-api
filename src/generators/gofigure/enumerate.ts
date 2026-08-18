import { Operator } from '../../types'
import { evaluateLeftToRight } from './evaluate'

export interface Solution {
  // Bare concatenations in exactly the form the UI produces from tapped tokens, e.g. "6+9+7*7",
  // deduplicated by string so a repeated digit does not inflate the list
  expressions: string[]
  // Distinct operator sequences reaching this goal. THIS is the difficulty signal, not the
  // expression count: goal 154 from bank 6,9,7,7 has six expressions and one operator tuple, so
  // counting expressions would rate the original game's own puzzle the easiest possible.
  operatorTuples: number
}

// Every ordering of the bank, positions included, so a repeated digit yields repeated orderings.
// Those collapse later, by expression string, which is the only dedup that matches what a player
// can actually tap.
const permutations = (values: number[]): number[][] =>
  values.length <= 1
    ? [values]
    : values.flatMap((value, index) =>
        permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
      )

// Every operator sequence of the given length, drawn with replacement -- operators are reusable
const operatorTuples = (operators: Operator[], length: number): Operator[][] =>
  length === 0
    ? [[]]
    : operatorTuples(operators, length - 1).flatMap((rest) => operators.map((operator) => [operator, ...rest]))

const toExpression = (operands: number[], operators: Operator[]): string =>
  operands.reduce<string>(
    (accumulator, operand, index) => (index === 0 ? `${operand}` : `${accumulator}${operators[index - 1]}${operand}`),
    '',
  )

export const enumerateSolutions = (bank: number[], operators: Operator[]): Map<number, Solution> => {
  const expressionsByGoal = new Map<number, Set<string>>()
  const tuplesByGoal = new Map<number, Set<string>>()

  permutations(bank).forEach((operands) => {
    operatorTuples(operators, bank.length - 1).forEach((tuple) => {
      const goal = evaluateLeftToRight(operands, tuple)
      if (goal === null) {
        return
      }

      const expressions = expressionsByGoal.get(goal) ?? new Set<string>()
      expressions.add(toExpression(operands, tuple))
      expressionsByGoal.set(goal, expressions)

      const tuples = tuplesByGoal.get(goal) ?? new Set<string>()
      tuples.add(tuple.join(''))
      tuplesByGoal.set(goal, tuples)
    })
  })

  // Expressions are sorted rather than left in insertion order: insertion order is a function of
  // the permutation walk above, so sorting keeps the stored acceptedSolutions stable if that walk
  // is ever rewritten.
  return new Map(
    [...expressionsByGoal.entries()].map(([goal, expressions]) => [
      goal,
      { expressions: [...expressions].sort(), operatorTuples: (tuplesByGoal.get(goal) as Set<string>).size },
    ]),
  )
}
