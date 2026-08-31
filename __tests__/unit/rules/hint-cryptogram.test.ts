import {
  chooseCryptogramRung,
  CryptogramSpentRung,
  cryptogramHintFor,
  MAX_CRYPTOGRAM_RUNG_LENGTH,
  revealedCiphers,
  trueMapping,
} from '@rules/hint-cryptogram'

// TIME FLIES LIKE AN ARROW under a fixed cipher. Letter counts in the answer:
// A 3, E 3, I 3, L 2, R 2, N 2, O 2, T 1, M 1, F 1, S 1, K 1, W 1.
const DATA = { answer: 'TIME FLIES LIKE AN ARROW', ciphertext: 'GRDX QYRXH YRPX BC BEEUZ' }

const fresh = { mapping: {} }

// A fixed substitution for the fixtures below, so a ciphertext cannot drift from its answer by a
// typo. rot13 is a derangement over A-Z, which is the only property trueMapping relies on.
const rot13 = (text: string): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => String.fromCharCode(((letter.charCodeAt(0) - 65 + 13) % 26) + 65))

const cryptogramOf = (answer: string): { answer: string; ciphertext: string } => ({
  answer,
  ciphertext: rot13(answer),
})

const occurrencesIn = (ciphertext: string, cipher: string): number =>
  (ciphertext.match(/[A-Z]/g) ?? []).filter((letter) => letter === cipher).length

describe('trueMapping', () => {
  it('aligns the ciphertext letters with the answer letters', () => {
    expect(trueMapping(DATA).G).toBe('T')
    expect(trueMapping(DATA).R).toBe('I')
  })

  it('maps every distinct cipher letter', () => {
    const distinct = new Set(DATA.ciphertext.replace(/[^A-Z]/g, ''))
    expect(Object.keys(trueMapping(DATA)).sort()).toStrictEqual([...distinct].sort())
  })
})

describe('chooseCryptogramRung', () => {
  it('opens with a letter rung', () => {
    expect(chooseCryptogramRung(DATA, fresh, [])?.kind).toBe('letter')
  })

  it('follows with a second letter rung', () => {
    const first = chooseCryptogramRung(DATA, fresh, []) as CryptogramSpentRung
    expect(chooseCryptogramRung(DATA, fresh, [first])?.kind).toBe('letter')
  })

  it('closes with a word rung', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    expect(chooseCryptogramRung(DATA, fresh, spent)?.kind).toBe('word')
  })

  it('offers nothing beyond three rungs', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
      { index: 0, kind: 'word' },
    ]
    expect(chooseCryptogramRung(DATA, fresh, spent)).toBeNull()
  })

  // THE STRICT COMPARISON IS THE POINT. The percentile pair alone did not escalate on real phrases:
  // over corpus-shaped answers the count-1 letters are a MAJORITY of the distinct set, so both
  // percentile indices land inside the same low-count block and rung 2 routinely repeated rung 1's
  // yield exactly. `toBeLessThanOrEqual` was written to tolerate that and hid it.
  it.each([
    ['the fixture phrase', DATA],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES')],
    // Twenty distinct letters is MAX_UNIQUE in cryptogram/difficulty.ts, and sixteen of them appear
    // once -- the skew that flattened the plain percentile. Rung 2's percentile candidate ties rung 1
    // here, so this row passes only because the walk-up fires.
    ['a near-pangram', cryptogramOf('THE QUICK BROWN FOX JUMPS OVER')],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT')],
  ])('opens more squares with rung 2 than with rung 1 on %s', (_case, data) => {
    const first = chooseCryptogramRung(data, fresh, []) as { cipher: string }
    const second = chooseCryptogramRung(data, fresh, [first as CryptogramSpentRung]) as { cipher: string }
    expect(occurrencesIn(data.ciphertext, second.cipher)).toBeGreaterThan(occurrencesIn(data.ciphertext, first.cipher))
  })

  // DUMB WAX FLIGHT is thirteen letters, all distinct -- inside MIN_LETTERS 12 and MAX_UNIQUE 20, so
  // the generator can produce it. Every count is 1, so no candidate anywhere beats rung 1 and the
  // walk-up has nothing to walk to.
  const FLAT = cryptogramOf('DUMB WAX FLIGHT')

  it('still escalates weakly when every letter appears exactly once', () => {
    const first = chooseCryptogramRung(FLAT, fresh, []) as { cipher: string }
    const second = chooseCryptogramRung(FLAT, fresh, [first as CryptogramSpentRung]) as { cipher: string }
    expect(occurrencesIn(FLAT.ciphertext, second.cipher)).toBeGreaterThanOrEqual(
      occurrencesIn(FLAT.ciphertext, first.cipher),
    )
  })

  it('takes the highest-count candidate when nothing beats rung 1', () => {
    const first = chooseCryptogramRung(FLAT, fresh, []) as { cipher: string }
    const second = chooseCryptogramRung(FLAT, fresh, [first as CryptogramSpentRung]) as { cipher: string }
    const highest = Math.max(
      ...Object.keys(trueMapping(FLAT))
        .filter((cipher) => cipher !== first.cipher)
        .map((cipher) => occurrencesIn(FLAT.ciphertext, cipher)),
    )
    expect(occurrencesIn(FLAT.ciphertext, second.cipher)).toBe(highest)
  })

  it('treats a spent rung naming a letter the puzzle does not hold as no floor at all', () => {
    // Stored progress is untrusted, so `spent` can name a cipher letter that is not in this puzzle.
    // It contributes no occurrence count, and rung 2 still escalates against the real board.
    const spent: CryptogramSpentRung[] = [{ cipher: 'V', kind: 'letter' }]
    const rung = chooseCryptogramRung(DATA, fresh, spent) as { cipher: string }
    expect(occurrencesIn(DATA.ciphertext, rung.cipher)).toBeGreaterThan(0)
  })

  // A BARREN LETTER POOL SKIPS THE LETTER RUNG, IT DOES NOT END THE LADDER. The player below has
  // every cipher right but one, and rung 1 handed them that one -- so rung 2 has no candidate left
  // while the word rung still has squares to open.
  it('falls through to the word rung when no letter candidate is left', () => {
    const truth = trueMapping(DATA)
    const almost = { mapping: Object.fromEntries(Object.entries(truth).filter(([cipher]) => cipher !== 'G')) }
    const spent: CryptogramSpentRung[] = [{ cipher: 'G', kind: 'letter' }]
    expect(chooseCryptogramRung(DATA, almost, spent)?.kind).toBe('word')
  })

  // THE MIRROR OF THE ROW ABOVE, and the defect it caught. Skipping a barren pool is what lets the
  // word rung be bought at rung 2 -- and the letter pool then REFILLS, because un-mapping a letter
  // they had right puts it back. The old order asked "have I sold two letters yet?" before it asked
  // "is the giveaway out?", so this board was sold a one-square hint after the one worth a whole
  // word. There is nothing left to sell, and the ladder is two rungs.
  it('offers nothing once the word rung is spent, however full the letter pool is', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { index: 1, kind: 'word' },
    ]
    expect(chooseCryptogramRung(DATA, fresh, spent)).toBeNull()
  })

  it('never picks the same letter twice', () => {
    const first = chooseCryptogramRung(DATA, fresh, []) as { cipher: string }
    const second = chooseCryptogramRung(DATA, fresh, [first as CryptogramSpentRung]) as { cipher: string }
    expect(second.cipher).not.toBe(first.cipher)
  })

  it('skips a letter the player already has right', () => {
    const first = chooseCryptogramRung(DATA, fresh, []) as { cipher: string }
    const solved = { mapping: { [first.cipher]: trueMapping(DATA)[first.cipher] } }
    expect((chooseCryptogramRung(DATA, solved, []) as { cipher: string }).cipher).not.toBe(first.cipher)
  })

  it('still offers a letter the player has mapped WRONGLY', () => {
    const first = chooseCryptogramRung(DATA, fresh, []) as { cipher: string }
    const wrong = { mapping: { [first.cipher]: 'Z' } }
    expect((chooseCryptogramRung(DATA, wrong, []) as { cipher: string }).cipher).toBe(first.cipher)
  })

  it('offers no letter rung when every letter is already correct', () => {
    expect(chooseCryptogramRung(DATA, { mapping: trueMapping(DATA) }, [])).toBeNull()
  })

  it('offers no word rung when every word is already solved', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    expect(chooseCryptogramRung(DATA, { mapping: trueMapping(DATA) }, spent)).toBeNull()
  })

  it('picks the word with the most unsolved DISTINCT cipher letters', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    // QYRXH holds five distinct cipher letters; BEEUZ is the same five cells but only four distinct.
    // The rung is chosen by what it LOCKS, never by which word reads better.
    expect(chooseCryptogramRung(DATA, fresh, spent)).toStrictEqual({ index: 1, kind: 'word' })
  })

  it('prefers a shorter word that locks more distinct letters', () => {
    // Six cells against five, but one distinct cipher letter against five. Opening a word locks
    // every distinct letter in it, and a locked letter pays out over the whole board, so the cell
    // count is the wrong ruler.
    const data = cryptogramOf('AAAAAA BCDEF')
    const spent: CryptogramSpentRung[] = [
      { cipher: rot13('B'), kind: 'letter' },
      { cipher: rot13('C'), kind: 'letter' },
    ]
    expect(chooseCryptogramRung(data, fresh, spent)).toStrictEqual({ index: 1, kind: 'word' })
  })
})

describe('escalation', () => {
  const foldLadder = (
    data: { answer: string; ciphertext: string },
    mapping: Record<string, string> = {},
  ): CryptogramSpentRung[] => {
    const spent: CryptogramSpentRung[] = []
    let next = chooseCryptogramRung(data, { mapping }, spent)
    while (next !== null && spent.length < 3) {
      spent.push(next)
      next = chooseCryptogramRung(data, { mapping }, spent)
    }
    return spent
  }

  // WHAT A RUNG YIELDS, in the currency the chooser itself buys with: distinct cipher letters LOCKED.
  // A letter rung locks one; a word rung locks every distinct letter in that word, and a locked
  // letter pays out across the whole board rather than in the cells it was bought from. Counting
  // CELLS would rank a six-cell word of one letter above a five-cell word of five, which is exactly
  // the ruler `chooseCryptogramRung` refuses.
  const yieldOf = (data: { answer: string; ciphertext: string }, rung: CryptogramSpentRung): number =>
    revealedCiphers(data, [rung]).size

  const BOARDS: [string, { answer: string; ciphertext: string }, Record<string, string>][] = [
    ['a fresh board', DATA, {}],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES'), {}],
    ['a flat frequency table', cryptogramOf('DUMB WAX FLIGHT'), {}],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT'), {}],
    [
      'a board with one cipher letter left',
      DATA,
      Object.fromEntries(Object.entries(trueMapping(DATA)).filter(([cipher]) => cipher !== 'G')),
    ],
  ]

  // NO LADDER OPENS WITH ITS STRONGEST RUNG, and the giveaway is last. Stated as a property over the
  // yields rather than as an order over the kinds -- an assertion that rung 3 is `word` passes
  // whatever the rungs are worth, and it is the shape that let a letter rung ship AFTER the word one.
  it.each(BOARDS)('opens with a weakest rung and closes with a strongest on %s', (_case, data, mapping) => {
    const yields = foldLadder(data, mapping).map((rung) => yieldOf(data, rung))

    expect(yields[0]).toBe(Math.min(...yields))
    expect(yields[yields.length - 1]).toBe(Math.max(...yields))
  })

  it.each(BOARDS)('never steps back down the ladder on %s', (_case, data, mapping) => {
    const yields = foldLadder(data, mapping).map((rung) => yieldOf(data, rung))

    expect(yields.filter((count, index) => index > 0 && count < yields[index - 1])).toStrictEqual([])
  })

  // THE WORD RUNG IS THE GIVEAWAY, so it is last or it is nowhere. `at(-1)` rather than an index,
  // because the ladder's length varies: a barren letter pool shortens it to two.
  it.each(BOARDS)('puts the word rung last or not at all on %s', (_case, data, mapping) => {
    const ladder = foldLadder(data, mapping)

    expect(ladder.filter((rung) => rung.kind === 'word')).toStrictEqual(
      ladder.at(-1)?.kind === 'word' ? [ladder.at(-1)] : [],
    )
  })
})

describe('revealedCiphers', () => {
  it('collects the letter a letter rung revealed', () => {
    expect([...revealedCiphers(DATA, [{ cipher: 'G', kind: 'letter' }])]).toStrictEqual(['G'])
  })

  it('collects every distinct letter a word rung revealed', () => {
    // Word 4 of the ciphertext is BEEUZ, whose distinct letters are B, E, U and Z.
    expect([...revealedCiphers(DATA, [{ index: 4, kind: 'word' }])].sort()).toStrictEqual(['B', 'E', 'U', 'Z'])
  })
})

describe('cryptogramHintFor', () => {
  it('names the letter a letter rung revealed', () => {
    expect(cryptogramHintFor(DATA, { cipher: 'G', kind: 'letter' }).text).toBe('Every G is a T.')
  })

  it('uses "an" before a letter whose name opens on a vowel sound', () => {
    expect(cryptogramHintFor(DATA, { cipher: 'R', kind: 'letter' }).text).toBe('Every R is an I.')
  })

  it('names the word a word rung revealed', () => {
    expect(cryptogramHintFor(DATA, { index: 4, kind: 'word' }).text).toBe('One of the words is ARROW.')
  })

  it('never names the position of the word', () => {
    const text = cryptogramHintFor(DATA, { index: 4, kind: 'word' }).text
    expect(text).not.toMatch(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/i)
  })

  it('replays a frozen rung as one fixed sentence', () => {
    expect(cryptogramHintFor(DATA, { cipher: 'R', kind: 'letter' }).text).toBe('Every R is an I.')
  })

  it('stays within the cap on every rung it can produce', () => {
    const rungs: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { index: 0, kind: 'word' },
      { index: 4, kind: 'word' },
    ]
    rungs.forEach((rung) =>
      expect(cryptogramHintFor(DATA, rung).text.length).toBeLessThanOrEqual(MAX_CRYPTOGRAM_RUNG_LENGTH),
    )
  })

  // THE CEILING ROW. Cryptogram has NO per-word gate: services/phrases.ts bounds the whole text at
  // MAX_TEXT_LENGTH 80 with MIN_WORDS 2, so the longest legal word is 78 letters -- 80 less a space
  // and a one-letter second word -- and the frame around it is 21 characters. This row is the exact
  // ceiling, and it fails the moment the cap is set below what a legal puzzle can produce.
  it('reaches the cap exactly on the longest legal word', () => {
    const longest = `${'ABCDEF'.repeat(13)} B`
    const data = cryptogramOf(longest)
    expect(longest).toHaveLength(80)
    expect(cryptogramHintFor(data, { index: 0, kind: 'word' }).text).toHaveLength(MAX_CRYPTOGRAM_RUNG_LENGTH)
  })

  it('emits no empty rung', () => {
    const rungs: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { index: 0, kind: 'word' },
    ]
    rungs.forEach((rung) => expect(cryptogramHintFor(DATA, rung).text.length).toBeGreaterThan(0))
  })
})

describe('totality', () => {
  it('never throws, however malformed the input', () => {
    const broken = { answer: '', ciphertext: '' }
    expect(() => chooseCryptogramRung(broken, fresh, [])).not.toThrow()
    expect(() => cryptogramHintFor(broken, { cipher: 'Q', kind: 'letter' })).not.toThrow()
    expect(() => cryptogramHintFor(broken, { index: 9, kind: 'word' })).not.toThrow()
  })

  it('offers nothing on an empty puzzle', () => {
    expect(chooseCryptogramRung({ answer: '', ciphertext: '' }, fresh, [])).toBeNull()
  })
})
