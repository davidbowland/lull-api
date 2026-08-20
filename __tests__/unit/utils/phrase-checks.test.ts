import {
  containsChargedWord,
  isHintLadder,
  leaksPhraseTokens,
  passesProseGates,
  toFamiliarity,
} from '@utils/phrase-checks'

jest.mock('@utils/logging')

describe('phrase-checks', () => {
  const ladder: [string, string, string] = [
    'A space opera sequel',
    'The middle chapter, where the heroes lose',
    'The one where Luke learns who his father is',
  ]

  describe('containsChargedWord', () => {
    it('catches a charged word as a whole token', () => {
      expect(containsChargedWord('No shit Sherlock')).toBe(true)
    })

    // Whole-token, NEVER substring: ASSESS, COCKTAIL and SCUNTHORPE are legitimate.
    it.each([['Assess the damage'], ['A cocktail party'], ['Scunthorpe United']])(
      'keeps %s, which only contains a charged word as a substring',
      (text) => {
        expect(containsChargedWord(text)).toBe(false)
      },
    )
  })

  describe('leaksPhraseTokens', () => {
    it('catches a four-character word of the phrase in the prose', () => {
      expect(leaksPhraseTokens('Time flies like an arrow', 'An arrow of some kind')).toBe(true)
    })

    it('matches case-insensitively and across punctuation', () => {
      expect(leaksPhraseTokens('The Empire Strikes Back', 'What the empire, exactly?')).toBe(true)
    })

    // The floor is load-bearing. A strict whole-token check would drop nearly every quote-shape
    // phrase, because a hint for TO BE OR NOT TO BE cannot avoid "to", "be", "or" and "not".
    it('lets the function words of a quote-shape phrase through', () => {
      expect(leaksPhraseTokens('To be or not to be', 'A prince asks whether to go on or not')).toBe(false)
    })

    // The length floor alone does not clear the function words -- LIKE, THAT, WITH, WHICH and ABOUT
    // are all four characters or more. Dropping a phrase because a hint said "like" costs a good
    // phrase over a word that gives nothing away, and reverts good reviewer fixes for the same
    // reason.
    it.each([
      ['Time flies like an arrow', 'A saying about how quickly the years pass, like this'],
      ['All that glitters is not gold', 'The proverb that warns you off appearances'],
      ['Gone with the wind', 'A Civil War epic with a famous closing line'],
    ])('lets a long function word of %s through', (text, prose) => {
      expect(leaksPhraseTokens(text, prose)).toBe(false)
    })

    // The exemption is function words ONLY. A noun, verb or adjective of the phrase in a hint is
    // exactly the leak this check exists to catch.
    it('still catches a content word of the same phrase', () => {
      expect(leaksPhraseTokens('Time flies like an arrow', 'An insect that flies, more or less')).toBe(true)
    })

    it('does not stem: STRIKES in the text does not catch STRIKE in the prose', () => {
      expect(leaksPhraseTokens('The Empire Strikes Back', 'A strike of lightning')).toBe(false)
    })
  })

  describe('isHintLadder', () => {
    it('accepts three distinct non-empty strings', () => {
      expect(isHintLadder(ladder)).toBe(true)
    })

    it.each([
      ['not an array', 'a hint'],
      ['two hints', ['one', 'two']],
      ['four hints', ['one', 'two', 'three', 'four']],
      ['a blank hint', ['one', '   ', 'three']],
      ['a non-string hint', ['one', 2, 'three']],
      ['two hints that differ only in case and punctuation', ['A red car!', 'a red car', 'three']],
    ])('rejects %s', (_description, value) => {
      expect(isHintLadder(value)).toBe(false)
    })
  })

  describe('toFamiliarity', () => {
    it('passes an in-range integer through', () => {
      expect(toFamiliarity(5)).toBe(5)
    })

    // A rating nothing in this spec consumes is not worth losing content over.
    it.each([
      ['absent', undefined],
      ['out of range', 9],
      ['not an integer', 2.5],
      ['not a number', '4'],
    ])('defaults %s to 3', (_description, value) => {
      expect(toFamiliarity(value)).toBe(3)
    })
  })

  describe('passesProseGates', () => {
    const candidate = { category: 'Film', hints: ladder, text: 'The Empire Strikes Back' }

    it('passes clean prose', () => {
      expect(passesProseGates(candidate)).toBe(true)
    })

    it('fails a malformed ladder', () => {
      expect(passesProseGates({ ...candidate, hints: ['one', 'two'] })).toBe(false)
    })

    it.each([
      ['absent', undefined],
      ['blank', '   '],
      ['not a string', 7],
    ])('fails a %s category', (_description, category) => {
      expect(passesProseGates({ ...candidate, category })).toBe(false)
    })

    // Hints are player-visible model prose that a reviewer may rewrite wholesale, which is exactly
    // why the blocklist runs over them and not only over the phrase text.
    it('fails a blocklisted term in a hint', () => {
      expect(
        passesProseGates({ ...candidate, hints: ['A space opera sequel', 'No shit Sherlock', 'The third one'] }),
      ).toBe(false)
    })

    it('fails a blocklisted term in the category', () => {
      expect(passesProseGates({ ...candidate, category: 'No shit Sherlock' })).toBe(false)
    })

    it('fails a phrase word leaking into a hint', () => {
      expect(
        passesProseGates({ ...candidate, hints: ['A space opera sequel', 'The empire loses', 'The third one'] }),
      ).toBe(false)
    })

    it('fails a phrase word leaking into the category', () => {
      expect(passesProseGates({ ...candidate, category: 'Empire stories' })).toBe(false)
    })
  })
})
