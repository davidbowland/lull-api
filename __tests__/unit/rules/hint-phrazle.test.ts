import {
  choosePhrazleRung,
  MAX_PHRAZLE_RUNG_LENGTH,
  phrazleHintFor,
  PhrazleSpentRung,
  seededRandom,
} from '@rules/hint-phrazle'

// RESTATED, NOT IMPORTED, and that is a portability constraint rather than a preference. This file
// is copied byte-identical into lull-ui, which has no generators to import from, so
// `@generators/phrazle/difficulty` here would resolve in one repo and take the whole suite down in
// the other. The number is generators/phrazle/difficulty.ts's MAX_WORD_LETTERS.
//
// THE RESTATEMENT CANNOT DRIFT SILENTLY: hint-sweep.test.ts pins this value against the generator's
// own constant, and that file deliberately does NOT travel to lull-ui, so the cross-check lives in
// the one repo that can perform it.
const MAX_WORD_LETTERS = 11

// TOE HOLD. Present letters: T, O, E, H, L, D. Absent: everything else.
const DATA = { answer: 'TOE HOLD' }
const fresh = { guesses: [] }

// A fixed source so no test body calls Math.random. Cycles through a short list, which is enough to
// make the pick deterministic without pinning the shuffle's internals.
const fixedRandom = (): (() => number) => {
  let index = 0
  const values = [0.1, 0.4, 0.7, 0.2, 0.9, 0.5]
  return () => values[index++ % values.length]
}

describe('choosePhrazleRung', () => {
  it('opens with three letters that are absent from the phrase', () => {
    const rung = choosePhrazleRung(DATA, fresh, [], fixedRandom()) as { kind: string; letters: string }
    expect(rung.kind).toBe('absent')
    expect(rung.letters).toHaveLength(3)
    expect([...rung.letters].some((letter) => 'TOEHLD'.includes(letter))).toBe(false)
  })

  it('draws rung 1 only from common letters', () => {
    const rung = choosePhrazleRung(DATA, fresh, [], fixedRandom()) as { letters: string }
    // The ten strongest absent letters for TOE HOLD are A, R, I, N, S, C, U, P, M and G; J, Q, X and
    // Z are the four weakest in the table and can never reach that window.
    expect([...rung.letters].some((letter) => 'JQXZ'.includes(letter))).toBe(false)
  })

  it('follows with three letters that are present', () => {
    const spent: PhrazleSpentRung[] = [{ kind: 'absent', letters: 'AIR' }]
    const rung = choosePhrazleRung(DATA, fresh, spent, fixedRandom()) as { kind: string; letters: string }
    expect(rung.kind).toBe('present')
    expect([...rung.letters].every((letter) => 'TOEHLD'.includes(letter))).toBe(true)
  })

  it('picks the RAREST present letters for rung 2', () => {
    const spent: PhrazleSpentRung[] = [{ kind: 'absent', letters: 'AIR' }]
    const rung = choosePhrazleRung(DATA, fresh, spent, fixedRandom()) as { letters: string }
    // Of T O E H L D, the three weakest by the strength table are H, D and L, recorded alphabetized.
    expect([...rung.letters].sort().join('')).toBe('DHL')
  })

  it('closes with a word rung', () => {
    const spent: PhrazleSpentRung[] = [
      { kind: 'absent', letters: 'AIR' },
      { kind: 'present', letters: 'DHL' },
    ]
    expect(choosePhrazleRung(DATA, fresh, spent, fixedRandom())?.kind).toBe('word')
  })

  it('offers nothing beyond three rungs', () => {
    const spent: PhrazleSpentRung[] = [
      { kind: 'absent', letters: 'AIR' },
      { kind: 'present', letters: 'DHL' },
      { index: 0, kind: 'word' },
    ]
    expect(choosePhrazleRung(DATA, fresh, spent, fixedRandom())).toBeNull()
  })

  it('skips absent letters the player has already ruled out', () => {
    // Guessing SIR proves S, I and R are absent, so rung 1 must not spend itself on them.
    const played = { guesses: ['SIR RAIN'] }
    const rung = choosePhrazleRung(DATA, played, [], fixedRandom()) as { letters: string }
    expect([...rung.letters].some((letter) => 'SIRAN'.includes(letter))).toBe(false)
  })

  it('skips present letters the player has already seen colored', () => {
    const played = { guesses: ['DOE HOLD'] }
    const spent: PhrazleSpentRung[] = [{ kind: 'absent', letters: 'AIR' }]
    const rung = choosePhrazleRung(DATA, played, spent, fixedRandom()) as { letters: string }
    expect([...rung.letters].some((letter) => 'DOEHL'.includes(letter))).toBe(false)
  })

  // A BARREN POOL SKIPS A KIND, IT DOES NOT END THE LADDER. Rung 2's pool is the present letters the
  // player has not met, and a single guess touching all six empties it -- which under a positional
  // ladder killed the word rung too, permanently, for the one player it still helps.
  it('skips the present rung to the word rung when every present letter is known', () => {
    // DOT HELL touches T, O, E, H, L and D, which is every letter of TOE HOLD.
    const played = { guesses: ['DOT HELL'] }
    const spent: PhrazleSpentRung[] = [{ kind: 'absent', letters: 'AIR' }]
    expect(choosePhrazleRung(DATA, played, spent, fixedRandom())?.kind).toBe('word')
  })

  it('still reaches the word rung after the absent pool is skipped', () => {
    const played = { guesses: ['DOT HELL'] }
    const spent: PhrazleSpentRung[] = [
      { kind: 'absent', letters: 'AIR' },
      { index: 0, kind: 'word' },
    ]
    expect(choosePhrazleRung(DATA, played, spent, fixedRandom())).toBeNull()
  })

  it('uses each kind at most once', () => {
    const spent: PhrazleSpentRung[] = [{ index: 0, kind: 'word' }]
    const rung = choosePhrazleRung(DATA, fresh, spent, fixedRandom()) as PhrazleSpentRung
    expect(rung.kind).toBe('absent')
  })

  it('offers nothing when no kind has anything left', () => {
    // Every word is a single letter the player has already met, so the word rung is all that is left
    // -- and once it is spent alongside the other two, nothing is.
    const spent: PhrazleSpentRung[] = [
      { kind: 'absent', letters: 'AIR' },
      { kind: 'present', letters: 'DHL' },
      { index: 0, kind: 'word' },
    ]
    expect(choosePhrazleRung(DATA, { guesses: ['DOT HELL'] }, spent, fixedRandom())).toBeNull()
  })
})

describe('seededRandom', () => {
  it('is deterministic for one seed', () => {
    const left = seededRandom('2026-08-31:phrazle:abcd1234')
    const right = seededRandom('2026-08-31:phrazle:abcd1234')
    expect([left(), left(), left()]).toStrictEqual([right(), right(), right()])
  })

  it('differs between seeds', () => {
    expect(seededRandom('one')()).not.toBe(seededRandom('two')())
  })

  it('stays inside the unit interval', () => {
    const random = seededRandom('seed')
    const drawn = Array.from({ length: 50 }, () => random())
    expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true)
  })
})

describe('phrazleHintFor', () => {
  it('names the absent letters', () => {
    expect(phrazleHintFor(DATA, { kind: 'absent', letters: 'AIR' }).text).toBe('The phrase has no A, no I, and no R.')
  })

  it('names the present letters', () => {
    expect(phrazleHintFor(DATA, { kind: 'present', letters: 'DHL' }).text).toBe('The phrase contains D, H, and L.')
  })

  it('gives one word its letters, alphabetized', () => {
    expect(phrazleHintFor(DATA, { index: 1, kind: 'word' }).text).toBe(
      'Word 2 uses these letters, alphabetized: D, H, L, and O.',
    )
  })

  it('says the order is alphabetical, so the list cannot be read as the spelling', () => {
    expect(phrazleHintFor(DATA, { index: 1, kind: 'word' }).text).toContain('alphabetized')
  })

  it('lists a repeated letter once per occurrence', () => {
    expect(phrazleHintFor({ answer: 'BANANA STAND' }, { index: 0, kind: 'word' }).text).toBe(
      'Word 1 uses these letters, alphabetized: A, A, A, B, N, and N.',
    )
  })

  it('numbers the word from one', () => {
    expect(phrazleHintFor(DATA, { index: 0, kind: 'word' }).text).toMatch(/^Word 1\b/)
  })

  // "A and B", never "A, and B". The serial comma joins a list of three or more; on two items it is
  // a comma splice, and lull-ui's own utils/hints.ts joiner has always got this right.
  it.each([
    ['absent', DATA, { kind: 'absent', letters: 'AI' } as PhrazleSpentRung, 'The phrase has no A and no I.'],
    ['present', DATA, { kind: 'present', letters: 'DH' } as PhrazleSpentRung, 'The phrase contains D and H.'],
    [
      'word',
      { answer: 'AT ONE' },
      { index: 0, kind: 'word' } as PhrazleSpentRung,
      'Word 1 uses these letters, alphabetized: A and T.',
    ],
  ])('joins a two-item %s list with "and" and no comma', (_kind, data, rung, expected) => {
    expect(phrazleHintFor(data, rung).text).toBe(expected)
  })

  it('replays a frozen rung as one fixed sentence', () => {
    expect(phrazleHintFor(DATA, { kind: 'absent', letters: 'AIR' }).text).toBe('The phrase has no A, no I, and no R.')
  })

  it('never states the phrase length or a word length', () => {
    const rungs: PhrazleSpentRung[] = [
      { kind: 'absent', letters: 'AIR' },
      { kind: 'present', letters: 'DHL' },
      { index: 0, kind: 'word' },
    ]
    rungs.forEach((rung) =>
      expect(phrazleHintFor(DATA, rung).text).not.toMatch(/\b(three|four|five|six|seven|eight|letters long)\b/i),
    )
  })

  // MAX_WORD_LETTERS in generators/phrazle/difficulty.ts is 11, so an eleven-letter word is the
  // longest word sentence a legal Phrazle can produce. Imported rather than restated so the row
  // moves if the structural floor does -- and it is asserted against the fixture, because a row
  // claiming to test the ceiling while standing well below it is worse than no row at all.
  //
  // THREE CHARACTERS OF HEADROOM, so this is a real ceiling and not a formality: 77 against a cap of
  // 80. The exact string is pinned beside the length for the same reason.
  it('stays within the cap on the longest legal word', () => {
    const longest = { answer: 'OUTSTANDING WORK' }
    const text = phrazleHintFor(longest, { index: 0, kind: 'word' }).text
    expect('OUTSTANDING'.length).toBe(MAX_WORD_LETTERS)
    expect(text).toBe('Word 1 uses these letters, alphabetized: A, D, G, I, N, N, O, S, T, T, and U.')
    expect(text).toHaveLength(77)
    expect(text.length).toBeLessThanOrEqual(MAX_PHRAZLE_RUNG_LENGTH)
  })
})

describe('totality', () => {
  it('never throws, however malformed the input', () => {
    const broken = { answer: '' }
    expect(() => choosePhrazleRung(broken, fresh, [], fixedRandom())).not.toThrow()
    expect(() => phrazleHintFor(broken, { index: 9, kind: 'word' })).not.toThrow()
    expect(() => phrazleHintFor(broken, { kind: 'absent', letters: '' })).not.toThrow()
  })
})
