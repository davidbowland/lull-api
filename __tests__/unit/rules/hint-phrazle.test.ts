import {
  choosePhrazleRung,
  MAX_PHRAZLE_RUNG_LENGTH,
  phrazleHintFor,
  PhrazleSpentRung,
  seededRandom,
} from '@rules/hint-phrazle'

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

  it('offers no present rung when every present letter is known', () => {
    const played = { guesses: ['TOE HOLD'] }
    const spent: PhrazleSpentRung[] = [{ kind: 'absent', letters: 'AIR' }]
    expect(choosePhrazleRung(DATA, played, spent, fixedRandom())).toBeNull()
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
      'Word 2 is made from the letters D, H, L, and O.',
    )
  })

  it('numbers the word from one', () => {
    expect(phrazleHintFor(DATA, { index: 0, kind: 'word' }).text).toMatch(/^Word 1\b/)
  })

  it('replays a frozen rung identically whatever the player has since learned', () => {
    const rung: PhrazleSpentRung = { kind: 'absent', letters: 'AIR' }
    expect(phrazleHintFor(DATA, rung)).toStrictEqual(phrazleHintFor(DATA, rung))
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

  it('stays within the cap on a long word', () => {
    const long = { answer: 'EXTRAORDINARY THING' }
    expect(phrazleHintFor(long, { index: 0, kind: 'word' }).text.length).toBeLessThanOrEqual(MAX_PHRAZLE_RUNG_LENGTH)
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
