import { sortedLetters } from '@generators/themedanagrams/letters'

describe('sortedLetters', () => {
  it('keys a word on its letters in order', () => {
    expect(sortedLetters('KETTLE')).toEqual('EEKLTT')
  })

  // THE CASE CONTRACT, and it is the reason this function uppercases rather than trusting its
  // caller. The committed list is a-z and every runtime gate in this type runs on toUpperCase(), so
  // a key function that preserved case would put the build script's keys and the generator's keys in
  // disjoint alphabets -- and every lookup would miss, silently, on every word.
  it('gives a word and its uppercase the same key', () => {
    expect(sortedLetters('ginger')).toEqual(sortedLetters('GINGER'))
  })

  // The collision the whole content-safety gate is about, asserted here so the arithmetic behind it
  // is visible in one line rather than only as a consequence three files away.
  it('gives GINGER and NIGGER the same key', () => {
    expect(sortedLetters('GINGER')).toEqual(sortedLetters('NIGGER'))
  })

  it('keys anagrams together and non-anagrams apart', () => {
    expect(sortedLetters('SPATULA')).toEqual(sortedLetters('AUPLATS'))
    expect(sortedLetters('SPATULA')).not.toEqual(sortedLetters('SKILLET'))
  })
})
