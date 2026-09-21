import { Operator } from '../../types'
import { evaluateLeftToRight } from './evaluate'
import { canonicalIdea } from './idea'

export interface Solution {
  // Bare concatenations in exactly the form the UI produces from tapped tokens, e.g. "6+9+7*7",
  // deduplicated by string so a repeated digit does not inflate the list
  expressions: string[]
  // Distinct solution ideas -- the expressions above with every reordering left-to-right evaluation
  // preserves folded away (see idea.ts). Internal, and what difficultyForSolution grades on; kept
  // as the list so a fixture can assert which arrangements collapsed.
  ideas: string[]
  // Distinct operator sequences reaching this goal. Internal; nothing on the wire carries it.
  // hints.ts derives the same count by stripping digits off the accepted solutions, and
  // generator.test.ts asserts the two agree -- if they part company the hint copy hedges on the
  // wrong puzzles and nothing else notices.
  operatorTuples: Operator[][]
}

// Every ordering of the bank, positions included, so a repeated digit yields repeated orderings.
// Those collapse later by expression string, the only dedup matching what a player can tap.
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
  const ideasByGoal = new Map<number, Set<string>>()
  // Keyed by the joined tuple so the Map does the dedup a Set of arrays cannot -- two equal
  // Operator[] are different objects. The value is the array, so nothing has to be re-split.
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

      const ideas = ideasByGoal.get(goal) ?? new Set<string>()
      ideas.add(canonicalIdea(operands, tuple))
      ideasByGoal.set(goal, ideas)

      const tuples = tuplesByGoal.get(goal) ?? new Map<string, Operator[]>()
      tuples.set(tuple.join(''), tuple)
      tuplesByGoal.set(goal, tuples)
    })
  })

  // Sorted rather than left in insertion order, which follows the permutation walk above, so
  // acceptedSolutions and operatorTuples stay stable if that walk is rewritten. Tuples sort on the
  // joined key, raw ASCII ('*' < '+' < '-' < '/'), which is not the board's display order (+ − × ÷).
  return new Map(
    [...expressionsByGoal.entries()].map(([goal, expressions]) => [
      goal,
      {
        expressions: [...expressions].sort(),
        ideas: [...(ideasByGoal.get(goal) as Set<string>)].sort(),
        operatorTuples: [...(tuplesByGoal.get(goal) as Map<string, Operator[]>).entries()]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([, tuple]) => tuple),
      },
    ]),
  )
}
