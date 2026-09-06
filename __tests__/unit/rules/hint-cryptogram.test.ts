import {
  chooseCryptogramRung,
  CryptogramSpentRung,
  cryptogramHintFor,
  MAX_CRYPTOGRAM_RUNG_LENGTH,
  revealedCiphers,
  seededRandom,
  trueMapping,
} from '@rules/hint-cryptogram'

// TIME FLIES LIKE AN ARROW under a fixed cipher. Letter counts in the answer:
// A 3, E 3, I 3, L 2, R 2, N 2, O 2, T 1, M 1, F 1, S 1, K 1, W 1.
const DATA = { answer: 'TIME FLIES LIKE AN ARROW', ciphertext: 'GRDX QYRXH YRPX BC BEEUZ' }

const fresh = { mapping: {} }

// THE DRAW, PINNED, so every row that is about WHICH TIER a rung comes from is not also about which
// member of that tier. `() => 0` takes the first of the pool, and the pool is the target tier of a
// list sorted by count and then alphabetically -- so these rows read as the alphabetically first
// letter of the tier. The rows that exercise the draw hand the chooser a different generator, and
// the `the draw` block covers the seeding.
const fixedDraw = (): number => 0

// One tick under 1, which lands on the LAST member of any pool. `() => 1` would not: the chooser
// multiplies by the pool size and floors, so exactly 1 indexes one past the end -- which is the
// input the `??` fallback is written for and not the input this fixture is for.
const lastDraw = (): number => 0.999999

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
  let next = chooseCryptogramRung(data, { mapping }, spent, fixedDraw)
  while (next !== null && spent.length < 3) {
    spent.push(next)
    next = chooseCryptogramRung(data, { mapping }, spent, fixedDraw)
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
    expect(chooseCryptogramRung(DATA, fresh, [], fixedDraw)?.kind).toBe('letter')
  })

  it('follows with a second letter rung', () => {
    const first = chooseCryptogramRung(DATA, fresh, [], fixedDraw) as CryptogramSpentRung
    expect(chooseCryptogramRung(DATA, fresh, [first], fixedDraw)?.kind).toBe('letter')
  })

  it('closes with a word rung', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    expect(chooseCryptogramRung(DATA, fresh, spent, fixedDraw)?.kind).toBe('word')
  })

  it('offers nothing beyond three rungs', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
      { index: 0, kind: 'word' },
    ]
    expect(chooseCryptogramRung(DATA, fresh, spent, fixedDraw)).toBeNull()
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
    expect(chooseCryptogramRung(DATA, fresh, spent, fixedDraw)).toBeNull()
  })

  // THE TWO POOLS, NAMED AS FREQUENCIES RATHER THAN AS POSITIONS. Rung 1 draws from the
  // SECOND-RAREST occurrence count present, rung 2 from the HIGHEST count still available. Both are
  // frequency tiers over this puzzle's own ciphertext, so a board where sixteen of twenty letters
  // appear once has ONE tier there and the tiers above it are reachable rather than drowned.
  //
  // DEAL ACE is the shape the rule was written for: 2 A, 2 E, 1 C, 1 D, 1 L. The rarest tier is the
  // three letters that appear once, and a rung naming one of those opens a single square out of
  // eight -- a hint the player pays for and can barely use. The second-rarest tier is A and E, and
  // that is where the ladder now opens.
  const TIERED = cryptogramOf('DEAL ACE')

  /** The distinct occurrence counts the surviving candidates fall into, rarest first. */
  const tiersOf = (data: { answer: string; ciphertext: string }, taken: string[] = []): number[] =>
    [
      ...new Set(
        Object.keys(trueMapping(data))
          .filter((cipher) => !taken.includes(cipher))
          .map((cipher) => occurrencesIn(data.ciphertext, cipher)),
      ),
    ].sort((left, right) => left - right)

  const TIERED_BOARDS: [string, { answer: string; ciphertext: string }][] = [
    ['the fixture phrase', DATA],
    ['a two-tier phrase', TIERED],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES')],
    ['a near-pangram', cryptogramOf('THE QUICK BROWN FOX JUMPS OVER')],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT')],
    ['a flat frequency table', cryptogramOf('DUMB WAX FLIGHT')],
  ]

  // `tiers[1] ?? tiers[0]` IS THE RULE AND NOT A CONVENIENCE. A board whose letters all appear the
  // same number of times has one tier and no second one to reach for, and the only honest answer
  // there is the tier it has.
  it.each(TIERED_BOARDS)('opens on the second-rarest frequency on %s', (_case, data) => {
    const first = chooseCryptogramRung(data, fresh, [], fixedDraw) as { cipher: string }
    const tiers = tiersOf(data)

    expect(occurrencesIn(data.ciphertext, first.cipher)).toBe(tiers[1] ?? tiers[0])
  })

  // MEASURED AGAINST THE POOL AS IT STANDS AFTER RUNG 1, which is what "form the next pool" means:
  // rung 1's letter is out, and rung 2 takes the most frequent of what is left. On a two-tier board
  // that is the same count rung 1 opened, which is the honest answer rather than a step down to a
  // rarer letter for the sake of a rising number.
  it.each(TIERED_BOARDS)('follows with the most frequent letter left on %s', (_case, data) => {
    const first = chooseCryptogramRung(data, fresh, [], fixedDraw) as { cipher: string }
    const second = chooseCryptogramRung(data, fresh, [first as CryptogramSpentRung], fixedDraw) as { cipher: string }
    const tiers = tiersOf(data, [first.cipher])

    expect(occurrencesIn(data.ciphertext, second.cipher)).toBe(tiers[tiers.length - 1])
  })

  /*
   * THE DRAW WITHIN THE TIER. Every letter of a tier opens the same number of squares, so which one
   * a rung names is not a question of merit -- and taking the first of the tier made the ladder open
   * on the alphabetically earliest letter of it EVERY DAY, which is a pattern a regular player can
   * learn and then read off a board they have not solved.
   *
   * WHAT THE DRAW MUST NOT DO IS LEAVE THE TIER, and that is the first row: the frequency is the
   * rule and the member is the coin toss. The rest pin the seeding -- one seed, one sequence, so the
   * speculative tail is stable across renders and the rung a player SEES is the rung they BUY.
   */
  describe('the draw', () => {
    // The cipher letters of DATA appearing twice are B, E and Y, which is the second-rarest tier.
    it.each<[string, () => number]>([
      ['a draw of 0', fixedDraw],
      ['a draw just under 1', lastDraw],
      ['a draw of exactly 1, which indexes past the end', () => 1],
    ])('names a letter of the second-rarest tier on %s', (_case, random) => {
      const rung = chooseCryptogramRung(DATA, fresh, [], random) as { cipher: string }

      expect(occurrencesIn(DATA.ciphertext, rung.cipher)).toBe(2)
    })

    it('reaches both ends of the tier', () => {
      expect((chooseCryptogramRung(DATA, fresh, [], fixedDraw) as { cipher: string }).cipher).toBe('B')
      expect((chooseCryptogramRung(DATA, fresh, [], lastDraw) as { cipher: string }).cipher).toBe('Y')
    })

    // ONE SEED, ONE SEQUENCE. This is what makes the tail stable: the adapter builds the generator
    // fresh from the puzzle id on every fold, so two renders of one board choose the same letter.
    it('draws the same rung twice from one seed', () => {
      const seed = '2026-08-18:cryptogram:7c6b5a49'

      expect(chooseCryptogramRung(DATA, fresh, [], seededRandom(seed))).toStrictEqual(
        chooseCryptogramRung(DATA, fresh, [], seededRandom(seed)),
      )
    })

    // AND A DIFFERENT SEED IS ALLOWED TO DIFFER, which is the whole point of drawing at all. Stated
    // over a run of ids as "more than one letter comes up" rather than as a pinned letter per id: the
    // property is that the opening rung is not one letter forever, and pinning the generator's output
    // would be a second copy of the generator.
    it('does not open on one letter across a run of puzzle ids', () => {
      const ids = ['01', '02', '03', '04', '05', '06', '07'].map((day) => `2026-08-${day}:cryptogram:7c6b5a49`)
      const opened = ids.map(
        (id) => (chooseCryptogramRung(DATA, fresh, [], seededRandom(id)) as { cipher: string }).cipher,
      )

      expect(new Set(opened).size).toBeGreaterThan(1)
    })
  })

  // THE WHOLE LADDER ON THE TWO-TIER BOARD, spelled out. A and E both appear twice, so rung 1 takes
  // one of them and rung 2 takes the other -- the two rungs a player can actually use -- and the
  // three single-square letters are what the word rung is left to hand over.
  it('opens a two-tier board on its repeated letters', () => {
    expect(foldTexts(TIERED)).toStrictEqual(['Every N is an A.', 'Every R is an E.', 'One of the words is DEAL.'])
  })

  // THE STRICT COMPARISON IS THE POINT wherever the board has three tiers to climb: rung 1 sits on
  // the second-rarest count and rung 2 on the highest, so the second rung opens strictly more
  // squares. Every row below has at least three distinct counts; the two-tier and flat boards are
  // covered by the tier rows above, where equal is the correct answer.
  it.each([
    ['the fixture phrase', DATA],
    ['a corpus-shaped phrase', cryptogramOf('THE EARLY BIRD CATCHES')],
    // Twenty distinct letters is MAX_UNIQUE in cryptogram/difficulty.ts, and sixteen of them appear
    // once -- the skew that flattened the plain percentile, which read those sixteen as sixteen
    // positions rather than as one tier. Counted as tiers this board has three, and the ladder climbs
    // all three.
    ['a near-pangram', cryptogramOf('THE QUICK BROWN FOX JUMPS OVER')],
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT')],
  ])('opens more squares with rung 2 than with rung 1 on %s', (_case, data) => {
    const first = chooseCryptogramRung(data, fresh, [], fixedDraw) as { cipher: string }
    const second = chooseCryptogramRung(data, fresh, [first as CryptogramSpentRung], fixedDraw) as { cipher: string }
    expect(occurrencesIn(data.ciphertext, second.cipher)).toBeGreaterThan(occurrencesIn(data.ciphertext, first.cipher))
  })

  // DUMB WAX FLIGHT is thirteen letters, all distinct -- inside MIN_LETTERS 12 and MAX_UNIQUE 20, so
  // the generator can produce it. Every count is 1, so the pool is ONE tier: there is no second tier
  // for rung 1 to prefer and no higher one for rung 2 to climb to.
  const FLAT = cryptogramOf('DUMB WAX FLIGHT')

  it('still escalates weakly when every letter appears exactly once', () => {
    const first = chooseCryptogramRung(FLAT, fresh, [], fixedDraw) as { cipher: string }
    const second = chooseCryptogramRung(FLAT, fresh, [first as CryptogramSpentRung], fixedDraw) as { cipher: string }
    expect(occurrencesIn(FLAT.ciphertext, second.cipher)).toBeGreaterThanOrEqual(
      occurrencesIn(FLAT.ciphertext, first.cipher),
    )
  })

  it('takes the highest-count candidate when the pool is one flat tier', () => {
    const first = chooseCryptogramRung(FLAT, fresh, [], fixedDraw) as { cipher: string }
    const second = chooseCryptogramRung(FLAT, fresh, [first as CryptogramSpentRung], fixedDraw) as { cipher: string }
    const highest = Math.max(
      ...Object.keys(trueMapping(FLAT))
        .filter((cipher) => cipher !== first.cipher)
        .map((cipher) => occurrencesIn(FLAT.ciphertext, cipher)),
    )
    expect(occurrencesIn(FLAT.ciphertext, second.cipher)).toBe(highest)
  })

  // Stored progress is untrusted, so `spent` can name a cipher letter that is not in this puzzle at
  // all. It joins no tier and removes nothing from the pool, so rung 2 is still chosen over the real
  // board -- and it is the real board's highest tier that answers.
  it('ignores a spent rung naming a letter the puzzle does not hold', () => {
    const spent: CryptogramSpentRung[] = [{ cipher: 'V', kind: 'letter' }]
    const rung = chooseCryptogramRung(DATA, fresh, spent, fixedDraw) as { cipher: string }
    const highest = Math.max(...Object.keys(trueMapping(DATA)).map((cipher) => occurrencesIn(DATA.ciphertext, cipher)))

    expect(occurrencesIn(DATA.ciphertext, rung.cipher)).toBe(highest)
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
    expect(chooseCryptogramRung(DATA, almost, spent, fixedDraw)).toBeNull()
  })

  // THE TWO BOARDS THAT SHIPPED A RUNG WORTH NOTHING, kept as fixtures because they are the exact
  // ones a review found rather than corners invented afterwards. What they defend is the WORD count:
  // it asks "does this word hold a cipher letter the player neither has right nor has been given",
  // and a word that holds none of those is never sold. The ladders below moved when the letter pools
  // became frequency tiers, and the property they are here for did not.
  //
  // Under rot13 the four cipher letters this player does not hold are A, E, N and O -- counts 2, 2, 2
  // and 1. So the second-rarest tier is 2, rung 1 takes A and rung 2 takes E, and the three words
  // still worth anything each hold exactly ONE new cipher letter: BETTER holds O, LATE and THAN hold
  // N. That is a three-way tie on distinct letters, and it is the SQUARES that separate them -- N
  // opens two and O opens one -- so the ladder closes on LATE, the earlier of the two words worth
  // twice what BETTER is worth.
  it('never closes on a word made only of letters the ladder has already given away', () => {
    const data = cryptogramOf('BETTER LATE THAN NEVER')

    expect(foldTexts(data, holdingAllBut(data, ['A', 'E', 'N', 'O']).mapping)).toStrictEqual([
      'Every A is an N.',
      'Every E is an R.',
      'One of the words is LATE.',
    ])
  })

  // THE TIE-BREAK ON ITS OWN, over boards built for it rather than read off an endgame. Both rows
  // spend the two letter rungs on the third word, so the word block is reached with the first two
  // words untouched.
  //
  // `AB` and `CDD` each hand over two new cipher letters, and `CDD` opens three squares to `AB`'s
  // two -- so the LATER word wins on cells. Position breaks a tie only when the squares tie as well,
  // which is the row below.
  it('breaks a tie on distinct letters by the squares the word opens', () => {
    const data = cryptogramOf('AB CDD EF')
    const spent: CryptogramSpentRung[] = [
      { cipher: rot13('E'), kind: 'letter' },
      { cipher: rot13('F'), kind: 'letter' },
    ]

    expect(chooseCryptogramRung(data, fresh, spent, fixedDraw)).toStrictEqual({ index: 1, kind: 'word' })
  })

  it('breaks a tie on both counts by taking the earlier word', () => {
    const data = cryptogramOf('AB CD EF')
    const spent: CryptogramSpentRung[] = [
      { cipher: rot13('E'), kind: 'letter' },
      { cipher: rot13('F'), kind: 'letter' },
    ]

    expect(chooseCryptogramRung(data, fresh, spent, fixedDraw)).toStrictEqual({ index: 0, kind: 'word' })
  })

  // THE SAME DEFECT ON A FRESH BOARD, which is why it is not a corner. The ciphers here count 4 for
  // G, 2 for A, N, E and O, and 1 for I, S and T, so rung 1 takes the second-rarest tier and rung 2
  // takes the 4. `AN` and `EGG` are then made entirely of letters the two rungs handed over. `IS` and
  // `TOO` both hand over two new cipher letters, and the squares separate them: TOO opens three to
  // IS's two.
  it('never closes on a word one of whose two letters an earlier rung revealed', () => {
    const data = cryptogramOf('AN EGG IS AN EGG TOO')

    expect(foldTexts(data)).toStrictEqual(['Every A is an N.', 'Every T is a G.', 'One of the words is TOO.'])
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
    expect(chooseCryptogramRung(DATA, fresh, spent, fixedDraw)).toBeNull()
  })

  it('never picks the same letter twice', () => {
    const first = chooseCryptogramRung(DATA, fresh, [], fixedDraw) as { cipher: string }
    const second = chooseCryptogramRung(DATA, fresh, [first as CryptogramSpentRung], fixedDraw) as { cipher: string }
    expect(second.cipher).not.toBe(first.cipher)
  })

  it('skips a letter the player already has right', () => {
    const first = chooseCryptogramRung(DATA, fresh, [], fixedDraw) as { cipher: string }
    const solved = { mapping: { [first.cipher]: trueMapping(DATA)[first.cipher] } }
    expect((chooseCryptogramRung(DATA, solved, [], fixedDraw) as { cipher: string }).cipher).not.toBe(first.cipher)
  })

  it('still offers a letter the player has mapped WRONGLY', () => {
    const first = chooseCryptogramRung(DATA, fresh, [], fixedDraw) as { cipher: string }
    const wrong = { mapping: { [first.cipher]: 'Z' } }
    expect((chooseCryptogramRung(DATA, wrong, [], fixedDraw) as { cipher: string }).cipher).toBe(first.cipher)
  })

  it('offers no letter rung when every letter is already correct', () => {
    expect(chooseCryptogramRung(DATA, { mapping: trueMapping(DATA) }, [], fixedDraw)).toBeNull()
  })

  it('offers no word rung when every word is already solved', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    expect(chooseCryptogramRung(DATA, { mapping: trueMapping(DATA) }, spent, fixedDraw)).toBeNull()
  })

  it('picks the word with the most unsolved DISTINCT cipher letters', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    // QYRXH holds five distinct cipher letters; BEEUZ is the same five cells but only four distinct.
    // The rung is chosen by what it LOCKS, never by which word reads better.
    expect(chooseCryptogramRung(DATA, fresh, spent, fixedDraw)).toStrictEqual({ index: 1, kind: 'word' })
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
    expect(chooseCryptogramRung(data, fresh, spent, fixedDraw)).toStrictEqual({ index: 1, kind: 'word' })
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
    // THE ENDGAME THAT SHIPPED THE EMPTY RUNG. Rungs 1 and 2 take the two-count letters; the word
    // made of them and two letters this player already holds used to be rung 3, worth nothing.
    ['the endgame that sold a rung worth nothing', REPEATED, holdingAllBut(REPEATED, ['A', 'E', 'N', 'O']).mapping],
    [
      'a half-solved corpus phrase',
      cryptogramOf('THE EARLY BIRD CATCHES'),
      holdingAllBut(cryptogramOf('THE EARLY BIRD CATCHES'), ['G', 'U', 'R', 'F', 'O']).mapping,
    ],
  ]

  /*
   * THE LADDER CLIMBS ON MOST BOARDS AND NOT ON ALL OF THEM, AND THIS BLOCK SAYS WHICH -- because
   * "rung 2 opens the most squares available" and "rung 2 opens more squares than rung 1" are the
   * same sentence only while a stronger letter is still there to take. Rung 1 now stands on the
   * SECOND-RAREST frequency tier rather than on the rarest, which is what makes it a rung worth
   * buying, and it is also what puts it within reach of the top of the pool.
   *
   * Three shapes stop the climb, and all three are the same fact seen from different sides:
   *
   *   * THE TOP TIER HOLDS ONE LETTER AND RUNG 1 IS STANDING ON IT. Two cipher letters left, counts 2
   *     and 1: rung 1 takes the 2 and there is nothing above it, so rung 2 takes the 1.
   *   * RUNG 2 TAKES THE HEAVY LETTER AND LEAVES THE WORDS THIN. On MISSISSIPPI RIVER BOAT rung 2
   *     opens the five I squares, and the best word left is four one-count letters.
   *   * BOTH AT ONCE, on a phrase of two- and three-letter words.
   *
   * The old ladder climbed on all ten by opening on the RAREST letter every time -- a rung worth one
   * square out of twenty, which is a number rising from a floor nobody wanted. So the monotone rows
   * are split rather than deleted: the boards that climb still assert that they climb, and the ones
   * that do not have their yields written out, so a change to this rule has to move a fixture on
   * purpose rather than quietly flatten one more board.
   */
  const CLIMBS = [
    'a fresh board',
    'a corpus-shaped phrase',
    'a flat frequency table',
    'a phrase whose words share letters',
    'a board with one cipher letter left',
    'the endgame that sold a rung worth nothing',
    'a half-solved corpus phrase',
  ]
  const CLIMBING_BOARDS = BOARDS.filter(([name]) => CLIMBS.includes(name))

  // NO LADDER OPENS WITH ITS STRONGEST RUNG, and the giveaway is last. Stated as a property over the
  // yields rather than as an order over the kinds -- an assertion that rung 3 is `word` passes
  // whatever the rungs are worth, and it is the shape that let a letter rung ship AFTER the word one.
  it.each(CLIMBING_BOARDS)('opens with a weakest rung and closes with a strongest on %s', (_case, data, mapping) => {
    const yields = netYields(data, mapping)

    expect(yields[0]).toBe(Math.min(...yields))
    expect(yields[yields.length - 1]).toBe(Math.max(...yields))
  })

  it.each(CLIMBING_BOARDS)('never steps back down the ladder on %s', (_case, data, mapping) => {
    const yields = netYields(data, mapping)

    expect(yields.filter((count, index) => index > 0 && count < yields[index - 1])).toStrictEqual([])
  })

  // THE THREE THAT DO NOT CLIMB, PRICED IN SQUARES. Every one of these rungs is still worth
  // something -- that is the row below, and it holds over all ten boards -- so what is written out
  // here is a ladder that pays well and out of order, not one with a hole in it.
  it.each<[string, { answer: string; ciphertext: string }, Record<string, string>, number[]]>([
    ['heavy repetition', cryptogramOf('MISSISSIPPI RIVER BOAT'), {}, [2, 5, 4]],
    ['a short-worded phrase', cryptogramOf('AN EGG IS AN EGG TOO'), {}, [2, 4, 3]],
    ['a board with two cipher letters left', DATA, holdingAllBut(DATA, ['G', 'B']).mapping, [2, 1]],
  ])('pays out of order but never for nothing on %s', (_case, data, mapping, expected) => {
    expect(netYields(data, mapping)).toStrictEqual(expected)
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

  // RUNG 2 TAKES THE MOST THE POOL HAS, EXACTLY, and this is the row that pins the second half of the
  // rule over every board rather than over the fresh ones the chooser's own block sweeps. It used to
  // read "strictly more than rung 1, OR the best available", and the first clause is now redundant:
  // there is no board on which rung 2 settles for less than the best, because the best is what it is
  // defined to take. Dropping the clause is what makes this row fail on a chooser that hands rung 2
  // anything but the top tier -- with the disjunction in place, a chooser that took the RAREST
  // surviving letter still passed on any board where that letter happened to beat rung 1.
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

      return taken === best ? [] : [`rung 2 opened ${taken} of an available ${best}, after ${opened}`]
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
    expect(() => chooseCryptogramRung(broken, fresh, [], fixedDraw)).not.toThrow()
    expect(() => cryptogramHintFor(broken, { cipher: 'Q', kind: 'letter' })).not.toThrow()
    expect(() => cryptogramHintFor(broken, { index: 9, kind: 'word' })).not.toThrow()
  })

  it('offers nothing on an empty puzzle', () => {
    expect(chooseCryptogramRung({ answer: '', ciphertext: '' }, fresh, [], fixedDraw)).toBeNull()
  })
})
