import { LETTER_STRENGTHS, STRONGEST_FIRST, WEAKEST_FIRST } from '@rules/letter-strengths'

describe('letter-strengths', () => {
  it('scores all twenty-six letters', () => {
    expect(Object.keys(LETTER_STRENGTHS)).toHaveLength(26)
  })

  it('scores every letter A-Z and nothing else', () => {
    expect(Object.keys(LETTER_STRENGTHS).sort().join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  it('opens the strong ordering with E, the commonest letter', () => {
    expect(STRONGEST_FIRST[0]).toBe('E')
  })

  it('closes the strong ordering with Q, the rarest', () => {
    expect(STRONGEST_FIRST.at(-1)).toBe('Q')
  })

  it('orders the first five by descending strength', () => {
    expect(STRONGEST_FIRST.slice(0, 5)).toStrictEqual(['E', 'A', 'R', 'I', 'O'])
  })

  it('freezes the table so a caller cannot re-rank every shipped hint', () => {
    expect(Object.isFrozen(LETTER_STRENGTHS)).toBe(true)
  })

  // Holds BY CONSTRUCTION rather than by luck: WEAKEST_FIRST is STRONGEST_FIRST reversed, not a
  // second sort. A second sort with the same alphabetical tie-break would order tied letters the
  // same way in both directions, and this assertion would fail the day the table gains a tie.
  it('is the exact reverse in the weak ordering', () => {
    expect(WEAKEST_FIRST).toStrictEqual([...STRONGEST_FIRST].reverse())
  })

  it('ascends monotonically through the weak ordering', () => {
    const strengths = WEAKEST_FIRST.map((letter) => LETTER_STRENGTHS[letter])
    const ascending = [...strengths].sort((left, right) => left - right)
    expect(strengths).toStrictEqual(ascending)
  })

  it('holds every letter in each ordering', () => {
    expect(STRONGEST_FIRST).toHaveLength(26)
    expect(WEAKEST_FIRST).toHaveLength(26)
  })

  it('descends monotonically through the strong ordering', () => {
    const strengths = STRONGEST_FIRST.map((letter) => LETTER_STRENGTHS[letter])
    const descending = [...strengths].sort((left, right) => right - left)
    expect(strengths).toStrictEqual(descending)
  })
})
