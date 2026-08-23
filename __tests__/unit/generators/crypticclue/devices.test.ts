import { devicePredicates, foldWithOffsets } from '@generators/crypticclue/verify'

describe('foldWithOffsets', () => {
  // THE property: every offset it returns indexes the raw character it folded. This is what makes
  // the hidden clauses implementable at all -- the first version indexed a raw slice with an offset
  // taken from a normalized one, and no such offset existed.
  it.each(['instant angora', 'a b c', 'Dance', 'instant angora of the'])('indexes what it folded: %s', (raw) => {
    const { folded, rawAt } = foldWithOffsets(raw)

    expect(rawAt).toHaveLength(folded.length)
    expect(rawAt.map((offset) => raw[offset].toUpperCase()).join('')).toEqual(folded)
  })

  // And it agrees with the fold every other part of this repo uses. normalizeAnswer is what the
  // player's typing is judged by, so a fold that disagreed with it would prove the wrong thing.
  it.each(['instant angora', 'Dance hidden in instant angora'])('agrees with normalizeAnswer on %s', (raw) => {
    expect(foldWithOffsets(raw).folded).toEqual(raw.toUpperCase().replace(/[^A-Z]/g, ''))
  })
})

describe('devicePredicates.hidden', () => {
  it('accepts the catalog worked example', () => {
    expect(devicePredicates.hidden('instant angora', 'TANGO')).toBe(true)
  })

  it.each([
    ['a run inside one token', 'tangos', 'TANGO'],
    ['a run starting at the first letter of the first fodder token', 'tangoing hats', 'TANGO'],
    ['a run ending at the last letter of the last fodder token', 'instant tango', 'TANGO'],
    ['a fodder padded with trailing connective words', 'instant angora of the', 'TANGO'],
    ['a fodder that IS the answer', 'tango', 'TANGO'],
    ['two occurrences of the answer', 'instant angora instant angora', 'TANGO'],
    ['a run that crosses no word break', 'a tango here', 'TANGO'],
    ['a fodder that does not contain the answer at all', 'instant zqxjangora', 'TANGO'],
  ])('rejects %s', (_description, fodder, answer) => {
    expect(devicePredicates.hidden(fodder, answer)).toBe(false)
  })
})

describe('devicePredicates.anagram', () => {
  it('accepts a true anagram across a word break', () => {
    expect(devicePredicates.anagram('got an', 'TANGO')).toBe(true)
  })

  it.each([
    ['the identity', 'tango', 'TANGO'],
    ['a length mismatch', 'got and', 'TANGO'],
    ['a one-letter-off near miss', 'got at', 'TANGO'],
  ])('rejects %s', (_description, fodder, answer) => {
    expect(devicePredicates.anagram(fodder, answer)).toBe(false)
  })

  // The device bounds itself: multiset equality forces every fodder letter to be consumed by the
  // answer, so a padding connective can only appear in an anagram fodder if its letters are the
  // answer's. That is why there is no boundary clause here and no fodder cap.
  it('cannot be padded with a connective, because the letters would have to come from the answer', () => {
    expect(devicePredicates.anagram('got an of', 'TANGO')).toBe(false)
  })
})
