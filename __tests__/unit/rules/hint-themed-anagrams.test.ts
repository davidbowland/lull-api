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

  it('replays a frozen rung identically', () => {
    const rung: ThemedAnagramsSpentRung = { entryIndex: 1, kind: 'initial' }
    expect(themedAnagramsHintFor(ENTRIES, rung)).toStrictEqual(themedAnagramsHintFor(ENTRIES, rung))
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
