import { Operator } from '../../types'
import { evaluateLeftToRight } from './evaluate'

export interface Solution {
  // Bare concatenations in exactly the form the UI produces from tapped tokens, e.g. "6+9+7*7",
  // deduplicated by string so a repeated digit does not inflate the list
  expressions: string[]
  // Distinct operator sequences reaching this goal. THE COUNT of these is the difficulty signal, not
  // the expression count: goal 154 from bank 6,9,7,7 has six expressions and one operator tuple, so
  // counting expressions would rate the original game's own puzzle the easiest possible.
  //
  // The list itself, and not merely its length, because it ships to the client on GoFigureData.
  // lull-ui hedges its hint copy on whether more than one arrangement wins, and the alternative was
  // having it strip digits out of acceptedSolutions to work that out -- which would put this file's
  // one-character-operand assumption in a repo that cannot see it.
  operatorTuples: Operator[][]
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
  // Keyed by the joined tuple so the Map does the dedup a Set of arrays cannot -- two equal
  // Operator[] are different objects and a Set would keep both. The VALUE is the array itself, so
  // the list comes back out without splitting a string back into operators and without the cast that
  // would need.
  const tuplesByGoal = new Map<number, Map<string, Operator[]>>()

  permutations(bank).forEach((operands) => {
    operatorTuples(operators, bank.length - 1).forEach((tuple) => {
      const goal = evaluateLeftToRight(operands, tuple)
      if (goal === null) {
        return
      }

      const expressions = expressionsByGoal.get(goal) ?? new Set<string>()
      expressions.add(toExpression(operands, tuple))
      expressionsByGoal.set(goal, expressions)

      const tuples = tuplesByGoal.get(goal) ?? new Map<string, Operator[]>()
      tuples.set(tuple.join(''), tuple)
      tuplesByGoal.set(goal, tuples)
    })
  })

  // Expressions and tuples are both sorted rather than left in insertion order: insertion order is a
  // function of the permutation walk above, so sorting keeps the stored acceptedSolutions and
  // operatorTuples stable if that walk is ever rewritten.
  //
  // Tuples sort on the JOINED KEY, which is raw ASCII -- '*' (U+002A) < '+' (U+002B) < '-' (U+002D)
  // < '/' (U+002F). That is not the board's display order (+ − × ÷), and the difference is
  // observable on any goal reached by both a '*' and a '+' arrangement. Sorting the arrays directly
  // would compare them as their default string coercion, which is comma-joined -- the same order
  // here, but only by accident.
  return new Map(
    [...expressionsByGoal.entries()].map(([goal, expressions]) => [
      goal,
      {
        expressions: [...expressions].sort(),
        operatorTuples: [...(tuplesByGoal.get(goal) as Map<string, Operator[]>).entries()]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([, tuple]) => tuple),
      },
    ]),
  )
}
