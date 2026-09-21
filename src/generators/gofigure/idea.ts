import { Operator } from '../../types'

// The operators whose leading operand is interchangeable with the rest of its run: a+b is b+a and
// a*b is b*a, while a-b is not b-a and a/b is not b/a.
const COMMUTATIVE: Operator[] = ['+', '*']

/**
 * A stable string naming the solution idea an arrangement expresses, so two arrangements a player
 * would call the same answer collapse to one.
 *
 * The reorderings folded away are the ones left-to-right evaluation preserves, which is wider than
 * commutativity: inside a maximal run of one repeated operator every operand after the first is
 * interchangeable for all four, because x-b-c is x-(b+c) and x/b/c is x/(b*c). The run does not get
 * its leading operand unless it opens the expression and its operator commutes -- 9-1-2 is 6 while
 * 1-9-2 is -10. Operands may not cross a run boundary: 1+2*3 is 9, 1+3*2 is 8.
 */
export const canonicalIdea = (operands: number[], operators: Operator[]): string => {
  const segments: string[] = []
  let start = 0

  while (start < operators.length) {
    let end = start
    while (end + 1 < operators.length && operators[end + 1] === operators[start]) {
      end += 1
    }

    // A run that opens the expression swallows operand 0 only when its operator commutes; otherwise
    // operand 0 is a fixed head the run subtracts or divides from, and is emitted on its own.
    const swallowsHead = start === 0 && COMMUTATIVE.includes(operators[0])
    if (start === 0 && !swallowsHead) {
      segments.push(`${operands[0]}`)
    }

    const sorted = operands.slice(swallowsHead ? 0 : start + 1, end + 2).sort((left, right) => left - right)
    segments.push(`${operators[start]}${sorted.join(',')}`)
    start = end + 1
  }

  // A bank of one digit yields no operators. Unreachable from the goFigure generator, but
  // enumerateSolutions takes any bank and the empty join would make every such arrangement one idea.
  return segments.length === 0 ? `${operands[0]}` : segments.join('|')
}
