import { goFigurePuzzle } from '../../__mocks__'
import { buildHints, canonicalTuple, slotOrder } from '@generators/gofigure/hints'
import { Difficulty } from '@types'

// The board glyphs (U+2212 MINUS SIGN, U+00D7 MULTIPLICATION SIGN, U+00F7 DIVISION SIGN) used to be
// declared here as escapes, because each is one indistinguishable keystroke from something else and
// a diff cannot tell them apart. They are gone with the `text` field: this module emits ASCII
// operators only, and lull-ui maps them to glyphs at render time.

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

    // The rung carries the SLOT, and nothing that restates it. A difficulty-5 ladder opens on slot 1
    // and closes on slot 2, so an implementation that numbered by rung would open on slot 0 and pass
    // every other assertion in this file.
    it('names the slot by board position rather than by rung', () => {
      const [first, second, third] = buildHints(MIXED, 5)

      expect(first.slot).toBe(1)
      expect(second.slot).toBe(0)
      expect(third.slot).toBe(2)
    })

    // ALL FOUR operators, kept ASCII. The board glyphs (+ − × ÷) are lull-ui's business now, so the
    // one thing this file still owes it is the unconverted character -- '/' must not arrive as ÷.
    it.each([
      ['+', '1+2+3+4'],
      ['-', '1-2-3-4'],
      ['*', '1*2*3*4'],
      ['/', '8/2/2/1'],
    ])('keeps %s as its ASCII operator', (operator, expression) => {
      const [rung] = buildHints([expression], 1)

      expect(rung.operator).toBe(operator)
    })

    // The design's difficulty-4 worked example, verbatim. `toEqual` on the whole ladder is what pins
    // the payload's SHAPE: an extra `kind` or `text` field would fail here and nowhere else.
    it('builds the difficulty-4 worked example', () => {
      expect(buildHints(ORIGINAL, 4)).toEqual([
        { operator: '+', slot: 1 },
        { operator: '+', slot: 0 },
        { operator: '*', slot: 2 },
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
