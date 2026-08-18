import { Operator } from '../../types'

// Division is the only operator that can fail. Banks are digits 1-9, so the divide-by-zero branch
// is unreachable from the goFigure generator -- it stays because this evaluator is a shared
// arithmetic primitive, not a goFigure private, and the next type to use it may not draw its
// operands from a digit bank. Do not delete it as dead code.
const applyOperator = (left: number, operator: Operator, right: number): number | null => {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      // Checked at every step rather than at the end, so 5 / 2 * 2 is rejected despite being whole
      return right === 0 || left % right !== 0 ? null : left / right
  }
}

// Strictly left to right. Operator precedence does not apply: 6+9+7*7 is 154, because 6+9=15,
// +7=22, *7=154. That is the original TI-83 game's rule.
export const evaluateLeftToRight = (operands: number[], operators: Operator[]): number | null =>
  operators.reduce<number | null>(
    (accumulator, operator, index) =>
      accumulator === null ? null : applyOperator(accumulator, operator, operands[index + 1]),
    operands[0],
  )
