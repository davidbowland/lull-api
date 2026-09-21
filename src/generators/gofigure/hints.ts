import { GoFigureHint, GoFigureHintLadder, Operator, OperatorSlot } from '../../types'

// Three operator slots, because the board is four digits each used once. A deliberate copy of
// generator.ts's BANK_SIZE, not an import: that module imports buildHints from here, and under
// Babel's CJS interop the cycle leaves one module's exports undefined. Board size changes here, in
// BANK_SIZE, and in types.ts.
const OPERATOR_COUNT = 3

// The glyphs the board already shows (lull-ui's OPERATOR_SYMBOLS), as escapes because a diff cannot
// tell U+2212 from a hyphen, nor U+00D7 from an x. Only `text` uses them; `operator` stays ASCII.
const SYMBOLS: Record<Operator, string> = {
  '*': '\u00D7',
  '+': '+',
  '-': '\u2212',
  '/': '\u00F7',
}

// The 1-based position a player sees, keyed by the 0-based slot the payload carries
const ORDINALS: Record<OperatorSlot, string> = { 0: '1st', 1: '2nd', 2: '3rd' }

// The ladder always ends on slot 2, the rightmost operator, which with the goal known fixes the
// last step arithmetically. On a one-tuple puzzle the first two rungs are deliberately not ordered
// least-to-most-revealing: nobody spends a rung on how two unidentified digits combine when the
// arrangement is unique. Order and hedge come off one counts Map, so they agree.
const ASCENDING_ORDER: [OperatorSlot, OperatorSlot, OperatorSlot] = [0, 1, 2]
const SINGLE_TUPLE_ORDER: [OperatorSlot, OperatorSlot, OperatorSlot] = [1, 0, 2]

const isOperator = (character: string): character is Operator => '+-*/'.includes(character)

// Bank digits are 1-9, so every operand is one character and stripping digits yields the tuple.
const tupleOf = (expression: string): string => expression.replace(/[0-9]/g, '')

/**
 * How many accepted solutions use each operator arrangement, keyed by the digit-stripped tuple.
 * `counts.size` is the distinct-tuple count the hedge and the slot order are both read off.
 */
export const tupleCounts = (acceptedSolutions: string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const expression of acceptedSolutions) {
    const tuple = tupleOf(expression)
    counts.set(tuple, (counts.get(tuple) ?? 0) + 1)
  }
  return counts
}

/**
 * The one operator tuple every rung of this puzzle's ladder describes: the winner of a counts Map,
 * by most-shared then smallest raw ASCII. Most-shared leaves the largest set of working digit
 * arrangements after rung 3, and a deterministic pick keeps a regenerated puzzle's hints identical
 * to the ones a player already spent. Either throw below is a bug from upstream.
 */
// The empty guard lives here because the reduce runs with no initial value and would otherwise
// throw a TypeError naming neither this file nor the input. Its message names `acceptedSolutions`
// -- not a parameter here, but what the caller has to fix.
export const pickCanonical = (counts: Map<string, number>): [Operator, Operator, Operator] => {
  if (counts.size === 0) {
    throw new Error('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
  }

  // Ties break on the smallest raw ASCII string ('*' < '+' < '-' < '/'), not the display order, so
  // a tie between "+*-" and "*-+" resolves differently under each. One pass rather than a sort: a
  // comparator only sees the pairs the engine compares, so a tie arm can go untested.
  const [best] = [...counts.entries()].reduce((winner, candidate) =>
    candidate[1] > winner[1] || (candidate[1] === winner[1] && candidate[0] < winner[0]) ? candidate : winner,
  )

  // Filtering on isOperator narrows string[] to Operator[], so the return below needs no cast.
  const operators = [...best].filter(isOperator)
  // The drift tripwire for OPERATOR_COUNT, with the expected count in the message.
  if (operators.length !== OPERATOR_COUNT) {
    throw new Error(`Could not derive a ${OPERATOR_COUNT}-operator goFigure tuple from "${best}"`)
  }
  return [operators[0], operators[1], operators[2]]
}

/**
 * Which operator slot each rung reveals, in rung order. The argument is the tuple count as a
 * boolean, not a difficulty: which of the two orders applies is a fact about the solution list.
 */
// Returns a copy: handing back the module-level tuple would let a caller mutate the constant
// (`slotOrder(true).reverse()` typechecks), and in a warm Lambda that outlives the invocation.
export const slotOrder = (isSingleTuple: boolean): [OperatorSlot, OperatorSlot, OperatorSlot] => {
  const [first, second, third] = isSingleTuple ? SINGLE_TUPLE_ORDER : ASCENDING_ORDER
  return [first, second, third]
}

// `{ordinal}` names the slot's position, not the rung's, so a one-tuple ladder opens with "2nd
// operator". The glyph is quoted in every template because a bare U+2212 with a space either side
// reads as an em dash. The unhedged band says "from the left" because the hint bar renders rungs
// into a decimal-marked list while this band orders slots by strength (2, 1, 3), so rung 1 would
// otherwise read `1. The 2nd operator is "×".` The hedged band's slots run 0, 1, 2 and need no
// anchor.
const textFor = (slot: OperatorSlot, operator: Operator, hedged: boolean, isFirstRung: boolean): string => {
  const ordinal = ORDINALS[slot]
  const symbol = SYMBOLS[operator]
  if (hedged) {
    // "The same answer" is display copy, not a claim that one expression was pinned -- a dozen may
    // share the tuple. It stops a reader assuming the three rungs describe three different answers.
    return isFirstRung
      ? `One winning answer has "${symbol}" as its ${ordinal} operator.`
      : `The same answer has "${symbol}" as its ${ordinal} operator.`
  }
  return `The ${ordinal} operator from the left is "${symbol}".`
}

/**
 * The three-rung ladder for one goFigure puzzle: a pure function over acceptedSolutions, no model
 * call. Hedge and slot order both come off `counts`, so no second argument can contradict it.
 */
export const buildHints = (acceptedSolutions: string[]): GoFigureHintLadder => {
  const counts = tupleCounts(acceptedSolutions)
  const tuple = pickCanonical(counts)
  // With more than one arrangement reaching the goal, an unqualified claim about "the 1st operator"
  // asserts a uniqueness that does not hold; on a one-tuple puzzle it implies absent alternatives.
  const hedged = counts.size > 1
  const slots = slotOrder(!hedged)

  // `rung` is a rung index, not a slot: both run 0-2, so it is typed as its own literal union.
  const rungAt = (rung: 0 | 1 | 2): GoFigureHint => {
    const slot = slots[rung]
    const operator = tuple[slot]
    return {
      metadata: { kind: 'gofigure-operator', operator, slot },
      text: textFor(slot, operator, hedged, rung === 0),
    }
  }

  // A literal 3-tuple rather than slots.map(...), which widens to GoFigureHint[] and needs a cast.
  return [rungAt(0), rungAt(1), rungAt(2)]
}
