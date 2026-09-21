import { uniqueAnagramWords } from '@generators/themedanagrams/data/anagram-words'
import { sortedLetters } from '@generators/themedanagrams/letters'
import { chargedTerms } from '@utils/charged-terms'

// This suite proves the asset's contents. It cannot prove an entry was wrongly RETAINED -- the
// anagram that should have removed it is by definition not in the list -- which is the CI
// `--check` re-derivation's job.

// Restated from the build script rather than imported: a floor imported from the thing it checks
// moves when the producer moves.
const MIN_WORD_LENGTH = 6
const MAX_WORD_LENGTH = 9
const MIN_WORDS_PER_BAND = 1_000

describe('uniqueAnagramWords', () => {
  it('holds only lowercase a-z entries in the 6-9 band', () => {
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

  // Membership means "the only word with these letters".
  it('gives no two entries the same sorted letters', () => {
    expect(new Set(uniqueAnagramWords.map(sortedLetters)).size).toEqual(uniqueAnagramWords.length)
  })

  // chargedTerms, not chargedWords: blocklist.ts holds singular base forms and this asset's window
  // is 6-9 letters, so a short base form matches nothing here while its longer inflections sit in
  // the list unnoticed.
  it('carries no charged term', () => {
    expect(uniqueAnagramWords.filter((word) => chargedTerms.has(word.toUpperCase()))).toStrictEqual([])
  })

  // Stronger than the row above, and asserted against chargedTerms rather than a snapshot of the
  // build script's output: uniqueness proves a scramble is not a word, and says nothing about a
  // scramble being a slur, because a charged word absent from ENABLE is invisible to a filter that
  // counts ENABLE entries.
  it('carries no entry that anagrams to a charged term', () => {
    const blocked = new Set([...chargedTerms].map(sortedLetters))

    expect(uniqueAnagramWords.filter((word) => blocked.has(sortedLetters(word)))).toStrictEqual([])
  })

  // The named case the gate exists for: GINGER and NIGGER both key to EGGINR. This row pins the
  // outcome; the planted fixture in the build script's own suite pins the mechanism.
  it('carries neither member of the GINGER class', () => {
    expect(uniqueAnagramWords).not.toContain('ginger')
    expect(uniqueAnagramWords).not.toContain('nigger')
  })

  // Each clears every word gate on its own -- length, multiplicity, distinct permutations,
  // uniqueness, the answer-side blocklist -- because its letters spell an INFLECTION of a listed
  // word rather than the listed word, and an inflection is a different multiset. All are six
  // letters or longer, so each row still fails for the reason it names. Either of `agings` or
  // `gazing` reappearing in the asset is the clearest signal that someone has narrowed
  // charged-terms.ts back to blocklist.ts's base forms.
  it.each(['agings', 'gazing', 'entrain', 'entrains', 'swanker', 'sradhas'])(
    'leaves out %s, whose letters spell an inflected charged term',
    (word) => {
      expect(uniqueAnagramWords).not.toContain(word)
    },
  )

  // The supply floor the generator draws against. Measured, and asserted so it stays measured.
  it.each([6, 7, 8, 9])('carries at least 1,000 words of length %i', (length) => {
    expect(uniqueAnagramWords.filter((word) => word.length === length).length).toBeGreaterThanOrEqual(
      MIN_WORDS_PER_BAND,
    )
  })

  // Golden rows: known members present, known non-members absent, each for a stated reason. They
  // tell a wholesale regeneration failure from a subtle one.
  it.each(['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'ukulele'])(
    'carries %s, whose letters no other ENABLE entry shares',
    (word) => {
      expect(uniqueAnagramWords).toContain(word)
    },
  )

  // Every pair is six letters or longer, so the window does not exclude it before uniqueness is
  // consulted and each row still fails for the reason it names.
  it.each([
    ['toaster', 'rotates'],
    ['colander', 'conelrad'],
    ['grater', 'garter'],
    ['blender', 'reblend'],
  ])('leaves out %s, which anagrams to %s', (word) => {
    expect(uniqueAnagramWords).not.toContain(word)
  })

  // The window asserted on a real word rather than only as a length predicate: ROBOT passes every
  // other gate, so this row fails if someone widens the window back to five.
  it('leaves out robot, a unique five-letter entry the window now excludes', () => {
    expect(uniqueAnagramWords).not.toContain('robot')
  })
})
