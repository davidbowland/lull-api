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

  it('picks a rarer letter for rung 1 than for rung 2', () => {
    const counts = (letter: string): number => DATA.ciphertext.split(letter).length - 1
    const first = chooseCryptogramRung(DATA, fresh, []) as { cipher: string }
    const second = chooseCryptogramRung(DATA, fresh, [first as CryptogramSpentRung]) as { cipher: string }
    expect(counts(first.cipher)).toBeLessThanOrEqual(counts(second.cipher))
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

  it('picks the word with the most unsolved cells', () => {
    const spent: CryptogramSpentRung[] = [
      { cipher: 'G', kind: 'letter' },
      { cipher: 'R', kind: 'letter' },
    ]
    // QYRXH and BEEUZ are both five cells, the longest words in the ciphertext, and on a fresh board
    // every cell of both is unsolved. The tie breaks to the earlier word, so this is FLIES rather
    // than ARROW -- the rung is chosen by cell count and position, never by which word reads better.
    expect(chooseCryptogramRung(DATA, fresh, spent)).toStrictEqual({ index: 1, kind: 'word' })
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

  it('replays a frozen rung identically whatever the player has since learned', () => {
    const rung: CryptogramSpentRung = { cipher: 'G', kind: 'letter' }
    expect(cryptogramHintFor(DATA, rung)).toStrictEqual(cryptogramHintFor(DATA, rung))
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
