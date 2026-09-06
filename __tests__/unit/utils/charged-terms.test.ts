import { chargedWords } from '../../../src/assets/blocklist'
import { additionalChargedWords, chargedTerms } from '@utils/charged-terms'

// A list is data, and data is checked by proving its contents rather than by covering the module that
// declares it. These rows are the ones a reader would want held against a hand-maintained list: that
// the union really is a union, that every entry can actually be MATCHED by the tokenizer that reads
// it, and that the categories the incident was about are represented rather than gestured at.

// Restated rather than imported from model-output-checks.ts, which keeps its tokenizer private. An
// entry this does not match is an entry that can never fire -- a hyphen, a space or a digit in a
// blocklist entry is a silent no-op, and a silent no-op in a content gate is the failure mode this
// whole file exists to answer.
const MATCHABLE_ENTRY = /^[A-Z]+$/

describe('charged-terms', () => {
  describe('chargedTerms', () => {
    // The union is the point. Reading either half alone is the bug: chargedWords alone is 21 singular
    // base forms, and additionalChargedWords alone has none of them.
    it('carries every blocklist entry', () => {
      expect([...chargedWords].filter((word) => !chargedTerms.has(word))).toStrictEqual([])
    })

    it('carries every addition', () => {
      expect([...additionalChargedWords].filter((word) => !chargedTerms.has(word))).toStrictEqual([])
    })

    it('is exactly the two halves and nothing else', () => {
      expect(chargedTerms.size).toEqual(chargedWords.size + additionalChargedWords.size)
    })

    // Strictly stronger than the size row when the two halves overlap: a duplicated entry would make
    // the union smaller than the sum, which the row above already catches, but this one names WHICH.
    // Duplicates are not a correctness bug here -- the union blocks the term either way. They are
    // the signal that a term has been added to blocklist.ts and its copy below is now dead weight.
    it('duplicates no blocklist entry in the additions', () => {
      expect([...additionalChargedWords].filter((word) => chargedWords.has(word))).toStrictEqual([])
    })

    // THE ROW THAT CATCHES AN UNMATCHABLE ENTRY. model-output-checks.ts tokenizes on letter-and-digit
    // runs, so an entry carrying a hyphen or a space -- SON-OF-A-BITCH, TOWEL HEAD -- is present in
    // the list, reads as covered in review, and can never match anything.
    it('holds only uppercase A-Z tokens the tokenizer can match', () => {
      expect([...chargedTerms].filter((word) => !MATCHABLE_ENTRY.test(word))).toStrictEqual([])
    })
  })

  describe('additionalChargedWords', () => {
    // THE INFLECTION HALF, one row per blocklist base form that had a reachable inflection. The
    // build-time key filter keys on the exact letter multiset of a LISTED form, so each of these was
    // a different key and escaped it whole -- which is the mechanism, stated as a table.
    it.each([
      ['NIGGER', 'NIGGA'],
      ['TRANNY', 'TRANNIE'],
      ['WANKER', 'WANKERS'],
      ['ASSHOLE', 'HARDASS'],
      ['FUCK', 'FUCKS'],
      ['SHIT', 'SHITS'],
      ['CUNT', 'CUNTS'],
      ['SLUT', 'SLUTS'],
      ['SPIC', 'SPICS'],
      ['TWAT', 'TWATS'],
      ['DYKE', 'DYKES'],
      ['JIZZ', 'JIZZES'],
    ])('carries %s as %s, which the base form never covered', (base, inflection) => {
      expect(chargedWords.has(base)).toBe(true)
      expect(chargedWords.has(inflection)).toBe(false)
      expect(additionalChargedWords.has(inflection)).toBe(true)
    })

    // THE FOUR-LETTER PROBLEM, stated once. A four-letter blocklist entry cannot match ANY anagram
    // key the build filter computes, because anagrams share a length and Themed Anagrams' window
    // starts well above four. Eight of the 21 are four letters.
    //
    // THESE ROWS ARE NO LONGER ABOUT THAT WINDOW, which rose from 5 to 6: a five-letter plural is
    // now outside it too, so none of the words below can key against an anagram class either. They
    // are asserted because containsChargedWord reads this list over PHRASE text, which has no length
    // window -- the coverage is live, the anagram rationale is not. Themed Anagrams is guarded here
    // by the six-and-longer inflections instead.
    it.each(['CUNTS', 'FUCKS', 'SHITS', 'SLUTS', 'SPICS', 'TWATS', 'DYKES'])(
      'covers %s, a five-letter plural of a four-letter blocklist entry',
      (word) => {
        expect(word).toHaveLength(5)
        expect(additionalChargedWords.has(word)).toBe(true)
      },
    )

    // THE CATEGORY HALF. blocklist.ts is "seeded with unambiguous profanity" and was never
    // extended, so these are absent rather than near-missed.
    it.each(['CHINK', 'COON', 'GOOK', 'KIKE', 'WETBACK', 'JIGABOO', 'GOLLIWOG', 'SQUAW', 'DARKY', 'HONKY', 'WHITEY'])(
      'covers %s, an ethnic slur with no blocklist row',
      (word) => {
        expect(chargedWords.has(word)).toBe(false)
        expect(chargedTerms.has(word)).toBe(true)
      },
    )

    it.each(['MONGOLOID', 'SPASTIC', 'SPAZ', 'CRETIN', 'IMBECILE', 'MIDGET', 'MORON'])(
      'covers %s, a disability slur with no blocklist row',
      (word) => {
        expect(chargedWords.has(word)).toBe(false)
        expect(chargedTerms.has(word)).toBe(true)
      },
    )

    // THE DELIBERATE OMISSIONS, pinned so they are read as decisions rather than rediscovered as
    // gaps. Matching is whole-token, so every entry costs the ordinary English word that spells it,
    // and each of these costs more than it buys: QUEER for "strange", CRACKER and SPADE and TART and
    // SLAG and NIP in their overwhelmingly innocent senses, CRIPPLE and LAME as ordinary verbs and
    // adjectives, MONGOL as an ethnonym. Adding one is a decision; the row that goes red is the
    // prompt to write down why.
    it.each(['QUEER', 'CRACKER', 'SPADE', 'TART', 'SLAG', 'CRIPPLE', 'LAME', 'MONGOL', 'GYPPED'])(
      'deliberately does not carry %s, whose innocent sense costs more than the gate buys',
      (word) => {
        expect(chargedTerms.has(word)).toBe(false)
      },
    )
  })
})
