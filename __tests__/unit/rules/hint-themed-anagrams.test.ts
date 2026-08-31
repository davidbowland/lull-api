import {
  chooseThemedAnagramsRung,
  MAX_ANAGRAM_RUNG_LENGTH,
  pinnedDisplay,
  pinnedIndices,
  themedAnagramsHintFor,
  ThemedAnagramsSpentRung,
} from '@rules/hint-themed-anagrams'

// Deliberately NOT length-sorted, so an ordinal in a sentence cannot be mistaken for a rank.
// Lengths: KETTLE 6, COLANDER 8, TOASTER 7, SPATULA 7.
const ENTRIES = [{ answer: 'KETTLE' }, { answer: 'COLANDER' }, { answer: 'TOASTER' }, { answer: 'SPATULA' }]
const fresh = { solved: [false, false, false, false] }

// MIN_WORD_LENGTH in generators/themedanagrams/words.ts is 5, so LADLE is the shortest entry the
// generator can ship and the one where three stacked rungs spell the answer out.
const SHORTEST = [{ answer: 'KETTLE' }, { answer: 'LADLE' }, { answer: 'GRATER' }, { answer: 'SKILLET' }]

const foldLadder = (entries: { answer: string }[], state: { solved: boolean[] }): ThemedAnagramsSpentRung[] => {
  const spent: ThemedAnagramsSpentRung[] = []
  let next = chooseThemedAnagramsRung(entries, state, spent)
  while (next !== null && spent.length < 3) {
    spent.push(next)
    next = chooseThemedAnagramsRung(entries, state, spent)
  }
  return spent
}

describe('chooseThemedAnagramsRung', () => {
  it('opens with an initial on the longest unsolved entry', () => {
    expect(chooseThemedAnagramsRung(ENTRIES, fresh, [])).toStrictEqual({ entryIndex: 1, kind: 'initial' })
  })

  it('follows with bookends on a different entry', () => {
    const spent: ThemedAnagramsSpentRung[] = [{ entryIndex: 1, kind: 'initial' }]
    const rung = chooseThemedAnagramsRung(ENTRIES, fresh, spent) as ThemedAnagramsSpentRung
    expect(rung.kind).toBe('bookends')
    expect(rung.entryIndex).not.toBe(1)
  })

  it('closes with a three-letter prefix on a third entry', () => {
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 2, kind: 'bookends' },
    ]
    const rung = chooseThemedAnagramsRung(ENTRIES, fresh, spent) as ThemedAnagramsSpentRung
    expect(rung.kind).toBe('prefix3')
    expect([1, 2]).not.toContain(rung.entryIndex)
  })

  it('offers nothing beyond three rungs', () => {
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 2, kind: 'bookends' },
      { entryIndex: 3, kind: 'prefix3' },
    ]
    expect(chooseThemedAnagramsRung(ENTRIES, fresh, spent)).toBeNull()
  })

  it('never names an entry the player has already solved', () => {
    const solved = { solved: [false, true, false, false] }
    expect(chooseThemedAnagramsRung(ENTRIES, solved, [])?.entryIndex).not.toBe(1)
  })

  it('offers nothing when every entry is solved', () => {
    expect(chooseThemedAnagramsRung(ENTRIES, { solved: [true, true, true, true] }, [])).toBeNull()
  })

  it("falls back to rung 1's entry when only one entry is unsolved", () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'bookends' },
    ]
    expect(chooseThemedAnagramsRung(ENTRIES, solved, spent)).toStrictEqual({ entryIndex: 1, kind: 'prefix3' })
  })

  it("reuses rung 1's entry for bookends when nothing else is unsolved", () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [{ entryIndex: 1, kind: 'initial' }]
    expect(chooseThemedAnagramsRung(ENTRIES, solved, spent)).toStrictEqual({ entryIndex: 1, kind: 'bookends' })
  })

  // TWO POSITIONS FREE, COUNTING THE UNION. On LADLE the three rungs stack onto one entry and pin
  // {0, 1, 2, 4}, leaving one position -- so the ladder would spell the answer out in the display.
  // A rung you do not have beats a bad one, so the ladder shortens instead.
  it('drops the prefix rung rather than leave one position free', () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'bookends' },
    ]
    expect(chooseThemedAnagramsRung(SHORTEST, solved, spent)).toBeNull()
  })

  it('ships two rungs rather than three when only the shortest entry is unsolved', () => {
    expect(foldLadder(SHORTEST, { solved: [true, false, true, true] })).toStrictEqual([
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'bookends' },
    ])
  })

  it('still allows the prefix rung on a six-letter entry, where two positions survive', () => {
    const solved = { solved: [false, true, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'bookends' },
    ]
    expect(chooseThemedAnagramsRung(SHORTEST, solved, spent)).toStrictEqual({ entryIndex: 0, kind: 'prefix3' })
  })

  it.each([
    ['none solved', [false, false, false, false]],
    ['one solved', [true, false, false, false]],
    ['two solved', [true, true, false, false]],
    ['three solved', [true, true, true, false]],
  ])('leaves at least two positions of every entry free with %s', (_case, solved) => {
    const spent = foldLadder(SHORTEST, { solved })
    spent.forEach((rung) => {
      const { answer } = SHORTEST[rung.entryIndex]
      expect(answer.length - pinnedIndices(spent, rung.entryIndex, answer.length).size).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('themedAnagramsHintFor', () => {
  it('names the initial with a one-based ordinal', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 1, kind: 'initial' }).text).toBe(
      'The 2nd answer starts with C.',
    )
  })

  it('names both bookends', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 2, kind: 'bookends' }).text).toBe(
      'The 3rd answer starts with T and ends with R.',
    )
  })

  it('names a three-letter prefix', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'prefix3' }).text).toBe(
      'The 4th answer starts with SPA.',
    )
  })

  it('never hands over a whole answer', () => {
    const rungs: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'bookends' },
      { entryIndex: 0, kind: 'prefix3' },
    ]
    rungs.forEach((rung) => expect(themedAnagramsHintFor(ENTRIES, rung).text).not.toContain('KETTLE'))
  })

  it('never states a word length or letter count', () => {
    const rungs: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 1, kind: 'bookends' },
      { entryIndex: 2, kind: 'prefix3' },
    ]
    rungs.forEach((rung) =>
      expect(themedAnagramsHintFor(ENTRIES, rung).text).not.toMatch(/\b(five|six|seven|eight|nine|letters)\b/i),
    )
  })

  it('replays a frozen rung as one fixed sentence', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'bookends' }).text).toBe(
      'The 4th answer starts with S and ends with A.',
    )
  })

  it('stays within the cap on the longest shape', () => {
    const rungs: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'bookends' },
      { entryIndex: 1, kind: 'prefix3' },
    ]
    rungs.forEach((rung) =>
      expect(themedAnagramsHintFor(ENTRIES, rung).text.length).toBeLessThanOrEqual(MAX_ANAGRAM_RUNG_LENGTH),
    )
  })
})

describe('pinnedIndices', () => {
  it('pins the first letter for an initial', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'initial' }], 0, 6)]).toStrictEqual([0])
  })

  it('pins both ends for bookends', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'bookends' }], 0, 6)].sort()).toStrictEqual([0, 5])
  })

  it('pins the first three for a prefix', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'prefix3' }], 0, 6)].sort()).toStrictEqual([0, 1, 2])
  })

  it('unions every rung aimed at the same entry', () => {
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'bookends' },
    ]
    expect([...pinnedIndices(spent, 0, 6)].sort((left, right) => left - right)).toStrictEqual([0, 5])
  })

  it('ignores rungs aimed at other entries', () => {
    expect([...pinnedIndices([{ entryIndex: 1, kind: 'prefix3' }], 0, 6)]).toStrictEqual([])
  })
})

describe('pinnedDisplay', () => {
  it('pins the revealed initial and fills the rest in scramble order', () => {
    expect(pinnedDisplay('SHOW', 'OSWH', new Set([0]))).toBe('SOWH')
  })

  it('pins both bookends and fills the gap', () => {
    expect(pinnedDisplay('SHOW', 'OSWH', new Set([0, 3]))).toBe('SOHW')
  })

  it('returns the scramble untouched when nothing is pinned', () => {
    expect(pinnedDisplay('SHOW', 'OSWH', new Set())).toBe('OSWH')
  })

  it('keeps the letter multiset of the answer', () => {
    const display = pinnedDisplay('KETTLE', 'ELETKT', new Set([0, 5]))
    expect([...display].sort().join('')).toBe([...'KETTLE'].sort().join(''))
  })

  // THE DISPLAY MUST NEVER BE THE ANSWER. The two-free invariant is stated over pinned INDICES; this
  // is the property it exists to buy, checked on the string the player actually reads. Each scramble
  // below shares at most floor(length / 3) positions with its answer, which is the ceiling the
  // generator's severity dial imposes on a real scramble.
  it.each([
    ['the shortest entry', 'LADLE', 'DELAL', [true, false, true, true] as boolean[], 1],
    ['a six-letter entry', 'KETTLE', 'ELETKT', [false, true, true, true] as boolean[], 0],
    ['a seven-letter entry', 'SKILLET', 'LTEKLIS', [true, true, true, false] as boolean[], 3],
  ])('leaves at least two tiles of %s wrong after the whole ladder', (_case, answer, scramble, solved, index) => {
    const spent = foldLadder(SHORTEST, { solved })
    const display = pinnedDisplay(answer, scramble, pinnedIndices(spent, index, answer.length))
    expect([...display].filter((letter, at) => letter !== answer[at]).length).toBeGreaterThanOrEqual(2)
  })

  it('spends only one copy of a repeated pinned letter', () => {
    // KETTLE pins index 0 (K) and index 5 (E); one E stays in the pool for the middle.
    expect(pinnedDisplay('KETTLE', 'ELETKT', new Set([0, 5]))).toHaveLength(6)
  })
})

describe('totality', () => {
  it('never throws, however malformed the input', () => {
    expect(() => chooseThemedAnagramsRung([], { solved: [] }, [])).not.toThrow()
    expect(() => themedAnagramsHintFor([], { entryIndex: 9, kind: 'initial' })).not.toThrow()
    expect(() => pinnedDisplay('', '', new Set([0]))).not.toThrow()
  })
})
