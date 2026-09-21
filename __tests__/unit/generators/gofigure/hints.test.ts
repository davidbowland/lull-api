import { goFigurePuzzle } from '../../__mocks__'
import { buildHints, pickCanonical, slotOrder, tupleCounts } from '@generators/gofigure/hints'

// Explicit escapes rather than pasted glyphs: U+2212 MINUS is one keystroke from U+002D HYPHEN-MINUS and
// U+2013 EN DASH, U+00D7 from the letter x. A diff cannot tell them apart; an escape can.
const MINUS = '\u2212'
const TIMES = '\u00D7'
const DIVIDE = '\u00F7'

// The design's difficulty-4 worked example: bank 6 9 7 7, goal 154, one tuple (++*). Matches __mocks__.ts.
const ORIGINAL = ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7']

// One tuple, "-*+", three distinct operators so a swapped slot cannot hide behind a repeat. Unhedged band.
const SINGLE_TUPLE = ['1-2*3+4']

// Two tuples, canonical "-*+" -- same canonical tuple as SINGLE_TUPLE, so only the hedge differs.
const MULTI_TUPLE = ['1-2*3+4', '2-1*3+4', '1+2+3*4']

describe('hints', () => {
  // Composes the two exports the way buildHints does, so these assertions run the production path.
  const canonicalTupleOf = (acceptedSolutions: string[]) => pickCanonical(tupleCounts(acceptedSolutions))

  describe('pickCanonical', () => {
    // The majority "++*" is deliberately not the ASCII-smallest, so a tie-break applied first answers "+*+".
    it('picks the tuple shared by the most accepted solutions', () => {
      expect(canonicalTupleOf(['1+2+3*4', '2+1+3*4', '3+1+2*4', '1+2*3+4', '2+1*3+4'])).toEqual(['+', '+', '*'])
    })

    it('handles a single-expression list', () => {
      expect(canonicalTupleOf(['9-8*7/6'])).toEqual(['-', '*', '/'])
    })

    // The two candidates straddle the two orderings: raw ASCII gives "*-+", display order would give
    // "+*-". A tie between "++*" and "+*+" would prove nothing, because the two orderings agree there.
    it('breaks a tie on the smallest raw ASCII tuple, not the display order', () => {
      expect(canonicalTupleOf(['1+2*3-4', '2+1*3-4', '1*2-3+4', '2*1-3+4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // The same tie with the candidates reversed, and the pair has to stay a pair: alone, the case above
    // also passes for a selection that keeps whichever tuple it met first. Reversing flips that answer.
    it('breaks that tie the same way when the tied candidates arrive in the opposite order', () => {
      expect(canonicalTupleOf(['1*2-3+4', '2*1-3+4', '1+2*3-4', '2+1*3-4', '1-2+3*4'])).toEqual(['*', '-', '+'])
    })

    // A bug signal, not a redraw condition: acceptedSolutions is never empty in production.
    it('throws on an empty solution list', () => {
      expect(() => canonicalTupleOf([])).toThrow(
        'Could not derive a goFigure operator tuple: acceptedSolutions is empty',
      )
    })

    // OPERATOR_COUNT is a second copy of the number BANK_SIZE fixes, held separately on purpose.
    // Asserting the exact message keeps it visible; a bare `.toThrow()` passes while the copies disagree.
    it('throws with the expected operator count on an expression that does not yield three operators', () => {
      expect(() => canonicalTupleOf(['1+2+3'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++"'),
      )
    })

    // Too many operators fails silently without the length check: a longer tuple truncates to three.
    it('throws when an expression yields more than three operators', () => {
      expect(() => canonicalTupleOf(['1+2+3+4+5'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++++"'),
      )
    })
  })

  describe('slotOrder', () => {
    // Ascending marginal value: op1 says how two unidentified digits combine, op3 fixes the last step.
    it('runs op1 -> op2 -> op3 when more than one operator tuple wins', () => {
      expect(slotOrder(false)).toEqual([0, 1, 2])
    })

    // Deliberately not least-to-most-revealing: with a unique tuple op1 is not worth a rung, so rung 1 buys op2.
    it('runs op2 -> op1 -> op3 when exactly one operator tuple wins', () => {
      expect(slotOrder(true)).toEqual([1, 0, 2])
    })

    // In every band: a ladder must get hintier as it is climbed, and op3 is the strongest reveal.
    it.each([true, false])('ends on the rightmost operator when isSingleTuple is %s', (isSingleTuple) => {
      expect(slotOrder(isSingleTuple)[2]).toBe(2)
    })

    // Returning the module-level constant passes every other test and leaves it corruptible by callers.
    it('hands back a fresh array rather than the shared constant', () => {
      expect(slotOrder(true)).not.toBe(slotOrder(true))
      expect(slotOrder(true)).toEqual(slotOrder(true))
    })
  })

  describe('buildHints', () => {
    // Through buildHints, the only entry production calls: a guard moved out of pickCanonical breaks
    // the real path while every composed-helper assertion above stays green.
    it('throws through buildHints on an empty solution list', () => {
      expect(() => buildHints([])).toThrow('Could not derive a goFigure operator tuple: acceptedSolutions is empty')
    })

    it('throws through buildHints when a solution does not yield three operators', () => {
      expect(() => buildHints(['1+2+3+4+5'])).toThrow(
        new Error('Could not derive a 3-operator goFigure tuple from "++++"'),
      )
    })

    // Feeds a second argument and asserts it changes nothing. `toHaveLength(1)` is blind to the real
    // regression: `(solutions, difficulty = 3) => …` also has a `.length` of 1.
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

    // Every rung describes the same tuple, so a player who spends all three gets a set some real
    // accepted solution answers to. Both fixtures have canonical tuple "-*+", read 0, 1, 2 and 1, 0, 2.
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

    // A one-expression fixture leaves the entry point free to read `acceptedSolutions[0]` and still
    // pass. Here the first entry's tuple is "+*-" and the majority is "++*", so the two answers differ.
    it('builds the ladder from the most-shared tuple rather than the first solution', () => {
      const hints = buildHints(['1+2*3-4', '1+2+3*4', '2+1+3*4'])

      expect(hints.map((hint) => hint.metadata.operator)).toEqual(['+', '+', '*'])
    })

    // More than one tuple reaches the goal, so rung 1 introduces the answer and rungs 2 and 3 refer back.
    it('hedges rung 1 and only rung 1 when alternative tuples exist', () => {
      const texts = buildHints(MULTI_TUPLE).map((hint) => hint.text)

      expect(texts).toEqual([
        `One winning answer has "${MINUS}" as its 1st operator.`,
        `The same answer has "${TIMES}" as its 2nd operator.`,
        'The same answer has "+" as its 3rd operator.',
      ])
    })

    // On a one-tuple puzzle the hedge would imply alternatives that do not exist.
    it('anchors the unhedged copy to the board when one tuple wins', () => {
      const texts = buildHints(SINGLE_TUPLE).map((hint) => hint.text)

      expect(texts).toEqual([
        `The 2nd operator from the left is "${TIMES}".`,
        `The 1st operator from the left is "${MINUS}".`,
        'The 3rd operator from the left is "+".',
      ])
    })

    // "From the left" is not decoration: the hint bar renders rungs into a decimal-marked list, so rung
    // 1 shows as `1. The 2nd operator ...`. Asserted on every rung, since dropping it anywhere clashes.
    it('anchors every rung of the unhedged band to the board', () => {
      const texts = buildHints(SINGLE_TUPLE).map((hint) => hint.text)

      expect(texts.every((text) => text.includes('operator from the left'))).toBe(true)
    })

    // The ordinal names the slot's position, never the rung's, so a one-tuple ladder opens on "2nd
    // operator". Numbering by rung would open on "1st" and pass every other assertion in this file.
    it('numbers the ordinal by slot rather than by rung', () => {
      const [first, second, third] = buildHints(SINGLE_TUPLE)

      expect(first.text).toContain('2nd operator')
      expect(second.text).toContain('1st operator')
      expect(third.text).toContain('3rd operator')
    })

    // metadata.slot is the board position too, so a one-tuple ladder opens on slot 1, not slot 0.
    it('names the slot by board position rather than by rung', () => {
      const [first, second, third] = buildHints(SINGLE_TUPLE)

      expect(first.metadata.slot).toBe(1)
      expect(second.metadata.slot).toBe(0)
      expect(third.metadata.slot).toBe(2)
    })

    // All four mappings; '+' -> '+' is what a switch with no default breaks. One expression each, so slot 1.
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

    // The same operator in two alphabets, by design: `text` carries the board glyph for a person, and
    // `metadata.operator` stays ASCII to match `data.operators`.
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

    // Pins the naming rule `${PuzzleType}-${role}`: the type segment verbatim, the role segment required
    // even where a type has one member. Mapped over the array, not with `every`, so an empty ladder fails.
    it('tags every rung with its kind', () => {
      const ladder = buildHints(ORIGINAL)

      expect(ladder.map((rung) => rung.metadata.kind)).toEqual([
        'gofigure-operator',
        'gofigure-operator',
        'gofigure-operator',
      ])
    })

    // `toEqual` on the whole ladder pins the payload shape: a missing `kind` or extra field fails only here.
    it('builds the worked example', () => {
      expect(buildHints(ORIGINAL)).toEqual([
        {
          metadata: { kind: 'gofigure-operator', operator: '+', slot: 1 },
          text: 'The 2nd operator from the left is "+".',
        },
        {
          metadata: { kind: 'gofigure-operator', operator: '+', slot: 0 },
          text: 'The 1st operator from the left is "+".',
        },
        {
          metadata: { kind: 'gofigure-operator', operator: '*', slot: 2 },
          text: `The 3rd operator from the left is "${TIMES}".`,
        },
      ])
    })

    // goFigurePuzzle is the canonical fixture every other suite imports, and nothing else compares it to
    // the generator -- tsconfig.json excludes __tests__/, so its type annotation buys nothing at CI time.
    it('agrees with the ladder the shared goFigure fixture carries', () => {
      expect(goFigurePuzzle.data.hints).toEqual(buildHints(goFigurePuzzle.data.acceptedSolutions))
    })
  })
})
