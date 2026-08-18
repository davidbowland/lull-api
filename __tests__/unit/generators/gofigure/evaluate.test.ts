import { evaluateLeftToRight } from '@generators/gofigure/evaluate'
import { Operator } from '@types'

describe('evaluate', () => {
  describe('evaluateLeftToRight', () => {
    it.each([
      ['addition', [1, 2], ['+'], 3],
      ['subtraction', [1, 2], ['-'], -1],
      ['multiplication', [3, 4], ['*'], 12],
      ['division', [8, 4], ['/'], 2],
    ])('applies %s', (_description, operands, operators, expected) => {
      expect(evaluateLeftToRight(operands as number[], operators as Operator[])).toBe(expected)
    })

    it('returns the sole operand when there are no operators', () => {
      expect(evaluateLeftToRight([7], [])).toBe(7)
    })

    it("evaluates the original game's own puzzle left to right", () => {
      // 6+9=15, +7=22, *7=154 -- with precedence it would be 6+9+49=64
      expect(evaluateLeftToRight([6, 9, 7, 7], ['+', '+', '*'])).toBe(154)
    })

    it('gives a different answer for a reordering, because there is no precedence', () => {
      // The TI-83 screenshot: 7+7+9*7 displays 161, not 77
      expect(evaluateLeftToRight([7, 7, 9, 7], ['+', '+', '*'])).toBe(161)
    })

    it('allows a negative intermediate', () => {
      expect(evaluateLeftToRight([1, 9, 3], ['-', '*'])).toBe(-24)
    })

    it('rejects a non-integer intermediate even when the result would be whole', () => {
      // 5/2 is 2.5, so the expression is rejected despite 5/2*2 being 5
      expect(evaluateLeftToRight([5, 2, 2], ['/', '*'])).toBeNull()
    })

    it('rejects division by zero', () => {
      expect(evaluateLeftToRight([5, 0], ['/'])).toBeNull()
    })

    it('stops evaluating once a step has failed', () => {
      expect(evaluateLeftToRight([5, 0, 3, 4], ['/', '+', '*'])).toBeNull()
    })
  })
})
