import { Operator } from '../../types'

// The operators whose LEADING operand is interchangeable with the rest of its run: a+b is b+a and
// a*b is b*a, while a-b is not b-a and a/b is not b/a.
const COMMUTATIVE: Operator[] = ['+', '*']

/**
 * A stable string naming the SOLUTION IDEA an arrangement expresses, so two arrangements a player
 * would call the same answer collapse to one.
 *
 * Expression strings do not answer "how many ways are there", and the gap is not small: over every
 * bank multiset 1-9 x 4, 81% of positive goals have more expressions than ideas, and 99% of the
 * goals with a unique operator tuple turn out to be a single idea. Grading on the expression count
 * measures how permutable the operands happened to be, which is not something a player experiences.
 *
 * The reorderings folded away here are exactly the ones left-to-right evaluation preserves, and that
 * is WIDER than commutativity. Inside a maximal run of one repeated operator, every operand after
 * the first is interchangeable for all four operators, because x-b-c is x-(b+c) and x/b/c is
 * x/(b*c) just as surely as x+b+c and x*b*c reassociate. What the run does NOT get is its leading
 * operand, unless the run opens the expression AND its operator commutes -- 9-1-2 is 6 while 1-9-2
 * is -10.
 *
 * Operands may not cross a run boundary: 1+2*3 is 9 and 1+3*2 is 8.
 */
export const canonicalIdea = (operands: number[], operators: Operator[]): string => {
  const segments: string[] = []
  let start = 0

  while (start < operators.length) {
    let end = start
    while (end + 1 < operators.length && operators[end + 1] === operators[start]) {
      end += 1
    }

    // A run that opens the expression swallows operand 0 only when its operator commutes. Otherwise
    // operand 0 is a fixed head the run subtracts or divides FROM, and it is emitted on its own.
    const swallowsHead = start === 0 && COMMUTATIVE.includes(operators[0])
    if (start === 0 && !swallowsHead) {
      segments.push(`${operands[0]}`)
    }

    const sorted = operands.slice(swallowsHead ? 0 : start + 1, end + 2).sort((left, right) => left - right)
    segments.push(`${operators[start]}${sorted.join(',')}`)
    start = end + 1
  }

  // A bank of one digit yields no operators at all. Not reachable from the goFigure generator, whose
  // BANK_SIZE is 4, but enumerateSolutions is callable with any bank and the empty join would make
  // every such arrangement the same idea.
  return segments.length === 0 ? `${operands[0]}` : segments.join('|')
}
