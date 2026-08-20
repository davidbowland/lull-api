import { derange } from '@generators/cryptogram/cipher'

// The same seeded Lehmer generator the other generator suites use. Live randomness here would make
// "no fixed point over many runs" a test that passes today and fails on some Tuesday.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

describe('derange', () => {
  const seeds = Array.from({ length: 200 }, (_value, index) => index + 1)

  it.each(seeds)('maps every letter exactly once from seed %i', (seed) => {
    const cipher = derange(seededRandom(seed))

    expect(Object.keys(cipher).sort()).toEqual(ALPHABET)
    expect(new Set(Object.values(cipher)).size).toEqual(ALPHABET.length)
    expect(Object.values(cipher).sort()).toEqual(ALPHABET)
  })

  // A fixed point is a letter that enciphers to itself, and it is a giveaway rather than a
  // curiosity: with nothing pre-filled, one visible identity pair hands the solver a free letter.
  it.each(seeds)('leaves no letter standing on itself from seed %i', (seed) => {
    const cipher = derange(seededRandom(seed))

    expect(Object.entries(cipher).filter(([plain, enciphered]) => plain === enciphered)).toEqual([])
  })

  it('defaults its randomness so the generator can call it with no argument', () => {
    const cipher = derange()

    expect(Object.keys(cipher)).toHaveLength(ALPHABET.length)
  })

  // Rejection sampling with no bound is a Lambda that spins until the 900-second timeout kills it
  // with nothing logged to explain why. A shuffle that keeps returning the identity is exactly what
  // a broken injected source looks like.
  it('throws rather than spinning when the attempt cap is spent', () => {
    // Every Fisher-Yates draw lands on the current index, so no element ever moves and the shuffle
    // returns the identity permutation -- rejected every single attempt.
    const noSwap = () => 0.999999

    expect(() => derange(noSwap)).toThrow('Could not build a derangement of the alphabet')
  })
})
