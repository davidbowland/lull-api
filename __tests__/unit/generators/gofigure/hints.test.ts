import { goFigurePuzzle } from '../../__mocks__'
import { buildHints, canonicalTuple, slotOrder } from '@generators/gofigure/hints'
import { Difficulty } from '@types'

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

// Canonical tuple "-*+". Three different operators, so a swapped slot cannot hide behind a repeat.
const MIXED = ['1-2*3+4']

describe('hints', () => {
  describe('canonicalTuple', () => {
    // Most-shared wins, and the majority tuple here is deliberately NOT the ASCII-smallest: '*' is
    // U+002A and sorts before '+', so an implementation that applied the tie-break first would
    // answer "+*+". Three "++*" against two "+*+".
    it('picks the tuple shared by the most accepted solutions', () => {
      expect(canonicalTuple(['1+2+3*4', '2+1+3*4', '3+1+2*4', '1+2*3+4', '2+1*3+4'])).toEqual(['+', '+', '*'])
    })

    it('handles a single-expression list', () => {
      expect(canonicalTuple(['9-8*7/6'])).toEqual(['-', '*', '/'])
    })

    // THE tie-break test, and the two candidates straddle the two orderings on purpose. Raw ASCII
    // orders '*' (U+002A) < '+' (U+002B), so "*-+" wins; under the DISPLAY order of decision 5 the
    // answer would be "+*-" instead. A tie between "++*" and "+*+" would prove nothing, because
    // ASCII and display order agree there. Two of each, with a third tuple at one, so the count
    // still has to be counted.
    it('breaks a tie on the smallest raw ASCII tuple, not the display order', () => {
      expect(canonicalTuple(['1+2*3-4', '2+1*3-4', '1*2-3+4', '2*1-3+4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // The SAME tie, with the two candidates in the opposite order, and this pair has to stay a pair.
    // The case above alone does not pin the tie-break: fed in that order, a selection that simply
    // keeps whichever tuple it met first still answers "*-+", so it passes while applying no
    // tie-break at all. Reversing the input flips that impostor's answer to "+*-" and leaves the
    // real rule's answer unchanged, which is the whole point -- an outcome that survives both
    // orderings cannot have come from insertion order.
    it('breaks that tie the same way when the tied candidates arrive in the opposite order', () => {
      expect(canonicalTuple(['1*2-3+4', '2*1-3+4', '1+2*3-4', '2+1*3-4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // A bug signal, not a redraw condition. acceptedSolutions is never empty and every entry always
    // carries exactly three operators, so reaching either throw means something upstream broke.
    it('throws on an empty solution list', () => {
      expect(() => canonicalTuple([])).toThrow('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
    })

    // THE DRIFT TRIPWIRE, and the reason the message is asserted in full rather than loosely. This
    // file's OPERATOR_COUNT is a second copy of the number BANK_SIZE fixes, held separately on
    // purpose (spec section 6). If BANK_SIZE ever changes and this does not, every real puzzle hits
    // this throw on the first generation -- loudly, in the right file, with the real number in the
    // message. Asserting the exact text is what keeps that number visible: a bare `.toThrow()`, or a
    // match on a fragment, would pass just as happily while the two copies disagreed.
    it('throws with the expected operator count on an expression that does not yield three operators', () => {
      expect(() => canonicalTuple(['1+2+3'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++"'),
      )
    })

    // The OTHER direction, and the one the tripwire actually exists for. Too FEW operators is the
    // easy case; too MANY is what a raised BANK_SIZE produces, and it is the case that fails
    // silently without this: the length check is what stops `return [operators[0], operators[1],
    // operators[2]]` truncating a longer tuple to its first three and shipping a ladder that
    // describes slots the board no longer has. A `<` in place of `!==` passes every other test here.
    it('throws when an expression yields more than three operators', () => {
      expect(() => canonicalTuple(['1+2+3+4+5'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++++"'),
      )
    })
  })

  describe('slotOrder', () => {
    // Strictly ascending marginal value: op1 says how two unidentified digits combine, op3 fixes the
    // last step outright.
    it.each([1, 2, 3])('runs op1 -> op2 -> op3 at difficulty %s', (difficulty) => {
      expect(slotOrder(difficulty as Difficulty)).toEqual([0, 1, 2])
    })

    // Difficulties 4 and 5 are exactly the one-tuple puzzles, and this is the one place the ladder
    // is deliberately NOT least-to-most-revealing: rung 1 buys op2 because on a hard puzzle nobody
    // spends a rung to learn how two unidentified digits combine. The band boundary is pinned here
    // by a test rather than by a comment.
    it.each([4, 5])('runs op2 -> op1 -> op3 at difficulty %s', (difficulty) => {
      expect(slotOrder(difficulty as Difficulty)).toEqual([1, 0, 2])
    })

    // In EVERY band. A ladder must get hintier as it is climbed, and op3 is the strongest reveal.
    it.each([1, 2, 3, 4, 5])('ends on the rightmost operator at difficulty %s', (difficulty) => {
      expect(slotOrder(difficulty as Difficulty)[2]).toBe(2)
    })

    // Returns a COPY, never the table's own array. Without this the defensive copy in slotOrder is
    // unpinned -- returning SLOT_ORDER_BY_DIFFICULTY[difficulty] directly passes every other test,
    // so the next person to 'simplify' it gets a green suite and a table any caller can corrupt
    // through the returned reference, permanently, for the life of a warm Lambda container.
    it('hands back a fresh array rather than the shared table entry', () => {
      expect(slotOrder(4)).not.toBe(slotOrder(4))
      expect(slotOrder(4)).toEqual(slotOrder(4))
    })
  })

  describe('buildHints', () => {
    it('returns exactly three rungs', () => {
      expect(buildHints(ORIGINAL, 4)).toHaveLength(3)
    })

    it.each([1, 2, 3, 4, 5])('names three distinct slots at difficulty %s', (difficulty) => {
      const slots = buildHints(MIXED, difficulty as Difficulty).map((hint) => hint.slot)

      expect(new Set(slots).size).toBe(3)
    })

    it.each([1, 2, 3, 4, 5])('emits the slots in slotOrder at difficulty %s', (difficulty) => {
      const hints = buildHints(MIXED, difficulty as Difficulty)

      expect(hints.map((hint) => hint.slot)).toEqual(slotOrder(difficulty as Difficulty))
    })

    // Every rung describes the SAME tuple, so the three are jointly satisfiable -- a player who
    // spends all three gets a set some real accepted solution answers to, not three facts about
    // three different solutions. MIXED's tuple is "-*+", so difficulties 1-3 read it straight and
    // 4-5 read it 1, 0, 2.
    it.each([
      [1, ['-', '*', '+']],
      [2, ['-', '*', '+']],
      [3, ['-', '*', '+']],
      [4, ['*', '-', '+']],
      [5, ['*', '-', '+']],
    ])('takes each rung operator from the canonical tuple at that rung slot, difficulty %s', (difficulty, expected) => {
      const hints = buildHints(MIXED, difficulty as Difficulty)

      expect(hints.map((hint) => hint.operator)).toEqual(expected)
    })

    // Every other fixture here is single-tuple, which leaves the module's entry point free to ignore
    // the canonical-tuple rule entirely: swap `canonicalTuple(acceptedSolutions)` for
    // `tupleOf(acceptedSolutions[0])` and every one of them still passes, as does the generator's
    // solvability check, because any lone expression's tuple is trivially present in its own list.
    // Decision 4 is the entire reason this module has a canonical tuple, so it has to be pinned
    // where a caller actually enters. Here the FIRST entry's tuple is "+*-" and the majority is
    // "++*", two of three -- so reading position zero answers '+', '*', '-' and only the real rule
    // answers '+', '+', '*'.
    it('builds the ladder from the most-shared tuple rather than the first solution', () => {
      const hints = buildHints(['1+2*3-4', '1+2+3*4', '2+1+3*4'], 1)

      expect(hints.map((hint) => hint.operator)).toEqual(['+', '+', '*'])
    })

    it.each([1, 2, 3, 4, 5])('tags every rung with the operator discriminator at difficulty %s', (difficulty) => {
      const kinds = buildHints(MIXED, difficulty as Difficulty).map((hint) => hint.kind)

      expect(kinds).toEqual(['operator', 'operator', 'operator'])
    })

    // Difficulties 1-3 have alternative tuples, so rung 1 introduces the answer and rungs 2 and 3
    // refer back to it. "The same answer" is display copy, not a claim that one expression was
    // pinned -- a dozen expressions may share the tuple.
    it.each([1, 2, 3])('hedges rung 1 and only rung 1 at difficulty %s', (difficulty) => {
      const texts = buildHints(MIXED, difficulty as Difficulty).map((hint) => hint.text)

      expect(texts).toEqual([
        `One winning answer has "${MINUS}" as its 1st operator.`,
        `The same answer has "${TIMES}" as its 2nd operator.`,
        'The same answer has "+" as its 3rd operator.',
      ])
    })

    // On a one-tuple puzzle the hedge is not merely unnecessary -- it would imply alternatives that
    // do not exist. Rungs 2 and 3 still take a connective: the hint bar keeps every opened rung on
    // screen, so this band is READ as a list whose positions run 2, 1, 3, and without "And" that
    // looks like a numbering bug rather than the deliberate order it is.
    it.each([4, 5])('anchors the unhedged copy to the board at difficulty %s', (difficulty) => {
      const texts = buildHints(MIXED, difficulty as Difficulty).map((hint) => hint.text)

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
    it.each([4, 5])('anchors every rung of the terse band to the board, difficulty %s', (difficulty) => {
      const texts = buildHints(MIXED, difficulty as Difficulty).map((hint) => hint.text)

      expect(texts.every((text) => text.includes('operator from the left'))).toBe(true)
    })

    // The ordinal names the SLOT's position, never the rung's. A difficulty-5 ladder therefore OPENS
    // on "2nd operator" and closes on "3rd operator", and an implementation that numbered by rung
    // would open on "1st" and pass every other assertion in this file.
    it('numbers the ordinal by slot rather than by rung', () => {
      const [first, second, third] = buildHints(MIXED, 5)

      expect(first.text).toContain('2nd operator')
      expect(second.text).toContain('1st operator')
      expect(third.text).toContain('3rd operator')
    })

    // ALL FOUR mappings. '+' -> '+' is the case a switch with no default silently breaks, and the
    // unchanged mapping is exactly the one a reader assumes is safe. `operator` stays ASCII in every
    // case: the glyph lives in `text` and only in `text`.
    it.each([
      ['+', '1+2+3+4', '+'],
      ['-', '1-2-3-4', MINUS],
      ['*', '1*2*3*4', TIMES],
      ['/', '8/2/2/1', DIVIDE],
    ])('shows %s as its board glyph and keeps the ASCII operator beside it', (operator, expression, symbol) => {
      const [rung] = buildHints([expression], 1)

      expect(rung.operator).toBe(operator)
      expect(rung.text).toBe(`One winning answer has "${symbol}" as its 1st operator.`)
    })

    // The design's difficulty-4 worked example, verbatim.
    it('builds the difficulty-4 worked example', () => {
      expect(buildHints(ORIGINAL, 4)).toEqual([
        { kind: 'operator', operator: '+', slot: 1, text: 'The 2nd operator from the left is "+".' },
        { kind: 'operator', operator: '+', slot: 0, text: 'The 1st operator from the left is "+".' },
        { kind: 'operator', operator: '*', slot: 2, text: `The 3rd operator from the left is "${TIMES}".` },
      ])
    })

    // The shared fixture is the same bank, goal and difficulty, so it must carry the same ladder --
    // and until this assertion existed, nothing checked that. Replacing a rung's text with junk, or
    // a whole rung with the wrong operator and slot, passed the entire suite: no test compared the
    // fixture to anything, and tsconfig.json excludes __tests__/ so its Puzzle<GoFigureData>
    // annotation buys nothing at CI time either.
    //
    // It matters because goFigurePuzzle is the canonical goFigure example every other suite imports.
    // A fixture holding a shape the generator cannot emit teaches every test that reads it a lie --
    // which is the exact drift the comment at __mocks__.ts:21-24 was written to stop, for the same
    // fixture, one field over.
    it('agrees with the ladder the shared goFigure fixture carries', () => {
      expect(goFigurePuzzle.data.hints).toEqual(buildHints(goFigurePuzzle.data.acceptedSolutions, 4))
    })
  })
})
