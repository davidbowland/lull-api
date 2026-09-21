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

    // A rung's `text` is raw model output: phraseTool types `hints` as a bare `{ type: 'array' }`
    // with no maxLength, and every client is told to render it verbatim. The cap is generous on
    // purpose -- the longest real rung in the fixtures is 43 characters -- so 200 rejects a
    // runaway generation rather than a wordy hint.
    it('rejects a hint longer than the cap', () => {
      expect(isPhraseHints(['one', 'two', 'x'.repeat(201)])).toBe(false)
    })

    it('accepts a hint exactly at the cap', () => {
      expect(isPhraseHints(['one', 'two', 'x'.repeat(200)])).toBe(true)
    })

    // Characters that do something rather than say something, none of which `trim()` removes. The
    // whole phrase is rejected rather than the character stripped, because silently rewriting model
    // prose puts the gates and the shipped string out of step.
    it.each([
      ['a right-to-left override', `${'\u202E'}A space opera sequel`],
      ['a null byte', 'A space\u0000opera sequel'],
      ['a newline', 'A space opera\nsequel'],
    ])('rejects a hint containing %s', (_description, hint) => {
      expect(isPhraseHints(['one', 'two', hint])).toBe(false)
    })

    // An over-broad class here drops legitimate rungs invisibly, costing a phrase per generation.
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

    // `text` is the string the player types and the reviewer may not rewrite it (<bounds> in
    // prompts/review-phrases.txt), so a British-spelled phrase has no repair path.
    it.each([['TRUE COLOURS'], ['A MATTER OF HONOUR'], ['THE GREY AREA'], ['CENTRE OF ATTENTION']])(
      'fails the British-spelled phrase %s',
      (text) => {
        expect(passesProseGates({ ...candidate, text })).toBe(false)
      },
    )

    it('passes the American spelling of the same phrase', () => {
      expect(passesProseGates({ ...candidate, text: 'TRUE COLORS' })).toBe(true)
    })

    // The asymmetry is the rule, not a gap: a hint and a category are READ rather than typed, and
    // review-phrases.txt assigns them `fix` where the phrase gets `drop`.
    it('does not drop a phrase for a British spelling in a hint or category', () => {
      expect(passesProseGates({ ...candidate, category: 'Theatre' })).toBe(true)
      expect(
        passesProseGates({
          ...candidate,
          hints: ['The one with the grey armour', 'A sequel', 'It ends on a revelation'],
        }),
      ).toBe(true)
    })

    // The category and the hints come off the same phrase and render in the same client, so both
    // need a cap: `{ verdict: 'fix', category: 'x'.repeat(5000) }` clears ajv, the blocklist and
    // the leak check.
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

    // Hints are player-visible model prose a reviewer may rewrite wholesale, so the blocklist runs
    // over them too.
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
