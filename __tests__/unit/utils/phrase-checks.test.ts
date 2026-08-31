import { isPhraseHints, passesProseGates, toFamiliarity } from '@utils/phrase-checks'

jest.mock('@utils/logging')

describe('phrase-checks', () => {
  const ladder: [string, string, string] = [
    'A space opera sequel',
    'The middle chapter, where the heroes lose',
    'The one where Luke learns who his father is',
  ]

  describe('isPhraseHints', () => {
    it('accepts three distinct non-empty strings', () => {
      expect(isPhraseHints(ladder)).toBe(true)
    })

    it.each([
      ['not an array', 'a hint'],
      ['two hints', ['one', 'two']],
      ['four hints', ['one', 'two', 'three', 'four']],
      ['a blank hint', ['one', '   ', 'three']],
      ['a non-string hint', ['one', 2, 'three']],
      ['two hints that differ only in case and punctuation', ['A red car!', 'a red car', 'three']],
    ])('rejects %s', (_description, value) => {
      expect(isPhraseHints(value)).toBe(false)
    })

    // THE LENGTH GATE, and the reason it exists is a contract change rather than a new attack. A
    // phrase rung's `text` is raw model output -- phraseTool types `hints` as a bare
    // `{ type: 'array' }` with no items and no maxLength (services/phrases.ts:47-53), and
    // ALLOWED_CHARACTERS plus the 2-6 word bound constrain Phrase.text ONLY, never the prose. Now
    // that every client is told to render `text` verbatim, an unbounded model string is a payload
    // the API promises to print. CLAUDE.md's security rule names length explicitly.
    //
    // Generous on purpose: a rung is one sentence, and the longest real one in the fixtures is 43
    // characters. This rejects a runaway generation, not a wordy hint.
    it('rejects a hint longer than the cap', () => {
      expect(isPhraseHints(['one', 'two', 'x'.repeat(201)])).toBe(false)
    })

    it('accepts a hint exactly at the cap', () => {
      expect(isPhraseHints(['one', 'two', 'x'.repeat(200)])).toBe(true)
    })

    // A length cap is not a content check. These are the characters that do something rather than
    // say something, and `trim()` does not remove any of them: U+202E flips the rendering direction
    // of everything after it, U+0000 terminates a C string, and a newline breaks any renderer that
    // assumes one line per rung. The wire contract now says RENDER THIS VERBATIM, so a rung is only
    // as safe as the narrowest client that obeys it.
    //
    // Rejecting the whole phrase rather than stripping the character: a hint that needs a control
    // code is a bad generation, and silently rewriting model prose would put the gates and the
    // shipped string out of step.
    it.each([
      ['a right-to-left override', `${'\u202E'}A space opera sequel`],
      ['a null byte', 'A space\u0000opera sequel'],
      ['a newline', 'A space opera\nsequel'],
    ])('rejects a hint containing %s', (_description, hint) => {
      expect(isPhraseHints(['one', 'two', hint])).toBe(false)
    })

    // The characters real prose needs, none of which are control or format codes. An over-broad
    // class here silently drops legitimate rungs, which costs a phrase per generation and is
    // invisible except in the logs.
    it('keeps punctuation, digits and accents', () => {
      expect(isPhraseHints(['A 1977 film', "Vader's line, misquoted", 'The Empire — in Kubrick’s shadow'])).toBe(true)
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

    // The category and the hints come off the same phrase and are rendered by the same client -- on
    // Missing Vowels, the one phrase type still shipping a ladder -- and the category was gated by
    // isFilledString alone: a non-empty check with no length at all. A
    // reviewer returning `{ verdict: 'fix', category: 'x'.repeat(5000) }` clears ajv (the tool types
    // it as a bare string), clears the blocklist and the leak check, and ships. The rung beside it
    // could not have been 201 characters. Bounding one player-visible model string and not the
    // other beside it is not a bound.
    it('fails a category longer than the cap', () => {
      expect(passesProseGates({ ...candidate, category: 'x'.repeat(121) })).toBe(false)
    })

    it('passes a category exactly at the cap', () => {
      expect(passesProseGates({ ...candidate, category: 'x'.repeat(120) })).toBe(true)
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
