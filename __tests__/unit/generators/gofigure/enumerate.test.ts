import { enumerateSolutions } from '@generators/gofigure/enumerate'
import { Operator } from '@types'

describe('enumerate', () => {
  const allOperators: Operator[] = ['+', '-', '*', '/']

  describe('enumerateSolutions', () => {
    it('builds an expression by concatenating operands and operators', () => {
      const solutions = enumerateSolutions([1, 2], ['+'])

      expect(solutions.get(3)).toEqual({ expressions: ['1+2', '2+1'], ideas: ['+1,2'], operatorTuples: [['+']] })
    })

    it('deduplicates identical expression strings from a repeated digit', () => {
      const solutions = enumerateSolutions([7, 7], ['+'])

      expect(solutions.get(14)).toEqual({ expressions: ['7+7'], ideas: ['+7,7'], operatorTuples: [['+']] })
    })

    // Two expressions, two tuples. The two orderings of a repeated digit collapse by expression
    // string, so anything left in this list is a genuinely different operator sequence.
    //
    // The ORDER is asserted too, and this fixture is the one that can pin it. The list is sorted by
    // the joined tuple for the same reason expressions are sorted just above -- insertion order is a
    // function of the permutation walk, so an unsorted list would silently reorder the day that walk
    // is rewritten, and this one now ships to the client inside GoFigureData. Sorting is raw ASCII,
    // which is what `<` on the joined strings already gives: '*' (U+002A) < '+' (U+002B). That is NOT
    // the display order the board uses (+ − × ÷), and this pair is exactly where the two disagree --
    // under display order the answer would be [['+'], ['*']].
    it('lists distinct operator sequences, ordered by raw ASCII rather than display order', () => {
      const solutions = enumerateSolutions([2, 2], allOperators)

      expect(solutions.get(4)).toEqual({
        expressions: ['2*2', '2+2'],
        ideas: ['*2,2', '+2,2'],
        operatorTuples: [['*'], ['+']],
      })
    })

    // SIX expressions, one tuple, and ONE idea -- a player who has found any of these six has found
    // all six, because they differ only in the order of the three operands inside the leading '+'
    // run. This is the fixture the difficulty grader turns on: reading six here is reading the
    // permutability of the operands, not the number of answers.
    it("rates the original game's puzzle as six expressions from one idea", () => {
      const solutions = enumerateSolutions([6, 9, 7, 7], allOperators)

      expect(solutions.get(154)).toEqual({
        expressions: ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7'],
        ideas: ['+6,7,9|*7'],
        operatorTuples: [['+', '+', '*']],
      })
    })

    it('omits expressions with a non-integer intermediate', () => {
      const solutions = enumerateSolutions([5, 2, 2], ['/', '*'])

      expect(solutions.get(5)?.expressions).not.toContain('5/2*2')
      expect(solutions.get(5)?.expressions).toEqual(['2*5/2', '2/2*5', '5*2/2'])
    })

    // Three expressions, two tuples, and TWO ideas. 2*5/2 and 5*2/2 are the same idea -- the leading
    // '*' run commutes -- while 2/2*5 divides first and is a route a player finds separately. The
    // idea count sits BETWEEN the tuple count and the expression count here, which is the whole
    // reason it is a third field rather than either of the other two rebadged.
    it('collapses only the arrangements that reorder within one operator run', () => {
      const solutions = enumerateSolutions([5, 2, 2], ['/', '*'])

      expect(solutions.get(5)?.ideas).toEqual(['*2,5|/2', '2|/2|*5'])
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
