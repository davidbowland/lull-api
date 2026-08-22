import { GoFigureHint, GoFigureHintLadder, Operator, OperatorSlot } from '../../types'

// Three operator slots, because the board is four digits each used exactly once. A SECOND COPY of
// what `const BANK_SIZE = 4` fixes in generator.ts, and deliberately not an import of it. That
// generator imports buildHints from this file, so importing BANK_SIZE back would be a cycle, and
// under Babel's CJS interop -- which is what Jest runs -- whichever module loads second reads the
// other's exports as undefined.
//
// The duplicate is the safer trade because it cannot drift SILENTLY: pickCanonical throws whenever
// a derived tuple is not this length, so changing BANK_SIZE without changing this fires on the first
// puzzle generated, with the real number in the message. Three places change together if the board
// size ever does -- BANK_SIZE in generator.ts, this constant, and OperatorSlot/GoFigureHintLadder in
// types.ts.
const OPERATOR_COUNT = 3

// The glyphs the board already shows (lull-ui's OPERATOR_SYMBOLS). Written as escapes rather than
// pasted characters because three of the four have a lookalike that a diff cannot distinguish:
// U+2212 MINUS SIGN is not U+002D HYPHEN-MINUS and not U+2013 EN DASH, and U+00D7 MULTIPLICATION
// SIGN is not the letter x. These appear ONLY in `text`; the `operator` field beside it stays ASCII.
const SYMBOLS: Record<Operator, string> = {
  '*': '\u00D7',
  '+': '+',
  '-': '\u2212',
  '/': '\u00F7',
}

// The 1-based position a player sees, keyed by the 0-based slot the payload carries.
const ORDINALS: Record<OperatorSlot, string> = { 0: '1st', 1: '2nd', 2: '3rd' }

// The ladder always ENDS on slot 2, the rightmost operator: with the goal known it fixes the last
// step arithmetically, and on a * or / it names the final digit too -- for goal 154 and a revealed
// op3 of *, only one bank digit divides 154, so "hit 154 with four digits" becomes "hit 22 with
// three".
//
// The first two rungs are ordered on the TUPLE COUNT, and on a one-tuple puzzle that order is
// deliberately NOT least-to-most-revealing: nobody spends a rung to learn how two unidentified
// digits combine when the arrangement is already unique. This used to be a five-row table keyed on
// Difficulty, whose own comment admitted "the split is at 4 because that is where the tuple count
// drops to 1" -- so the order was never really a function of difficulty. It was a function of the
// tuple count all along, wearing difficulty as a proxy, because difficulties 4 and 5 are DEFINED as
// the one-tuple band (difficultyForSolution's first branch IS the one-tuple test).
//
// Reading the tuple count directly is what makes the order and the HEDGE below impossible to
// disagree: both come off one counts Map in buildHints. Keyed on difficulty they were two
// independent inputs, and a multi-tuple solution list passed with difficulty 4 would have produced
// hedged copy on the 1, 0, 2 order -- an ordinal contradicting its own list marker, which is the one
// thing the wording in textFor is written to avoid.
const ASCENDING_ORDER: [OperatorSlot, OperatorSlot, OperatorSlot] = [0, 1, 2]
const SINGLE_TUPLE_ORDER: [OperatorSlot, OperatorSlot, OperatorSlot] = [1, 0, 2]

const isOperator = (character: string): character is Operator => '+-*/'.includes(character)

// Bank digits are 1-9, so every operand is exactly one character and stripping the digits off an
// expression yields the operator tuple exactly: "6+9+7*7" -> "++*". No change to enumerate.ts.
const tupleOf = (expression: string): string => expression.replace(/[0-9]/g, '')

/**
 * How many accepted solutions use each operator arrangement, keyed by the digit-stripped tuple.
 *
 * Its own function rather than inline in buildHints because `counts.size` IS the distinct-tuple
 * count, and that is the fact the hedge and the slot order are both read off. Recomputing it with a
 * `new Set(acceptedSolutions.map(tupleOf))` beside the call would be a THIRD derivation of one thing
 * -- enumerate.ts's tuplesByGoal being the first -- and the three could disagree.
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
 * by most-shared then smallest raw ASCII.
 *
 * Most-shared, because after rung 3 that leaves the player the largest set of working digit
 * arrangements -- the most forgiving finish. Deterministic, because a random pick would make a
 * regenerated puzzle's hints differ from the ones a player already spent.
 *
 * Throws rather than redrawing. acceptedSolutions is never empty and every entry always carries
 * exactly three operators, so either throw is a bug signal from somewhere upstream, not a condition
 * the generator should retry around.
 */
// The empty guard lives HERE rather than in tupleCounts, keyed on `counts.size === 0`, because the
// reduce below runs with no initial value and would otherwise throw an unhelpful `TypeError: Reduce
// of empty array with no initial value` naming neither this file nor the input. The message names
// `acceptedSolutions`, a parameter this function does NOT have, and that is deliberate: an empty Map
// here can only have come from an empty solution list, and the caller who has to fix it is looking
// at acceptedSolutions, not at a Map it never sees. The bytes are asserted verbatim in hints.test.ts.
export const pickCanonical = (counts: Map<string, number>): [Operator, Operator, Operator] => {
  if (counts.size === 0) {
    throw new Error('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
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
 * Takes the tuple count as a BOOLEAN rather than a difficulty. The two orders are the only two that
 * exist, and which one applies is a fact about the solution list -- see the constants above.
 */
// Returns a COPY, never the module's own array. Handing back the module-level tuple would let any
// caller mutate the constant through it -- `slotOrder(true).reverse()` typechecks -- and in a warm
// Lambda container that corruption outlives the invocation and silently reorders every later puzzle
// of that shape. No caller does this today; the copy costs nothing and removes the hazard rather
// than relying on nobody ever trying.
export const slotOrder = (isSingleTuple: boolean): [OperatorSlot, OperatorSlot, OperatorSlot] => {
  const [first, second, third] = isSingleTuple ? SINGLE_TUPLE_ORDER : ASCENDING_ORDER
  return [first, second, third]
}

// `{ordinal}` names the SLOT's position, not the rung's -- so a one-tuple ladder opens with "2nd
// operator" and closes with "3rd operator".
//
// The glyph is QUOTED in every template. A bare U+2212 MINUS SIGN with a space either side is very
// close to an em dash in most UI sans faces, so `has − as its 1st operator` reads as a sentence that
// broke off mid-clause. Quoting costs nothing on the other three glyphs and keeps every rung parsing
// as a sentence rather than as an interruption.
//
// The unhedged band says "from the left", and that phrase is load-bearing rather than decorative.
// The hint bar renders opened rungs into an ORDERED, decimal-marked list -- `<ol class="…
// list-decimal …">` at lull-ui/src/components/hint-bar/index.tsx:47 -- so every rung already has a
// number printed beside it. Because this band orders slots by strength rather than left to right,
// its positions come out 2, 1, 3, and rung 1 would otherwise render as
//
//   1. The 2nd operator is "×".
//
// which is two numbering systems asserting different ordinals on one line. "From the left" anchors
// the ordinal to the BOARD, so the list marker can only be read as list position. A connective
// ("And the 2nd operator…") does not fix this: it argues the sequence was deliberate while saying
// nothing about the marker, and opening an enumerated item with a conjunction reads badly anyway.
//
// The hedged band needs no anchor. Its ordinal hangs off "its", which points at the answer the rung
// just introduced, and on a multi-tuple puzzle the slots run 0, 1, 2 so marker and ordinal agree.
//
// Takes `isFirstRung` rather than a rung index, deliberately. Only the hedged band distinguishes
// rungs at all, and there slotOrder is [0,1,2] so `rung === 0` and `slot === 0` pick out the same
// line -- a rung index would look like it carried more meaning than it can, and no test could tell
// the two apart. A boolean says exactly what is being asked.
const textFor = (slot: OperatorSlot, operator: Operator, hedged: boolean, isFirstRung: boolean): string => {
  const ordinal = ORDINALS[slot]
  const symbol = SYMBOLS[operator]
  if (hedged) {
    // Rung 1 introduces the answer; rungs 2 and 3 refer back to it. "The same answer" is display
    // copy, not a claim that a specific expression was pinned -- a dozen expressions may share the
    // tuple. It exists to stop a reader assuming the three rungs describe three different solutions.
    return isFirstRung
      ? `One winning answer has "${symbol}" as its ${ordinal} operator.`
      : `The same answer has "${symbol}" as its ${ordinal} operator.`
  }
  return `The ${ordinal} operator from the left is "${symbol}".`
}

/**
 * The three-rung ladder for one goFigure puzzle.
 *
 * Derived, not generated: a pure function over the acceptedSolutions the generator already computed.
 * No model call, no review pass, and nothing that can fail on any input the generator can hand it,
 * so it widens no per-puzzle failure surface.
 *
 * ONE argument. It used to take `difficulty` as well, and read the hedge off a difficulty table
 * while the slot order came off another -- two independent inputs describing the same structural
 * fact, which a caller could set against each other. Everything now comes off `counts`, so
 * disagreement is impossible rather than merely untested.
 */
export const buildHints = (acceptedSolutions: string[]): GoFigureHintLadder => {
  const counts = tupleCounts(acceptedSolutions)
  const tuple = pickCanonical(counts)
  // More than one arrangement reaches the goal, so an unqualified claim about "the 1st operator"
  // would assert a uniqueness that does not hold. On a one-tuple puzzle the hedge is not merely
  // unnecessary -- it would imply alternatives that do not exist.
  const hedged = counts.size > 1
  const slots = slotOrder(!hedged)

  // `rung` is a RUNG index, not a slot -- the two share the range 0-2 and are different things.
  // Typed as a bare literal union rather than reusing OperatorSlot so nothing reads as though a rung
  // were a slot, and converted to a boolean before it reaches textFor so no template can silently
  // index by the wrong one.
  const rungAt = (rung: 0 | 1 | 2): GoFigureHint => {
    const slot = slots[rung]
    const operator = tuple[slot]
    return { metadata: { operator, slot }, text: textFor(slot, operator, hedged, rung === 0) }
  }

  // Built as a literal 3-tuple rather than slots.map(...): map widens to GoFigureHint[], and the
  // assignment back into the 3-tuple would need a cast.
  return [rungAt(0), rungAt(1), rungAt(2)]
}
