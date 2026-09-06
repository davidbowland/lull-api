import { uniqueAnagramWords } from '@generators/themedanagrams/data/anagram-words'
import { sortedLetters } from '@generators/themedanagrams/letters'
import { chargedTerms } from '@utils/charged-terms'

// THE PRECISION HALF of the uniqueness argument: nothing in this file can prove that an entry was
// wrongly RETAINED, because the anagram that should have removed it is by definition not in the
// list. That is the CI `--check` re-derivation's job, and the two are not interchangeable.
//
// An asset is checked by proving its contents, not by covering the code that produced them.

// From the build script, restated rather than imported: this suite is the independent reader, and a
// floor imported from the thing it is checking is a floor that moves when the producer moves.
const MIN_WORD_LENGTH = 5
const MAX_WORD_LENGTH = 9
const MIN_WORDS_PER_BAND = 1_000

describe('uniqueAnagramWords', () => {
  it('holds only lowercase a-z entries in the 5-9 band', () => {
    const wrong = uniqueAnagramWords.filter(
      (word) => !/^[a-z]+$/.test(word) || word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH,
    )

    expect(wrong).toStrictEqual([])
  })

  it('is sorted, so a regeneration is a reviewable diff', () => {
    expect(uniqueAnagramWords).toStrictEqual([...uniqueAnagramWords].sort())
  })

  it('holds no duplicates', () => {
    expect(new Set(uniqueAnagramWords).size).toEqual(uniqueAnagramWords.length)
  })

  // THE PRECISION HALF of decision 8's subsumption: no two entries share a letter multiset, so
  // membership really does mean "the only word with these letters".
  it('gives no two entries the same sorted letters', () => {
    expect(new Set(uniqueAnagramWords.map(sortedLetters)).size).toEqual(uniqueAnagramWords.length)
  })

  // chargedTerms, NOT chargedWords alone. Asserted against the list the gates actually read,
  // because blocklist.ts's 21 are singular base forms and this asset's window is 5-9 letters: on
  // chargedWords alone the four-letter entries could not match anything here at all while their
  // five-letter plurals sat in the list unnoticed.
  it('carries no charged term', () => {
    expect(uniqueAnagramWords.filter((word) => chargedTerms.has(word.toUpperCase()))).toStrictEqual([])
  })

  // STRICTLY STRONGER than the row above, and asserted against chargedTerms directly rather than
  // against a snapshot of the build script's output. Catching only the weaker statement is what let
  // the hole exist: uniqueness proves a scramble is not A WORD, and proves nothing about a scramble
  // being A SLUR, because a charged word absent from ENABLE is invisible to a filter that counts
  // ENABLE entries.
  it('carries no entry that anagrams to a charged term', () => {
    const blocked = new Set([...chargedTerms].map(sortedLetters))

    expect(uniqueAnagramWords.filter((word) => blocked.has(sortedLetters(word)))).toStrictEqual([])
  })

  // The named case the gate exists for. GINGER and NIGGER both key to EGGINR; on this corpus both
  // are present, so the uniqueness filter alone would already have taken them -- which is exactly
  // why the key filter's real proof is the planted fixture in the build script's own suite and not
  // this row. This one pins the outcome; that one pins the mechanism.
  it('carries neither member of the GINGER class', () => {
    expect(uniqueAnagramWords).not.toContain('ginger')
    expect(uniqueAnagramWords).not.toContain('nigger')
  })

  // THE WORDS THAT SHIPPED THE INCIDENT, each named with the form that escaped the old list.
  //
  // Every one of these cleared all nine word gates -- length, multiplicity, distinct permutations,
  // uniqueness and the answer-side blocklist -- because the letters they key to spell an INFLECTION
  // of a listed word rather than the listed word itself, and an inflection is a different multiset.
  // AGING was the worst of them: its 60-permutation space held exactly one band-4 acceptable
  // scramble, and 200 band-4 runs out of 200 shipped it.
  //
  // Reading `aging` back into this file is the single clearest signal that someone has narrowed
  // charged-terms.ts back to blocklist.ts's base forms.
  it.each(['aging', 'agings', 'gazing', 'entrain', 'entrains', 'swanker', 'sradhas'])(
    'leaves out %s, whose letters spell an inflected charged term',
    (word) => {
      expect(uniqueAnagramWords).not.toContain(word)
    },
  )

  // The supply floor the generator draws against. Measured, and asserted so it stays measured.
  it.each([5, 6, 7, 8, 9])('carries at least 1,000 words of length %i', (length) => {
    expect(uniqueAnagramWords.filter((word) => word.length === length).length).toBeGreaterThanOrEqual(
      MIN_WORDS_PER_BAND,
    )
  })

  // The golden rows: known members present, known non-members absent, each for a stated reason. They
  // are what tells a wholesale regeneration failure from a subtle one.
  it.each(['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'robot', 'ukulele'])(
    'carries %s, whose letters no other ENABLE entry shares',
    (word) => {
      expect(uniqueAnagramWords).toContain(word)
    },
  )

  it.each([
    ['toaster', 'rotates'],
    ['colander', 'conelrad'],
    ['apple', 'appel'],
    ['grater', 'garter'],
    ['blender', 'reblend'],
  ])('leaves out %s, which anagrams to %s', (word) => {
    expect(uniqueAnagramWords).not.toContain(word)
  })
})
