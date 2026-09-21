import { chargedWords } from '../../../src/assets/blocklist'
import { additionalChargedWords, chargedTerms } from '@utils/charged-terms'

// Restated because model-output-checks.ts keeps its tokenizer private. An entry this does not match
// can never fire: a hyphen, a space or a digit in a blocklist entry is a silent no-op.
const MATCHABLE_ENTRY = /^[A-Z]+$/

describe('charged-terms', () => {
  describe('chargedTerms', () => {
    // Reading either half alone is the bug: chargedWords is 21 singular base forms, and
    // additionalChargedWords holds none of them.
    it('carries every blocklist entry', () => {
      expect([...chargedWords].filter((word) => !chargedTerms.has(word))).toStrictEqual([])
    })

    it('carries every addition', () => {
      expect([...additionalChargedWords].filter((word) => !chargedTerms.has(word))).toStrictEqual([])
    })

    it('is exactly the two halves and nothing else', () => {
      expect(chargedTerms.size).toEqual(chargedWords.size + additionalChargedWords.size)
    })

    // The size row above catches a duplicate; this one names WHICH. Not a correctness bug -- the
    // union blocks the term either way -- but a signal that a copy here is now dead weight.
    it('duplicates no blocklist entry in the additions', () => {
      expect([...additionalChargedWords].filter((word) => chargedWords.has(word))).toStrictEqual([])
    })

    // The tokenizer splits on letter-and-digit runs, so an entry carrying a hyphen or a space --
    // SON-OF-A-BITCH, TOWEL HEAD -- reads as covered in review and matches nothing.
    it('holds only uppercase A-Z tokens the tokenizer can match', () => {
      expect([...chargedTerms].filter((word) => !MATCHABLE_ENTRY.test(word))).toStrictEqual([])
    })
  })

  describe('additionalChargedWords', () => {
    // One row per blocklist base form with a reachable inflection. The build-time key filter keys
    // on the exact letter multiset of a LISTED form, so each of these is a different key.
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

    // These five-letter plurals sit below Themed Anagrams' six-letter window, so they earn their
    // place through containsChargedWord, which reads this list over PHRASE text and has no length
    // window. Themed Anagrams is guarded by the six-and-longer inflections instead.
    it.each(['CUNTS', 'FUCKS', 'SHITS', 'SLUTS', 'SPICS', 'TWATS', 'DYKES'])(
      'covers %s, a five-letter plural of a four-letter blocklist entry',
      (word) => {
        expect(word).toHaveLength(5)
        expect(additionalChargedWords.has(word)).toBe(true)
      },
    )

    // blocklist.ts was seeded with unambiguous profanity and never extended, so these are absent
    // rather than near-missed.
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

    // Deliberate omissions, pinned so they read as decisions rather than gaps: matching is
    // whole-token, so every entry costs the ordinary English word that spells it. Adding one is a
    // decision, and the red row is the prompt to say why.
    it.each(['QUEER', 'CRACKER', 'SPADE', 'TART', 'SLAG', 'CRIPPLE', 'LAME', 'MONGOL', 'GYPPED'])(
      'deliberately does not carry %s, whose innocent sense costs more than the gate buys',
      (word) => {
        expect(chargedTerms.has(word)).toBe(false)
      },
    )
  })
})
