import { Difficulty, GoFigureHintLadder, GoFigureOperatorHint, Operator, OperatorSlot } from '../../types'

// Three operator slots, because the board is four digits each used exactly once. A SECOND COPY of
// what `const BANK_SIZE = 4` fixes in generator.ts, and deliberately not an import of it. That
// generator imports buildHints from this file, so importing BANK_SIZE back would be a cycle, and
// under Babel's CJS interop -- which is what Jest runs -- whichever module loads second reads the
// other's exports as undefined.
//
// The duplicate is the safer trade because it cannot drift SILENTLY: canonicalTuple throws whenever
// a derived tuple is not this length, so changing BANK_SIZE without changing this fires on the first
// puzzle generated, with the real number in the message. Three places change together if the board
// size ever does -- BANK_SIZE in generator.ts, this constant, and OperatorSlot/GoFigureHintLadder in
// types.ts.
const OPERATOR_COUNT = 3

// The ladder always ENDS on slot 2, the rightmost operator: with the goal known it fixes the last
// step arithmetically, and on a * or / it names the final digit too -- for goal 154 and a revealed
// op3 of *, only one bank digit divides 154, so "hit 154 with four digits" becomes "hit 22 with
// three". The first two rungs are ordered by difficulty, and on 4 and 5 that order is deliberately
// NOT least-to-most-revealing. The split is at 4 because that is where the tuple count drops to 1:
// difficulties 4 and 5 are exactly the puzzles whose operator tuple is unique, and on one of those
// nobody spends a rung to learn how two unidentified digits combine.
//
// COUPLED TO COPY IN LULL-UI, which cannot be checked from here. The 1, 0, 2 rows are exactly the
// one-tuple difficulties, which are exactly the ones lull-ui renders with the unhedged wording --
// and that wording carries "from the left" precisely because those slots do not ascend. Give
// difficulty 1-3 a non-ascending order, or 4-5 an ascending one, and the hedged copy starts printing
// an ordinal that contradicts its own list marker. See the comment on GoFigureOperatorHint.
const SLOT_ORDER_BY_DIFFICULTY: Record<Difficulty, [OperatorSlot, OperatorSlot, OperatorSlot]> = {
  1: [0, 1, 2],
  2: [0, 1, 2],
  3: [0, 1, 2],
  4: [1, 0, 2],
  5: [1, 0, 2],
}

const isOperator = (character: string): character is Operator => '+-*/'.includes(character)

// Bank digits are 1-9, so every operand is exactly one character and stripping the digits off an
// expression yields the operator tuple exactly: "6+9+7*7" -> "++*". No change to enumerate.ts.
const tupleOf = (expression: string): string => expression.replace(/[0-9]/g, '')

/**
 * The one operator tuple every rung of this puzzle's ladder describes.
 *
 * Most-shared, because after rung 3 that leaves the player the largest set of working digit
 * arrangements -- the most forgiving finish. Deterministic, because a random pick would make a
 * regenerated puzzle's hints differ from the ones a player already spent.
 *
 * Throws rather than redrawing. acceptedSolutions is never empty and every entry always carries
 * exactly three operators, so either throw is a bug signal from somewhere upstream, not a condition
 * the generator should retry around.
 */
export const canonicalTuple = (acceptedSolutions: string[]): [Operator, Operator, Operator] => {
  if (acceptedSolutions.length === 0) {
    throw new Error('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
  }

  const counts = new Map<string, number>()
  for (const expression of acceptedSolutions) {
    const tuple = tupleOf(expression)
    counts.set(tuple, (counts.get(tuple) ?? 0) + 1)
  }

  // Ties broken by the SMALLEST RAW ASCII string, which is what `<` on the stored strings already
  // does -- nothing to get backwards. That orders '*' (U+002A) < '+' (U+002B) < '-' (U+002D) <
  // '/' (U+002F), which is NOT the display order above, and the difference is observable: a tie
  // between "+*-" and "*-+" resolves to "*-+" here and would resolve the other way under display
  // order.
  //
  // Picked in ONE PASS rather than by sorting, and that is a correctness choice rather than a
  // performance one. A comparator only ever sees the pairs the engine decides to compare, so a
  // sort's tie arm can go unexecuted even on input that genuinely ties -- which means a test can
  // pass against a tie-break that is never applied, and "smallest ASCII" quietly degrades into
  // "whichever tuple the Map happened to yield first". A reduce compares every candidate against
  // the running winner, so both arms run on any input with a tie and no test can miss one. It also
  // sidesteps sort's consistency contract, which a two-arm comparator violates by never returning 0.
  const [best] = [...counts.entries()].reduce((winner, candidate) =>
    candidate[1] > winner[1] || (candidate[1] === winner[1] && candidate[0] < winner[0]) ? candidate : winner,
  )

  // Filtering on isOperator rather than splitting blind: it narrows string[] to Operator[], so the
  // three-element return below needs no cast, and a cast is how a wrong value gets in.
  const operators = [...best].filter(isOperator)
  // The drift tripwire for OPERATOR_COUNT, as well as the invariant check. The count goes INTO the
  // message so a mismatch says what this file expected rather than only that something was wrong.
  if (operators.length !== OPERATOR_COUNT) {
    throw new Error(`Could not derive a ${OPERATOR_COUNT}-operator goFigure tuple from "${best}"`)
  }
  return [operators[0], operators[1], operators[2]]
}

/**
 * Which operator slot each rung reveals, in rung order.
 *
 * Total over the closed Difficulty union, which is what earns the narrow return type without a cast.
 */
// Returns a COPY, never the table's own array. Handing back the module-level tuple would let any
// caller mutate the table through it -- `slotOrder(4).reverse()` typechecks -- and in a warm Lambda
// container that corruption outlives the invocation and silently reorders every later puzzle of
// that difficulty. No caller does this today; the copy costs nothing and removes the hazard rather
// than relying on nobody ever trying.
export const slotOrder = (difficulty: Difficulty): [OperatorSlot, OperatorSlot, OperatorSlot] => {
  const [first, second, third] = SLOT_ORDER_BY_DIFFICULTY[difficulty]
  return [first, second, third]
}

/**
 * The three-rung ladder for one goFigure puzzle.
 *
 * Derived, not generated: a pure function over the acceptedSolutions the generator already computed.
 * No model call, no review pass, and nothing that can fail on any input the generator can hand it,
 * so it widens no per-puzzle failure surface.
 */
export const buildHints = (acceptedSolutions: string[], difficulty: Difficulty): GoFigureHintLadder => {
  const tuple = canonicalTuple(acceptedSolutions)
  const slots = slotOrder(difficulty)

  // `rung` is a RUNG index, not a slot -- the two share the range 0-2 and are different things,
  // which is the whole point of decision 3. Typed as a bare literal union rather than reusing
  // OperatorSlot so nothing reads as though a rung were a slot.
  const rungAt = (rung: 0 | 1 | 2): GoFigureOperatorHint => {
    const slot = slots[rung]
    return { operator: tuple[slot], slot }
  }

  // Built as a literal 3-tuple rather than slots.map(...): map widens to GoFigureHint[], and the
  // assignment back into the 3-tuple would need a cast.
  return [rungAt(0), rungAt(1), rungAt(2)]
}
