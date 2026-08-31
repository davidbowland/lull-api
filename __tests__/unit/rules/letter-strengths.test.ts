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

  it('is the exact reverse in the weak ordering', () => {
    expect(WEAKEST_FIRST).toStrictEqual([...STRONGEST_FIRST].reverse())
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
