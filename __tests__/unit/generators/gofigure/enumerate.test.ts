import { enumerateSolutions } from '@generators/gofigure/enumerate'
import { Operator } from '@types'

describe('enumerate', () => {
  const allOperators: Operator[] = ['+', '-', '*', '/']

  describe('enumerateSolutions', () => {
    it('builds an expression by concatenating operands and operators', () => {
      const solutions = enumerateSolutions([1, 2], ['+'])

      expect(solutions.get(3)).toEqual({ expressions: ['1+2', '2+1'], operatorTuples: 1 })
    })

    it('deduplicates identical expression strings from a repeated digit', () => {
      const solutions = enumerateSolutions([7, 7], ['+'])

      expect(solutions.get(14)).toEqual({ expressions: ['7+7'], operatorTuples: 1 })
    })

    it('counts distinct operator sequences', () => {
      const solutions = enumerateSolutions([2, 2], allOperators)

      expect(solutions.get(4)).toEqual({ expressions: ['2*2', '2+2'], operatorTuples: 2 })
    })

    it("rates the original game's puzzle as six expressions from one operator tuple", () => {
      const solutions = enumerateSolutions([6, 9, 7, 7], allOperators)

      expect(solutions.get(154)).toEqual({
        expressions: ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7'],
        operatorTuples: 1,
      })
    })

    it('omits expressions with a non-integer intermediate', () => {
      const solutions = enumerateSolutions([5, 2, 2], ['/', '*'])

      expect(solutions.get(5)?.expressions).not.toContain('5/2*2')
      expect(solutions.get(5)?.expressions).toEqual(['2*5/2', '2/2*5', '5*2/2'])
    })

    it('omits goals no arrangement reaches', () => {
      const solutions = enumerateSolutions([1, 2], ['+'])

      expect(solutions.get(99)).toBeUndefined()
    })

    it('returns the same result for the same bank every time', () => {
      const first = enumerateSolutions([3, 4, 5], allOperators)
      const second = enumerateSolutions([3, 4, 5], allOperators)

      expect([...first.entries()]).toEqual([...second.entries()])
    })
  })
})
