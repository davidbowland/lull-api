import { goFigurePuzzle } from '../../__mocks__'
import { buildHints, pickCanonical, slotOrder, tupleCounts } from '@generators/gofigure/hints'

// Explicit escapes, never a glyph pasted out of the design document. Each of these is one
// indistinguishable keystroke away from something else: U+2212 MINUS SIGN from U+002D HYPHEN-MINUS
// and U+2013 EN DASH, U+00D7 MULTIPLICATION SIGN from the letter x. A diff cannot tell them apart;
// an escape can.
const MINUS = '\u2212'
const TIMES = '\u00D7'
const DIVIDE = '\u00F7'

// The design's difficulty-4 worked example, and the original game's own puzzle: bank 6 9 7 7, goal
// 154, one operator tuple (++*) across six expressions. Byte-for-byte what
// __tests__/unit/__mocks__.ts carries.
const ORIGINAL = ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7']

// ONE tuple, "-*+". Three different operators, so a swapped slot cannot hide behind a repeat. This
// is the unhedged band: the tuple is unique across every accepted solution, so a rung may assert it.
const SINGLE_TUPLE = ['1-2*3+4']

// TWO tuples, canonical "-*+" (two of three). Same canonical tuple as SINGLE_TUPLE on purpose, so
// the pair differs in exactly one thing -- whether alternatives exist -- and every difference
// between the two ladders below is attributable to the hedge and to nothing else.
const MULTI_TUPLE = ['1-2*3+4', '2-1*3+4', '1+2+3*4']

describe('hints', () => {
  // Composes the two exports the way buildHints composes them, so these assertions run the
  // production path rather than a wrapper kept alive for them. There used to be a `canonicalTuple`
  // export doing exactly this, and it was the only export in the repo that nothing in src/ called.
  const canonicalTupleOf = (acceptedSolutions: string[]) => pickCanonical(tupleCounts(acceptedSolutions))

  describe('pickCanonical', () => {
    // Most-shared wins, and the majority tuple here is deliberately NOT the ASCII-smallest: '*' is
    // U+002A and sorts before '+', so an implementation that applied the tie-break first would
    // answer "+*+". Three "++*" against two "+*+".
    it('picks the tuple shared by the most accepted solutions', () => {
      expect(canonicalTupleOf(['1+2+3*4', '2+1+3*4', '3+1+2*4', '1+2*3+4', '2+1*3+4'])).toEqual(['+', '+', '*'])
    })

    it('handles a single-expression list', () => {
      expect(canonicalTupleOf(['9-8*7/6'])).toEqual(['-', '*', '/'])
    })

    // THE tie-break test, and the two candidates straddle the two orderings on purpose. Raw ASCII
    // orders '*' (U+002A) < '+' (U+002B), so "*-+" wins; under the DISPLAY order of decision 5 the
    // answer would be "+*-" instead. A tie between "++*" and "+*+" would prove nothing, because
    // ASCII and display order agree there. Two of each, with a third tuple at one, so the count
    // still has to be counted.
    it('breaks a tie on the smallest raw ASCII tuple, not the display order', () => {
      expect(canonicalTupleOf(['1+2*3-4', '2+1*3-4', '1*2-3+4', '2*1-3+4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // The SAME tie, with the two candidates in the opposite order, and this pair has to stay a pair.
    // The case above alone does not pin the tie-break: fed in that order, a selection that simply
    // keeps whichever tuple it met first still answers "*-+", so it passes while applying no
    // tie-break at all. Reversing the input flips that impostor's answer to "+*-" and leaves the
    // real rule's answer unchanged, which is the whole point -- an outcome that survives both
    // orderings cannot have come from insertion order.
    it('breaks that tie the same way when the tied candidates arrive in the opposite order', () => {
      expect(canonicalTupleOf(['1*2-3+4', '2*1-3+4', '1+2*3-4', '2+1*3-4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // A bug signal, not a redraw condition. acceptedSolutions is never empty and every entry always
    // carries exactly three operators, so reaching either throw means something upstream broke.
    it('throws on an empty solution list', () => {
      expect(() => canonicalTupleOf([])).toThrow(
        'Could not derive a goFigure operator tuple: acceptedSolutions is empty',
      )
    })

    // THE DRIFT TRIPWIRE, and the reason the message is asserted in full rather than loosely. This
    // file's OPERATOR_COUNT is a second copy of the number BANK_SIZE fixes, held separately on
    // purpose (spec section 6). If BANK_SIZE ever changes and this does not, every real puzzle hits
    // this throw on the first generation -- loudly, in the right file, with the real number in the
    // message. Asserting the exact text is what keeps that number visible: a bare `.toThrow()`, or a
    // match on a fragment, would pass just as happily while the two copies disagreed.
    it('throws with the expected operator count on an expression that does not yield three operators', () => {
      expect(() => canonicalTupleOf(['1+2+3'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++"'),
      )
    })

    // The OTHER direction, and the one the tripwire actually exists for. Too FEW operators is the
    // easy case; too MANY is what a raised BANK_SIZE produces, and it is the case that fails
    // silently without this: the length check is what stops `return [operators[0], operators[1],
    // operators[2]]` truncating a longer tuple to its first three and shipping a ladder that
    // describes slots the board no longer has. A `<` in place of `!==` passes every other test here.
    it('throws when an expression yields more than three operators', () => {
      expect(() => canonicalTupleOf(['1+2+3+4+5'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++++"'),
      )
    })
  })

  describe('slotOrder', () => {
    // Strictly ascending marginal value: op1 says how two unidentified digits combine, op3 fixes the
    // last step outright. This is the band where alternative tuples exist, which used to be spelled
    // "difficulty 1-3" -- the same puzzles, read off the data rather than off a difficulty table.
    it('runs op1 -> op2 -> op3 when more than one operator tuple wins', () => {
      expect(slotOrder(false)).toEqual([0, 1, 2])
    })

    // The one-tuple puzzles, and the one place the ladder is deliberately NOT
    // least-to-most-revealing: rung 1 buys op2 because on a puzzle with a unique tuple nobody spends
    // a rung to learn how two unidentified digits combine.
    it('runs op2 -> op1 -> op3 when exactly one operator tuple wins', () => {
      expect(slotOrder(true)).toEqual([1, 0, 2])
    })

    // In EVERY band. A ladder must get hintier as it is climbed, and op3 is the strongest reveal.
    it.each([true, false])('ends on the rightmost operator when isSingleTuple is %s', (isSingleTuple) => {
      expect(slotOrder(isSingleTuple)[2]).toBe(2)
    })

    // Returns a COPY, never the module's own array. Without this the defensive copy in slotOrder is
    // unpinned -- returning the module-level constant directly passes every other test, so the next
    // person to 'simplify' it gets a green suite and a constant any caller can corrupt through the
    // returned reference, permanently, for the life of a warm Lambda container.
    it('hands back a fresh array rather than the shared constant', () => {
      expect(slotOrder(true)).not.toBe(slotOrder(true))
      expect(slotOrder(true)).toEqual(slotOrder(true))
    })
  })

  describe('buildHints', () => {
    // THROUGH buildHints, not through the two halves above, and that is the whole point of these
    // two. buildHints is the only entry production calls, and it reaches pickCanonical by its own
    // route -- so a guard that moves out of pickCanonical breaks the real path while every
    // composed-helper assertion above stays green.
    //
    // The arity tripwire is the sharper of the two. Move the OPERATOR_COUNT check up into a wrapper
    // and buildHints(['1+2+3+4+5']) stops throwing and silently returns a three-rung ladder sliced
    // off a four-operator tuple -- a ladder describing a slot the board does not have, which is
    // exactly the silent failure the check exists to prevent.
    it('throws through buildHints on an empty solution list', () => {
      expect(() => buildHints([])).toThrow('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
    })

    it('throws through buildHints when a solution does not yield three operators', () => {
      expect(() => buildHints(['1+2+3+4+5'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++++"'),
      )
    })

    // buildHints used to take `difficulty` as a second argument, reading the hedge off it while the
    // slot order came from a table keyed on the same value -- two independent inputs that a
    // data-derived hedge can set against each other, producing hedged copy on the 1, 0, 2 order.
    //
    // This passes a second argument and asserts it changes NOTHING. `expect(buildHints).toHaveLength(1)`
    // was the obvious way to write this and it is blind to the regression that actually happens:
    // `(solutions, difficulty = 3) => …` has a `.length` of 1, and a resurrected parameter would
    // almost certainly arrive with a default, because a required one breaks the single call site in
    // generator.ts and tsc rejects it there. A parameter that is read is only visible by feeding it
    // a value and watching the output hold still. MULTI_TUPLE is the fixture that would move: it is
    // hedged on 0, 1, 2, and the old difficulty-4 table would have made it unhedged on 1, 0, 2.
    it('ignores any second argument, so nothing can reintroduce a difficulty input', () => {
      const withExtra = buildHints as (acceptedSolutions: string[], difficulty?: unknown) => unknown

      expect(withExtra(MULTI_TUPLE, 4)).toEqual(buildHints(MULTI_TUPLE))
      expect(withExtra(SINGLE_TUPLE, 1)).toEqual(buildHints(SINGLE_TUPLE))
    })

    it('returns exactly three rungs', () => {
      expect(buildHints(ORIGINAL)).toHaveLength(3)
    })

    it.each([
      ['a single-tuple puzzle', SINGLE_TUPLE],
      ['a multi-tuple puzzle', MULTI_TUPLE],
    ])('names three distinct slots on %s', (_description, solutions) => {
      const slots = buildHints(solutions).map((hint) => hint.metadata.slot)

      expect(new Set(slots).size).toBe(3)
    })

    it.each([
      ['a single-tuple puzzle', SINGLE_TUPLE, true],
      ['a multi-tuple puzzle', MULTI_TUPLE, false],
    ])('emits the slots in slotOrder on %s', (_description, solutions, isSingleTuple) => {
      const hints = buildHints(solutions)

      expect(hints.map((hint) => hint.metadata.slot)).toEqual(slotOrder(isSingleTuple))
    })

    // Every rung describes the SAME tuple, so the three are jointly satisfiable -- a player who
    // spends all three gets a set some real accepted solution answers to, not three facts about
    // three different solutions. Both fixtures below have canonical tuple "-*+"; the multi-tuple one
    // reads it straight and the single-tuple one reads it 1, 0, 2.
    it.each([
      ['a multi-tuple puzzle', MULTI_TUPLE, ['-', '*', '+']],
      ['a single-tuple puzzle', SINGLE_TUPLE, ['*', '-', '+']],
    ])(
      'takes each rung operator from the canonical tuple at that rung slot, %s',
      (_description, solutions, expected) => {
        const hints = buildHints(solutions)

        expect(hints.map((hint) => hint.metadata.operator)).toEqual(expected)
      },
    )

    // A one-expression fixture leaves the module's entry point free to ignore the canonical-tuple
    // rule entirely: swap `pickCanonical(tupleCounts(acceptedSolutions))` for
    // `tupleOf(acceptedSolutions[0])` and
    // it still passes, as does the generator's solvability check, because any lone expression's
    // tuple is trivially present in its own list. Here the FIRST entry's tuple is "+*-" and the
    // majority is "++*", two of three -- so reading position zero answers '+', '*', '-' and only the
    // real rule answers '+', '+', '*'.
    it('builds the ladder from the most-shared tuple rather than the first solution', () => {
      const hints = buildHints(['1+2*3-4', '1+2+3*4', '2+1+3*4'])

      expect(hints.map((hint) => hint.metadata.operator)).toEqual(['+', '+', '*'])
    })

    // More than one tuple reaches the goal, so rung 1 introduces the answer and rungs 2 and 3 refer
    // back to it. "The same answer" is display copy, not a claim that one expression was pinned -- a
    // dozen expressions may share the tuple. It stops a reader taking the three rungs for three
    // different solutions.
    it('hedges rung 1 and only rung 1 when alternative tuples exist', () => {
      const texts = buildHints(MULTI_TUPLE).map((hint) => hint.text)

      expect(texts).toEqual([
        `One winning answer has "${MINUS}" as its 1st operator.`,
        `The same answer has "${TIMES}" as its 2nd operator.`,
        'The same answer has "+" as its 3rd operator.',
      ])
    })

    // On a one-tuple puzzle the hedge is not merely unnecessary -- it would imply alternatives that
    // do not exist.
    it('anchors the unhedged copy to the board when one tuple wins', () => {
      const texts = buildHints(SINGLE_TUPLE).map((hint) => hint.text)

      expect(texts).toEqual([
        `The 2nd operator from the left is "${TIMES}".`,
        `The 1st operator from the left is "${MINUS}".`,
        'The 3rd operator from the left is "+".',
      ])
    })

    // "From the left" is not decoration. The hint bar renders opened rungs into an ORDERED,
    // decimal-marked list, so rung 1 of this band appears as `1. The 2nd operator ...` -- two
    // numbering systems claiming different ordinals on one line. The phrase anchors the ordinal to
    // the board so the marker can only be read as list position. Asserted on every rung of the band
    // because dropping it from any one of them reintroduces the clash on that line.
    it('anchors every rung of the unhedged band to the board', () => {
      const texts = buildHints(SINGLE_TUPLE).map((hint) => hint.text)

      expect(texts.every((text) => text.includes('operator from the left'))).toBe(true)
    })

    // The ordinal names the SLOT's position, never the rung's. A one-tuple ladder therefore OPENS on
    // "2nd operator" and closes on "3rd operator", and an implementation that numbered by rung would
    // open on "1st" and pass every other assertion in this file.
    it('numbers the ordinal by slot rather than by rung', () => {
      const [first, second, third] = buildHints(SINGLE_TUPLE)

      expect(first.text).toContain('2nd operator')
      expect(second.text).toContain('1st operator')
      expect(third.text).toContain('3rd operator')
    })

    // The rung carries the SLOT in metadata, and the metadata slot is the board position. A
    // one-tuple ladder opens on slot 1 and closes on slot 2, so an implementation that numbered by
    // rung would open on slot 0 and pass every other assertion in this file.
    it('names the slot by board position rather than by rung', () => {
      const [first, second, third] = buildHints(SINGLE_TUPLE)

      expect(first.metadata.slot).toBe(1)
      expect(second.metadata.slot).toBe(0)
      expect(third.metadata.slot).toBe(2)
    })

    // ALL FOUR mappings. '+' -> '+' is the case a switch with no default silently breaks, and the
    // unchanged mapping is exactly the one a reader assumes is safe. Every fixture here is one
    // expression, so every one is the unhedged band and rung 1 is slot 1.
    it.each([
      ['+', '1+2+3+4', '+'],
      ['-', '1-2-3-4', MINUS],
      ['*', '1*2*3*4', TIMES],
      ['/', '8/2/2/1', DIVIDE],
    ])('shows %s as its board glyph and keeps the ASCII operator in metadata', (operator, expression, symbol) => {
      const [rung] = buildHints([expression])

      expect(rung.metadata.operator).toBe(operator)
      expect(rung.text).toBe(`The 2nd operator from the left is "${symbol}".`)
    })

    // The same operator in TWO alphabets, which is the one thing about this payload that reads like
    // a bug and is not. `text` is for a person and carries the board glyph; `metadata.operator` is
    // for the board and stays ASCII, matching `data.operators`. A "simplification" that made them
    // agree would either put U+00F7 in metadata, where nothing matches it, or an ASCII '*' in the
    // sentence, where it reads as a footnote marker.
    it.each([
      ['-', '1-2-3-4', MINUS],
      ['*', '1*2*3*4', TIMES],
      ['/', '8/2/2/1', DIVIDE],
    ])('keeps the ASCII %s out of the sentence and the glyph out of metadata', (operator, expression, symbol) => {
      const hints = buildHints([expression])

      expect(hints.every((hint) => !hint.text.includes(operator))).toBe(true)
      expect(hints.every((hint) => hint.metadata.operator === operator)).toBe(true)
      expect(hints.every((hint) => hint.text.includes(symbol))).toBe(true)
    })

    // The worked example, verbatim. `toEqual` on the whole ladder is what pins the payload's SHAPE:
    // a stray `kind`, a `slot` hoisted back out of `metadata`, or any extra field fails here and
    // nowhere else.
    it('builds the worked example', () => {
      expect(buildHints(ORIGINAL)).toEqual([
        { metadata: { operator: '+', slot: 1 }, text: 'The 2nd operator from the left is "+".' },
        { metadata: { operator: '+', slot: 0 }, text: 'The 1st operator from the left is "+".' },
        { metadata: { operator: '*', slot: 2 }, text: `The 3rd operator from the left is "${TIMES}".` },
      ])
    })

    // The shared fixture is the same bank and goal, so it must carry the same ladder -- and until
    // this assertion existed, nothing checked that. Replacing a rung's text with junk, or a whole
    // rung with the wrong operator and slot, passed the entire suite: no test compared the fixture
    // to anything, and tsconfig.json excludes __tests__/ so its Puzzle<GoFigureData> annotation buys
    // nothing at CI time either.
    //
    // It matters because goFigurePuzzle is the canonical goFigure example every other suite imports.
    // A fixture holding a shape the generator cannot emit teaches every test that reads it a lie --
    // which is the exact drift the comment at __mocks__.ts:21-24 was written to stop, for the same
    // fixture, one field over.
    it('agrees with the ladder the shared goFigure fixture carries', () => {
      expect(goFigurePuzzle.data.hints).toEqual(buildHints(goFigurePuzzle.data.acceptedSolutions))
    })
  })
})
