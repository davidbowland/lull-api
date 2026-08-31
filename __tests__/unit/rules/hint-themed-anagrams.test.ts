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
// generator can ship and the one where a third stacked rung would leave a single position free.
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

// WHAT A RUNG YIELDS, in the only currency this type deals in: positions of one answer handed over.
// Read off `pinnedIndices` rather than off a table of its own, so the ranking below cannot disagree
// with the board about what a rung reveals.
const yieldOf = (entries: { answer: string }[], rung: ThemedAnagramsSpentRung): number =>
  pinnedIndices([rung], rung.entryIndex, entries[rung.entryIndex].answer.length).size

// Every combination of solved rows on both fixtures, which is every shape the chooser can be asked
// about: three entries to spread across, two, one -- and one that is five letters long, where the
// ladder has to shorten.
const LADDERS: [string, { answer: string }[], boolean[]][] = [
  ['none solved', ENTRIES, [false, false, false, false]],
  ['one solved', ENTRIES, [true, false, false, false]],
  ['two solved', ENTRIES, [true, true, false, false]],
  ['three solved', ENTRIES, [true, true, true, false]],
  ['none solved, shortest board', SHORTEST, [false, false, false, false]],
  ['two solved, shortest board', SHORTEST, [true, true, false, false]],
  ['three solved, the six-letter entry left', SHORTEST, [false, true, true, true]],
  ['three solved, the five-letter entry left', SHORTEST, [true, false, true, true]],
]

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

  // THE STACKED LADDER, WHICH IS THE ROUTINE ENDGAME RATHER THAN A CORNER. Three rows in and one to
  // go, all three rungs land on the survivor -- and each names only the positions the ones before it
  // did not. This is the row that pinned the repetition as correct before: it used to expect
  // `bookends` here, which restated rung 1's first letter, and then `prefix3`, which restated both.
  it("names only what is new when a rung stacks onto rung 1's entry", () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [{ entryIndex: 1, kind: 'initial' }]
    expect(chooseThemedAnagramsRung(ENTRIES, solved, spent)).toStrictEqual({ entryIndex: 1, kind: 'final' })
  })

  it('drops to the inner pair once both ends of an entry are pinned', () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'final' },
    ]
    expect(chooseThemedAnagramsRung(ENTRIES, solved, spent)).toStrictEqual({ entryIndex: 1, kind: 'inner2' })
  })

  it("falls back to rung 1's entry when only two entries are unsolved", () => {
    const solved = { solved: [true, false, true, false] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 3, kind: 'bookends' },
    ]
    expect(chooseThemedAnagramsRung(ENTRIES, solved, spent)).toStrictEqual({ entryIndex: 1, kind: 'inner2' })
  })

  // TWO POSITIONS FREE, COUNTING THE UNION. On LADLE the third rung would pin {0, 1, 2, 4}, leaving
  // one position -- so the ladder would spell the answer out in the display. A rung you do not have
  // beats a bad one, so the ladder shortens instead.
  it('drops the inner rung rather than leave one position free', () => {
    const solved = { solved: [true, false, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'final' },
    ]
    expect(chooseThemedAnagramsRung(SHORTEST, solved, spent)).toBeNull()
  })

  it('ships two rungs rather than three when only the shortest entry is unsolved', () => {
    expect(foldLadder(SHORTEST, { solved: [true, false, true, true] })).toStrictEqual([
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'final' },
    ])
  })

  it('still allows the inner rung on a six-letter entry, where two positions survive', () => {
    const solved = { solved: [false, true, true, true] }
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'final' },
    ]
    expect(chooseThemedAnagramsRung(SHORTEST, solved, spent)).toStrictEqual({ entryIndex: 0, kind: 'inner2' })
  })

  it.each(LADDERS)('leaves at least two positions of every entry free with %s', (_case, entries, solved) => {
    const spent = foldLadder(entries, { solved })
    spent.forEach((rung) => {
      const { answer } = entries[rung.entryIndex]
      expect(answer.length - pinnedIndices(spent, rung.entryIndex, answer.length).size).toBeGreaterThanOrEqual(2)
    })
  })

  // THE PROPERTY THE FIVE KINDS EXIST FOR, asserted over every shape rather than over the one that
  // motivated it. A rung that named a position an earlier rung had already handed over would be a
  // hint the player pays for and already holds -- which is exactly what the stacked ladder did three
  // times in a row.
  it.each(LADDERS)('never restates a position an earlier rung revealed with %s', (_case, entries, solved) => {
    const spent = foldLadder(entries, { solved })

    const restated = spent.flatMap((rung, index) => {
      const { answer } = entries[rung.entryIndex]
      const earlier = pinnedIndices(spent.slice(0, index), rung.entryIndex, answer.length)
      return [...pinnedIndices([rung], rung.entryIndex, answer.length)].filter((position) => earlier.has(position))
    })

    expect(restated).toStrictEqual([])
  })
})

describe('escalation', () => {
  // NO LADDER OPENS WITH ITS STRONGEST RUNG, and the giveaway is last. Stated as a property over the
  // yields rather than as an order over the kinds, because an assertion that rung 2 is `bookends` is
  // the implementation restated -- it passes whatever the kinds are worth, and it is what let a
  // stacked ladder ship three rungs delivering two letters.
  //
  // YIELD ON THIS TYPE IS POSITIONS OF ONE ANSWER, which is the whole currency here: every rung names
  // positions of a single entry and nothing else, so "how much does this hand over" has one honest
  // reading and it is a count.
  it.each(LADDERS)('opens with a weakest rung and closes with a strongest with %s', (_case, entries, solved) => {
    const yields = foldLadder(entries, { solved }).map((rung) => yieldOf(entries, rung))

    expect(yields[0]).toBe(Math.min(...yields))
    expect(yields[yields.length - 1]).toBe(Math.max(...yields))
  })

  it.each(LADDERS)('never steps back down the ladder with %s', (_case, entries, solved) => {
    const yields = foldLadder(entries, { solved }).map((rung) => yieldOf(entries, rung))

    expect(yields.filter((count, index) => index > 0 && count < yields[index - 1])).toStrictEqual([])
  })

  // A LADDER IS ONE TO THREE RUNGS AND NEVER EMPTY on a board with an unsolved entry, and no two
  // rungs ever read the same. The second half is the shape this repo names as the worst failure a
  // ladder can have and it is invisible to a length assertion.
  it.each(LADDERS)('ships one to three distinct rungs with %s', (_case, entries, solved) => {
    const texts = foldLadder(entries, { solved }).map((rung) => themedAnagramsHintFor(entries, rung).text)

    expect(texts.length).toBeGreaterThanOrEqual(1)
    expect(texts.length).toBeLessThanOrEqual(3)
    expect(new Set(texts).size).toBe(texts.length)
  })

  // NOR THE SAME OPENING CLAUSE TWICE. Two rungs on one entry share "The 4th answer" and must part
  // company immediately after it; under the old kinds rung 2 was rung 1 plus a clause, which reads as
  // the same hint said again however different the two strings are.
  it.each(LADDERS)('never repeats a leading clause with %s', (_case, entries, solved) => {
    const clauses = foldLadder(entries, { solved })
      .map((rung) => themedAnagramsHintFor(entries, rung).text)
      // Through the verb and its first argument -- "The 4th answer starts with S" -- which is exactly
      // the prefix `bookends` shared with `initial`.
      .map((text) => text.split(' ').slice(0, 7).join(' '))

    expect(new Set(clauses).size).toBe(clauses.length)
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

  it('names the last letter alone', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'final' }).text).toBe('The 4th answer ends with A.')
  })

  it('names a three-letter prefix', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'prefix3' }).text).toBe(
      'The 4th answer starts with SPA.',
    )
  })

  // THE TWO POSITIONS A PREFIX ADDS, named rather than quoted as a run. "starts with PA" would be
  // false and there is no shorter true way to say which two letters these are.
  it('names the second and third letters by their positions', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'inner2' }).text).toBe(
      "The 4th answer's 2nd and 3rd letters are P and A.",
    )
  })

  // THE ENDGAME LADDER, READ END TO END. Three of four solved is the routine state, all three rungs
  // land on the survivor, and this is what a player is sold. It used to be "starts with S", "starts
  // with S and ends with A", "starts with SPA" -- one hint, three times.
  it('says three different things when all three rungs stack on one entry', () => {
    const spent = foldLadder(ENTRIES, { solved: [true, true, true, false] })

    expect(spent.map((rung) => themedAnagramsHintFor(ENTRIES, rung).text)).toStrictEqual([
      'The 4th answer starts with S.',
      'The 4th answer ends with A.',
      "The 4th answer's 2nd and 3rd letters are P and A.",
    ])
  })

  it('never hands over a whole answer', () => {
    const rungs: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'final' },
      { entryIndex: 0, kind: 'bookends' },
      { entryIndex: 0, kind: 'inner2' },
      { entryIndex: 0, kind: 'prefix3' },
    ]
    rungs.forEach((rung) => expect(themedAnagramsHintFor(ENTRIES, rung).text).not.toContain('KETTLE'))
  })

  // WHAT THE BOARD ALREADY DRAWS, and this row is the negative match that fails if a rung starts
  // naming it. The scramble is on screen, so the player can already count its tiles and read its
  // letter multiset off the plate -- every number a rung could carry would therefore be a number they
  // have. The row it replaced matched a five-to-nine word list against sentences that could not
  // contain one and omitted every digit, so it defended nothing.
  //
  // THE POSITIONAL ORDINALS ARE CUT FIRST, and they are the one number a rung may carry: "The 4th
  // answer" names WHICH row and "2nd and 3rd letters" names WHICH letters. Neither is a count of
  // anything on the plate.
  const boardNumbers = (text: string): string[] =>
    text
      .replace(/\b\d+(?:st|nd|rd|th)\b/g, '')
      .match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|long|length|\d+)\b/gi) ?? []

  it.each(LADDERS)('states no length, count or enumeration with %s', (_case, entries, solved) => {
    const found = foldLadder(entries, { solved }).flatMap((rung) =>
      boardNumbers(themedAnagramsHintFor(entries, rung).text),
    )

    expect(found).toStrictEqual([])
  })

  // THE LETTER BANK IS THE OTHER HALF OF WHAT THE PLATE SHOWS. A rung that quoted as many letters as
  // the row holds would be restating the scramble; the position axis is only worth a hint while what
  // it names is a small part of the whole.
  it.each(LADDERS)('quotes fewer letters than the row already shows with %s', (_case, entries, solved) => {
    const spent = foldLadder(entries, { solved })

    spent.forEach((rung) => {
      const { answer } = entries[rung.entryIndex]
      const quoted = (themedAnagramsHintFor(entries, rung).text.match(/\b[A-Z]+\b/g) ?? []).join('')

      expect(quoted.length).toBeLessThanOrEqual(3)
      expect(quoted.length).toBeLessThan(answer.length)
    })
  })

  it('replays a frozen rung as one fixed sentence', () => {
    expect(themedAnagramsHintFor(ENTRIES, { entryIndex: 3, kind: 'bookends' }).text).toBe(
      'The 4th answer starts with S and ends with A.',
    )
  })

  // THE '?' FALLBACKS, AND THEY ARE REACHABLE. `spent` is a stored record a player can hand-edit, so
  // an entry index this board does not have -- or an entry whose `answer` never arrived in the pack
  // -- is an input this composer receives rather than one it is protected from. They were covered
  // only by the `not.toThrow()` rows below, which pass for every string a composer could produce:
  // replacing each `?? '?'` with `?? 'XX'` killed nothing in this file. The SENTENCE is what the
  // shell renders verbatim, so the sentence is what is pinned, and the ordinal falls out of
  // `${entryIndex + 1}th` once the four-member table runs out.
  it.each([
    ['initial', { entryIndex: 9, kind: 'initial' } as ThemedAnagramsSpentRung, 'The 10th answer starts with ?.'],
    ['final', { entryIndex: 9, kind: 'final' } as ThemedAnagramsSpentRung, 'The 10th answer ends with ?.'],
    [
      'bookends',
      { entryIndex: 9, kind: 'bookends' } as ThemedAnagramsSpentRung,
      'The 10th answer starts with ? and ends with ?.',
    ],
    [
      'inner2',
      { entryIndex: 9, kind: 'inner2' } as ThemedAnagramsSpentRung,
      "The 10th answer's 2nd and 3rd letters are ? and ?.",
    ],
    ['prefix3', { entryIndex: 9, kind: 'prefix3' } as ThemedAnagramsSpentRung, 'The 10th answer starts with .'],
  ])('renders %s over an entry that is not there as a placeholder sentence', (_kind, rung, expected) => {
    expect(themedAnagramsHintFor(ENTRIES, rung).text).toBe(expected)
  })

  it('stays within the cap on every kind it can produce', () => {
    const rungs: ThemedAnagramsSpentRung[] = [
      { entryIndex: 1, kind: 'initial' },
      { entryIndex: 1, kind: 'final' },
      { entryIndex: 1, kind: 'bookends' },
      { entryIndex: 1, kind: 'inner2' },
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

  it('pins the last letter for a final', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'final' }], 0, 6)]).toStrictEqual([5])
  })

  it('pins both ends for bookends', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'bookends' }], 0, 6)].sort()).toStrictEqual([0, 5])
  })

  it('pins the second and third letters for an inner pair', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'inner2' }], 0, 6)].sort()).toStrictEqual([1, 2])
  })

  it('pins the first three for a prefix', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'prefix3' }], 0, 6)].sort()).toStrictEqual([0, 1, 2])
  })

  it('unions every rung aimed at the same entry', () => {
    const spent: ThemedAnagramsSpentRung[] = [
      { entryIndex: 0, kind: 'initial' },
      { entryIndex: 0, kind: 'final' },
      { entryIndex: 0, kind: 'inner2' },
    ]
    expect([...pinnedIndices(spent, 0, 6)].sort((left, right) => left - right)).toStrictEqual([0, 1, 2, 5])
  })

  it('ignores rungs aimed at other entries', () => {
    expect([...pinnedIndices([{ entryIndex: 1, kind: 'prefix3' }], 0, 6)]).toStrictEqual([])
  })

  // CLAMPED TO THE ANSWER. A pack whose `answer` never arrived decodes to '', and an unclamped
  // position set would inflate the union that `chooseThemedAnagramsRung` bounds -- so the guard is
  // load-bearing rather than tidy.
  it('names no position an answer does not have', () => {
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'inner2' }], 0, 2)]).toStrictEqual([1])
    expect([...pinnedIndices([{ entryIndex: 0, kind: 'bookends' }], 0, 0)]).toStrictEqual([])
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
    expect(() => chooseThemedAnagramsRung([{ answer: '' }], { solved: [false] }, [])).not.toThrow()
    expect(() => themedAnagramsHintFor([], { entryIndex: 9, kind: 'initial' })).not.toThrow()
    expect(() => themedAnagramsHintFor([], { entryIndex: 9, kind: 'inner2' })).not.toThrow()
    expect(() => pinnedDisplay('', '', new Set([0]))).not.toThrow()
  })

  it('offers nothing on an entry with no answer', () => {
    expect(chooseThemedAnagramsRung([{ answer: '' }], { solved: [false] }, [])).toBeNull()
  })
})
