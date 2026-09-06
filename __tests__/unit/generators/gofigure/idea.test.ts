import { canonicalIdea } from '@generators/gofigure/idea'
import { Operator } from '@types'

describe('idea', () => {
  describe('canonicalIdea', () => {
    it('returns the lone operand when there are no operators', () => {
      expect(canonicalIdea([7], [])).toEqual(canonicalIdea([7], []))
      expect(canonicalIdea([7], [])).not.toEqual(canonicalIdea([8], []))
    })

    it('treats the operands of a leading addition as interchangeable', () => {
      expect(canonicalIdea([1, 2], ['+'])).toEqual(canonicalIdea([2, 1], ['+']))
    })

    it('treats the operands of a leading multiplication as interchangeable', () => {
      expect(canonicalIdea([3, 4], ['*'])).toEqual(canonicalIdea([4, 3], ['*']))
    })

    // The original game's puzzle: six expressions reach 154 from bank 6,9,7,7, and a player who has
    // found one has found all six. The leading '+' run covers three operands, not two.
    it('collapses every ordering inside a leading addition run', () => {
      const ideas = new Set(
        [
          [6, 7, 9, 7],
          [6, 9, 7, 7],
          [7, 6, 9, 7],
          [7, 9, 6, 7],
          [9, 6, 7, 7],
          [9, 7, 6, 7],
        ].map((operands) => canonicalIdea(operands, ['+', '+', '*'])),
      )

      expect(ideas.size).toBe(1)
    })

    // 9-1-2 and 9-2-1 are both 6, because x-b-c is x-(b+c). The player who found one has the other.
    it('treats the trailing operands of a subtraction run as interchangeable', () => {
      expect(canonicalIdea([9, 1, 2], ['-', '-'])).toEqual(canonicalIdea([9, 2, 1], ['-', '-']))
    })

    // 8/4/2 and 8/2/4 are both 1, because x/b/c is x/(b*c).
    it('treats the trailing operands of a division run as interchangeable', () => {
      expect(canonicalIdea([8, 4, 2], ['/', '/'])).toEqual(canonicalIdea([8, 2, 4], ['/', '/']))
    })

    // The half a run of '-' does NOT give away: 9-1-2 is 6 and 1-9-2 is -10. A run that starts at
    // position 0 only swallows its leading operand when the operator commutes.
    it('keeps the leading operand of a subtraction run fixed', () => {
      expect(canonicalIdea([9, 1, 2], ['-', '-'])).not.toEqual(canonicalIdea([1, 9, 2], ['-', '-']))
    })

    it('keeps the leading operand of a division run fixed', () => {
      expect(canonicalIdea([8, 4, 2], ['/', '/'])).not.toEqual(canonicalIdea([4, 8, 2], ['/', '/']))
    })

    it('permutes the operands of a multiplication run that does not start the expression', () => {
      expect(canonicalIdea([2, 3, 4, 5], ['+', '*', '*'])).toEqual(canonicalIdea([2, 3, 5, 4], ['+', '*', '*']))
    })

    // A run ends where the operator changes, so an operand may not cross that boundary: 1+2*3 is 9
    // and 1+3*2 is 8. This is the assertion that fails if the walk merges unlike operators.
    it('does not permute an operand across an operator change', () => {
      expect(canonicalIdea([1, 2, 3], ['+', '*'])).not.toEqual(canonicalIdea([1, 3, 2], ['+', '*']))
    })

    // Same operators, same multiset of operands, genuinely different values: 6/2*4 is 12 and
    // 6*4/2 is 12 too -- but 4*6/2 is also 12 and IS the same idea as 6*4/2. The pair below is the
    // one that must stay apart, because the '/' leads in one and follows in the other.
    it('separates arrangements that differ by which run an operand sits in', () => {
      expect(canonicalIdea([6, 2, 4], ['/', '*'])).not.toEqual(canonicalIdea([6, 4, 2], ['*', '/']))
    })

    it('returns the same string for the same arrangement every time', () => {
      const operators: Operator[] = ['+', '-', '*']

      expect(canonicalIdea([1, 2, 3, 4], operators)).toEqual(canonicalIdea([1, 2, 3, 4], operators))
    })
  })
})
