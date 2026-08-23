import { knownWords } from '@generators/crypticclue/data/known-words'
import { chargedTerms } from '@utils/charged-terms'

// THE PRECISION HALF of this asset's correctness: nothing in this file can prove an entry is wrongly
// MISSING, because a missing entry is by definition not in the list. That is the CI `--check`
// re-derivation's job, and the two are not interchangeable.
//
// From the build script, RESTATED rather than imported: this suite is the independent reader, and a
// bound imported from the thing it is checking is a bound that moves when the producer moves.
const MIN_LENGTH = 2
const MAX_LENGTH = 12
const MIN_ENTRIES = 100_000

describe('knownWords', () => {
  it('holds only lowercase a-z entries in the 2-12 band', () => {
    const wrong = knownWords.filter(
      (word) => !/^[a-z]+$/.test(word) || word.length < MIN_LENGTH || word.length > MAX_LENGTH,
    )

    expect(wrong).toStrictEqual([])
  })

  it('holds no duplicates', () => {
    expect(new Set(knownWords).size).toEqual(knownWords.length)
  })

  // chargedTerms, NOT the vendored chargedWords. The vendored list is 21 singular base forms and
  // this filter is exact-token, so on chargedWords alone every inflection would survive -- the exact
  // gap that put a slur on a board once already.
  it('holds no charged term', () => {
    const charged = new Set([...chargedTerms].map((term) => term.toLowerCase()))

    expect(knownWords.filter((word) => charged.has(word))).toStrictEqual([])
  })

  it('is sorted, so a regeneration is a reviewable diff', () => {
    expect(knownWords).toStrictEqual([...knownWords].sort())
  })

  it('is large enough to be an oracle rather than a sample', () => {
    expect(knownWords.length).toBeGreaterThanOrEqual(MIN_ENTRIES)
  })

  // The golden set, in BOTH directions, because a list that lost half its entries still passes every
  // property above. The members are the fodder tokens this type's own fixtures use; the non-members
  // are the three shapes the band and the charset exclude.
  it.each(['angora', 'instant', 'tangos', 'dance', 'shaken', 'of', 'the', 'an'])('knows %s', (word) => {
    expect(knownWords).toContain(word)
  })

  it.each([
    ['zqxjangora', 'is not a word'],
    ['a', 'is one letter, below the 2-letter floor'],
    ['angorax', 'is not a word'],
    ['bastard', 'is a charged term'],
  ])('does not know %s, which %s', (word) => {
    expect(knownWords).not.toContain(word)
  })
})
