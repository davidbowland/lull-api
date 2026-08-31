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

/** The true mapping with a few cipher letters withheld -- the board of a player near the end. */
const holdingAllBut = (
  data: { answer: string; ciphertext: string },
  missing: string[],
): { mapping: Record<string, string> } => ({
  mapping: Object.fromEntries(Object.entries(trueMapping(data)).filter(([cipher]) => !missing.includes(cipher))),
})

// THE WHOLE LADDER, not one rung, and every row below that is about escalation or about waste needs
// it: a rung is only worth what it adds to the rungs BEFORE it, so a fixture that calls the chooser
// once can never see the defect.
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

const foldTexts = (data: { answer: string; ciphertext: string }, mapping: Record<string, string> = {}): string[] =>
  foldLadder(data, mapping).map((rung) => cryptogramHintFor(data, rung).text)

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

  // THE COUNT GUARD, REACHED. The row above never touches it: the word rung in that record trips the
  // giveaway refusal one line earlier, so `spent.length >= RUNG_COUNT` was dead to this suite and
  // replacing it with `if (false)` changed nothing. Stored progress is untrusted and the record below
  // is exactly what the guard is for -- three letter rungs, none of which exhausts a pool, on a board
  // where the word rung would otherwise still be for sale.
  it('offers nothing beyond three rungs of one kind', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
      { cipher: 'D', kind: 'letter' },
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

  // A BARREN LETTER POOL ENDS THE LADDER RATHER THAN BUYING A FREE WORD RUNG, and this row is the
  // reverse of the one it replaced, which asserted the defect as correct behavior. The player below
  // has every cipher right but one and rung 1 handed them that one, so EVERY letter of every word is
  // either already correct or already revealed. The old count asked only "is this letter correct",
  // so `GRDX` scored 1 for the G rung 1 had just given away, and the ladder sold its most expensive
  // rung to say nothing at all.
  it('offers nothing once every cipher letter is either correct or already revealed', () => {
    const almost = holdingAllBut(DATA, ['G'])
    const spent: CryptogramSpentRung[] = [{ cipher: 'G', kind: 'letter' }]
    expect(chooseCryptogramRung(DATA, almost, spent)).toBeNull()
  })

  // THE TWO BOARDS THAT SHIPPED A RUNG WORTH NOTHING, kept as fixtures because they are the exact
  // ones a review found rather than corners invented afterwards.
  //
  // Under rot13 the four cipher letters this player does not hold are A, E, N and O. Rungs 1 and 2
  // hand over O and E, so `ORGGRE` -- BETTER -- is two letters the ladder has just revealed and two
  // the player already had right: zero new squares, on the rung that costs the most. THAN adds two,
  // and is what the ladder closes on once the word count stops crediting a rung for its neighbors'
  // work.
  it('never closes on a word made only of letters the ladder has already given away', () => {
    const data = cryptogramOf('BETTER LATE THAN NEVER')

    expect(foldTexts(data, holdingAllBut(data, ['A', 'E', 'N', 'O']).mapping)).toStrictEqual([
      'Every O is a B.',
      'Every E is an R.',
      'One of the words is THAN.',
    ])
  })

  // THE SAME DEFECT ON A FRESH BOARD, which is why it is not a corner. Rung 2 reveals the cipher for
  // A, and `AN` is two letters of which that is one -- so the giveaway rung opened a single square
  // where EGG opens two.
  it('never closes on a word one of whose two letters an earlier rung revealed', () => {
    const data = cryptogramOf('AN EGG IS AN EGG TOO')

    expect(foldTexts(data)).toStrictEqual(['Every G is a T.', 'Every N is an A.', 'One of the words is EGG.'])
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
  // WHAT A RUNG ADDS **GIVEN THE RUNGS BEFORE IT**, and the qualifier is the whole of this block's
  // repair. The previous measure was `revealedCiphers(data, [rung]).size` -- the rung in ISOLATION --
  // and it could not do either half of its job. It returned 4 for a word rung whose four letters the
  // ladder had already handed over, which is the maximum, so the fifteen assertions below passed
  // green on a ladder whose most expensive rung was worth nothing. And it returned exactly 1 for
  // EVERY letter rung, so it could not tell rung 1 from rung 2 at all: mutating the chooser to pick
  // the RAREST surviving letter for rung 2 -- precisely the regression the walk-up exists to prevent
  // -- left the whole block passing. Themed Anagrams already measured against `spent.slice(0, index)`
  // for the same reason; this is that shape.
  //
  // THE CURRENCY IS CIPHERTEXT CELLS, not distinct letters, and it is the currency the walk-up is
  // written in: a locked letter pays out in every square that holds it, so a letter appearing six
  // times is worth six and one appearing once is worth one. Counting distinct letters flattens every
  // letter rung to 1 and hides the escalation the ladder's second rung exists to deliver. This is not
  // the ruler that picks a WORD -- `chooseCryptogramRung` ranks words by distinct letters locked, for
  // the reason stated there -- it is the ruler that says what a rung was WORTH to the player.
  const netYieldOf = (data: { answer: string; ciphertext: string }, spent: CryptogramSpentRung[], index: number) => {
    const earlier = revealedCiphers(data, spent.slice(0, index))
    return [...revealedCiphers(data, [spent[index]])]
      .filter((cipher) => !earlier.has(cipher))
      .reduce((cells, cipher) => cells + occurrencesIn(data.ciphertext, cipher), 0)
  }

  const netYields = (data: { answer: string; ciphertext: string }, mapping: Record<string, string>): number[] => {
    const spent = foldLadder(data, mapping)
    return spent.map((_rung, index) => netYieldOf(data, spent, index))
  }

  // THE FRESH BOARDS ARE THE EASY HALF. The partial ones below them are where every defect this block
  // now covers actually lived: an isolated yield cannot be wrong on rung 1, and a board with nothing
  // established has no earlier rung to double-count against.
  const REPEATED = cryptogramOf('BETTER LATE THAN NEVER')
  const BOARDS: [string, { answer: string; ciphertext: string }, Record<string, string>][] = [
    ['a fresh board', DATA, {}],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES'), {}],
    ['a flat frequency table', cryptogramOf('DUMB WAX FLIGHT'), {}],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT'), {}],
    ['a phrase whose words share letters', REPEATED, {}],
    ['a short-worded phrase', cryptogramOf('AN EGG IS AN EGG TOO'), {}],
    ['a board with one cipher letter left', DATA, holdingAllBut(DATA, ['G']).mapping],
    ['a board with two cipher letters left', DATA, holdingAllBut(DATA, ['G', 'B']).mapping],
    // THE ENDGAME THAT SHIPPED THE EMPTY RUNG. Rungs 1 and 2 take O and E; the word made of O, E and
    // two letters this player already holds used to be rung 3.
    ['the endgame that sold a rung worth nothing', REPEATED, holdingAllBut(REPEATED, ['A', 'E', 'N', 'O']).mapping],
    [
      'a half-solved corpus phrase',
      cryptogramOf('THE EARLY BIRD CATCHES'),
      holdingAllBut(cryptogramOf('THE EARLY BIRD CATCHES'), ['G', 'U', 'R', 'F', 'O']).mapping,
    ],
  ]

  // NO LADDER OPENS WITH ITS STRONGEST RUNG, and the giveaway is last. Stated as a property over the
  // yields rather than as an order over the kinds -- an assertion that rung 3 is `word` passes
  // whatever the rungs are worth, and it is the shape that let a letter rung ship AFTER the word one.
  it.each(BOARDS)('opens with a weakest rung and closes with a strongest on %s', (_case, data, mapping) => {
    const yields = netYields(data, mapping)

    expect(yields[0]).toBe(Math.min(...yields))
    expect(yields[yields.length - 1]).toBe(Math.max(...yields))
  })

  it.each(BOARDS)('never steps back down the ladder on %s', (_case, data, mapping) => {
    const yields = netYields(data, mapping)

    expect(yields.filter((count, index) => index > 0 && count < yields[index - 1])).toStrictEqual([])
  })

  // NO RUNG IS WORTH NOTHING. The rule this repo states first -- a rung that spends a hint and
  // returns nothing is not a hint -- said as the arithmetic it actually is, and this is the row that
  // fails on the word-rung defect directly rather than through the ordering above.
  it.each(BOARDS)('spends no rung on squares the player already has on %s', (_case, data, mapping) => {
    expect(netYields(data, mapping).filter((cells) => cells === 0)).toStrictEqual([])
  })

  // AND NO **LETTER** RUNG NAMES A CIPHER AN EARLIER RUNG NAMED. The row above prices the waste; this
  // one names it, so a failure says which letter was sold twice rather than that a number came out
  // zero.
  //
  // THE WORD RUNG IS EXEMPT AND CANNOT BE MADE OTHERWISE, unlike Themed Anagrams, whose five kinds
  // are positionally disjoint by construction. A word is a fixed set of cipher letters; a word rung
  // that shares none with the two letter rungs before it exists only if the phrase happens to have
  // one, and refusing every other word would shorten most ladders to two for no gain. What the word
  // rung owes the player is therefore NEW letters, not ONLY new ones -- which is the row above, and
  // it is the one the BETTER LATE THAN NEVER board fails without the fix.
  it.each(BOARDS)('never re-reveals a cipher letter an earlier rung revealed on %s', (_case, data, mapping) => {
    const spent = foldLadder(data, mapping)

    const restated = spent.flatMap((rung, index) => {
      const earlier = revealedCiphers(data, spent.slice(0, index))
      return rung.kind === 'letter' ? [rung.cipher].filter((cipher) => earlier.has(cipher)) : []
    })

    expect(restated).toStrictEqual([])
  })

  // THE WALK-UP, ASSERTED IN THE BLOCK THAT EXISTS TO DEFEND IT. Rung 2 must either open strictly
  // more squares than rung 1 or take the most any surviving candidate could have offered -- the
  // second clause is the flat-frequency board, where every letter appears once and no rung can beat
  // any other. Nothing weaker distinguishes the shipped chooser from one that hands rung 2 the RAREST
  // surviving letter, which is the exact regression the walk-up was written against and which the
  // min/max rows above cannot see: on a phrase where both rungs open one square, [1, 1, 8] escalates.
  //
  // A FAULT LIST rather than a bare comparison, because a failure here has to say what was available
  // as well as what was taken.
  it.each(BOARDS)('takes the most it can from the letter pool on %s', (_case, data, mapping) => {
    const spent = foldLadder(data, mapping)
    const letters = spent.filter((rung): rung is { cipher: string; kind: 'letter' } => rung.kind === 'letter')
    const truth = trueMapping(data)

    const faults = letters.slice(1, 2).flatMap((second) => {
      const first = letters[0]
      const available = Object.keys(truth)
        .filter((cipher) => cipher !== first.cipher && mapping[cipher] !== truth[cipher])
        .map((cipher) => occurrencesIn(data.ciphertext, cipher))
      const best = Math.max(0, ...available)
      const taken = occurrencesIn(data.ciphertext, second.cipher)
      const opened = occurrencesIn(data.ciphertext, first.cipher)

      return taken > opened || taken === best ? [] : [`rung 2 opened ${taken} of an available ${best}, after ${opened}`]
    })

    expect(faults).toStrictEqual([])
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

  // OVER EVERY WORD THE COMPOSER CAN BE ASKED ABOUT, which is what makes this a negative match rather
  // than a restatement. It used to run on `{ index: 4 }` alone -- the one rung the row above already
  // pins character for character as 'One of the words is ARROW.' -- so it could not fail without that
  // row failing first, and a composer that named the position of every word BUT the fifth would have
  // passed it.
  it('never names the position of the word', () => {
    const texts = DATA.answer.split(' ').map((_word, index) => cryptogramHintFor(DATA, { index, kind: 'word' }).text)

    expect(
      texts.filter((text) => /\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/i.test(text)),
    ).toStrictEqual([])
  })

  // THE '?' FALLBACKS, AND THEY ARE REACHABLE. `spent` is a stored record a player can hand-edit, so
  // a rung naming a cipher letter this puzzle does not hold, or a word index past the end of the
  // phrase, is an input this composer receives rather than one it is protected from. Both were
  // covered only by a `not.toThrow()` row, which passes for every string a composer could produce --
  // replacing `?? '?'` with `?? 'XX'` killed nothing. The SENTENCE is what a player reads, so the
  // sentence is what is pinned.
  it.each([
    [
      'a cipher letter the puzzle does not hold',
      { cipher: 'V', kind: 'letter' } as CryptogramSpentRung,
      'Every V is a ?.',
    ],
    [
      'a word index past the end of the phrase',
      { index: 9, kind: 'word' } as CryptogramSpentRung,
      'One of the words is ?.',
    ],
  ])('renders %s as a placeholder rather than a broken sentence', (_case, rung, expected) => {
    expect(cryptogramHintFor(DATA, rung).text).toBe(expected)
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
