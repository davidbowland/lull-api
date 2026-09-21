import { chargedWords } from '../../../src/assets/blocklist'
import {
  collapse,
  containsAnswerToken,
  containsBritishSpelling,
  containsChargedWord,
  isFiniteNumber,
  isSafeProse,
  isTypeable,
  leaksAnswerTokens,
  passesStringGates,
  StringGateOptions,
} from '@utils/model-output-checks'

describe('model-output-checks', () => {
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

    // The tokenizer's `?? []`: with no letter-and-digit run `match` returns null, and null.some
    // throws inside a gate whose job is not to.
    it('reads a string with no letter or digit at all as no tokens', () => {
      expect(containsChargedWord('!!! ---')).toBe(false)
    })

    // No stemming, because it is substring matching and costs ASSESS and SCUNTHORPE -- so
    // exact-token matching is only safe while the LIST carries the inflected forms.
    it.each([
      'faggots',
      'bastards',
      'bitches',
      'pussies',
      'cunts',
      'fucks',
      'fucked',
      'fucker',
      'fucking',
      'spics',
      'assholes',
      'bullshit',
      'wankers',
      'trannie',
      'trannies',
      'hardass',
      'niggas',
    ])('catches %s, an inflection of a blocklist base form', (word) => {
      expect(containsChargedWord(word)).toBe(true)
    })

    // The vendored list was seeded with unambiguous profanity, so these are absent rather than
    // near-missed.
    it.each(['chinks', 'gooks', 'kikes', 'coons', 'wetbacks', 'jigaboos', 'golliwog', 'squaw', 'darky', 'honkies'])(
      'catches %s, an ethnic slur absent from blocklist.ts',
      (word) => {
        expect(containsChargedWord(word)).toBe(true)
      },
    )

    it.each(['mongoloid', 'spastics', 'spaz', 'cretin', 'imbecile', 'midget'])(
      'catches %s, a disability slur absent from blocklist.ts',
      (word) => {
        expect(containsChargedWord(word)).toBe(true)
      },
    )

    // Each contains an entry as a substring and is not one, so a stemmer bolted on later reddens.
    it.each([
      'Reassign the task',
      'Passphrase and cocktails',
      'Grasshopper',
      'A chinkapin tree',
      'Homophones and homographs',
      'A coonhound on the porch',
    ])('still keeps %s, which only contains an entry as a substring', (text) => {
      expect(containsChargedWord(text)).toBe(false)
    })
  })

  describe('containsBritishSpelling', () => {
    it.each([
      ['TRUE COLOURS'],
      ['A matter of honour'],
      ['Centre of the storm'],
      ['The defence rests'],
      ['Grey area'],
      ['Under the moustache'],
    ])('catches the British spelling in %s', (text) => {
      expect(containsBritishSpelling(text)).toBe(true)
    })

    // A gate firing on these rejects the spelling this game ships, which is worse than the leak.
    it.each([['TRUE COLORS'], ['A matter of honor'], ['Center of the storm'], ['The defense rests'], ['Gray area']])(
      'keeps the American %s',
      (text) => {
        expect(containsBritishSpelling(text)).toBe(false)
      },
    )

    // The greyhound rule: GREYHOUND is correct in every dialect and a substring rule kills it.
    it.each([['A greyhound at the track'], ['Greyhounds racing'], ['The scepticism of a scholar']])(
      'keeps %s, which only contains an entry as a substring',
      (text) => {
        expect(containsBritishSpelling(text)).toBe(false)
      },
    )

    // Ordinary American English that looks like it belongs: this fails on a suffix rule.
    it.each([
      ['Two analyses of the same text'],
      ['A theatrical entrance'],
      ['Please advise me'],
      ['A pleasant surprise'],
      ['Chop it with an axe'],
      ['A doughnut and coffee'],
      ['The sabre duel'],
    ])('keeps the American %s', (text) => {
      expect(containsBritishSpelling(text)).toBe(false)
    })

    // The tokenizer's `?? []`, same hazard as containsChargedWord.
    it('reads a string with no letter or digit at all as no tokens', () => {
      expect(containsBritishSpelling('!!! ---')).toBe(false)
    })

    // Each is an ENABLE entry clearing the themed-anagram lexicon, so each was an admissible
    // answer before this check. It pins the LIST; words.test.ts covers the wiring.
    it.each([
      'colour',
      'honour',
      'defence',
      'organise',
      'realise',
      'analyse',
      'flavour',
      'labour',
      'armour',
      'harbour',
      'moustache',
      'motorway',
      'ladybird',
      'jewellery',
      'pyjamas',
      'splendour',
      'behaviour',
      'neighbour',
    ])('catches %s, which the ENABLE lexicon admits as a word', (word) => {
      expect(containsBritishSpelling(word)).toBe(true)
    })
  })

  describe('leaksAnswerTokens', () => {
    it('catches a four-character word of the phrase in the prose', () => {
      expect(leaksAnswerTokens('Time flies like an arrow', 'An arrow of some kind')).toBe(true)
    })

    it('matches case-insensitively and across punctuation', () => {
      expect(leaksAnswerTokens('The Empire Strikes Back', 'What the empire, exactly?')).toBe(true)
    })

    // A hint for TO BE OR NOT TO BE cannot avoid "to", "be", "or" or "not".
    it('lets the function words of a quote-shape phrase through', () => {
      expect(leaksAnswerTokens('To be or not to be', 'A prince asks whether to go on or not')).toBe(false)
    })

    // LIKE, THAT, WITH, WHICH and ABOUT clear the length floor, so FUNCTION_WORDS sits beside it.
    it.each([
      ['Time flies like an arrow', 'A saying about how quickly the years pass, like this'],
      ['All that glitters is not gold', 'The proverb that warns you off appearances'],
      ['Gone with the wind', 'A Civil War epic with a famous closing line'],
    ])('lets a long function word of %s through', (text, prose) => {
      expect(leaksAnswerTokens(text, prose)).toBe(false)
    })

    // The exemption is function words only; a content word of the phrase is the leak this catches.
    it('still catches a content word of the same phrase', () => {
      expect(leaksAnswerTokens('Time flies like an arrow', 'An insect that flies, more or less')).toBe(true)
    })

    it('does not stem: STRIKES in the text does not catch STRIKE in the prose', () => {
      expect(leaksAnswerTokens('The Empire Strikes Back', 'A strike of lightning')).toBe(false)
    })

    // Nothing pins the argument order and nothing can: the predicate is symmetric.
  })

  describe('collapse', () => {
    // Punctuation STRIPPED and whitespace COLLAPSED, unlike normalizeAnswer's dropped spacing.
    it('reads two spellings of one sentence as one string', () => {
      expect(collapse('A red car!')).toBe(collapse('  a   red car  '))
    })

    // Spacing is kept, which is what makes this wrong for a one-phrase answer and right for prose.
    it('keeps the word boundary rather than closing it up', () => {
      expect(collapse('A red car')).toBe('A RED CAR')
    })
  })

  describe('isSafeProse', () => {
    it('accepts prose inside the cap', () => {
      expect(isSafeProse('A space opera sequel', 200)).toBe(true)
    })

    it('accepts prose exactly at the cap', () => {
      expect(isSafeProse('x'.repeat(200), 200)).toBe(true)
    })

    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
    ])('rejects %s prose', (_description, value) => {
      expect(isSafeProse(value, 200)).toBe(false)
    })

    it('rejects prose over the cap', () => {
      expect(isSafeProse('x'.repeat(201), 200)).toBe(false)
    })

    // Characters that DO something rather than say something, which `trim()` leaves mid-string.
    it.each([
      ['a right-to-left override', `A space opera${'\u202E'}sequel`],
      ['a null byte', 'A space opera\u0000sequel'],
      ['a newline', 'A space opera\nsequel'],
      ['a zero-width joiner', `A space opera${'\u200D'}sequel`],
    ])('rejects prose containing %s', (_description, value) => {
      expect(isSafeProse(value, 200)).toBe(false)
    })

    // Not a whitelist: an over-broad class drops good rungs invisibly.
    it('keeps punctuation, digits and accents', () => {
      expect(isSafeProse('The Empire — in Kubrick’s shadow, 1980', 200)).toBe(true)
    })
  })

  describe('isTypeable', () => {
    it.each([
      ['letters and spaces', 'The Empire Strikes Back', true],
      ['a digit', 'Catch 22', false],
      ['an accent', 'Café Society', false],
      ['punctuation', "Don't Look Up", false],
      ['an ampersand', 'Salt & Pepper', false],
      ['the empty string', '', false],
    ])('grades %s -> %s', (_description, value, expected) => {
      expect(isTypeable(value)).toBe(expected)
    })
  })

  describe('isFiniteNumber', () => {
    // Number.isFinite, never `typeof === 'number'`: NaN and Infinity are typeof number and
    // JSON.stringify writes them as `null`, so they go invalid only once persisted.
    it.each([
      [0, true],
      [-1.5, true],
      [Number.NaN, false],
      [Number.POSITIVE_INFINITY, false],
      ['5', false],
      [null, false],
      [undefined, false],
    ])('grades %p as %s', (value, expected) => {
      expect(isFiniteNumber(value)).toBe(expected)
    })
  })

  describe('containsAnswerToken', () => {
    // Whole-token, over the tokenizer leaksAnswerTokens uses, because the `hidden` device needs
    // TANGO across `insTANt ANGOra` to pass.
    it('does not find an answer split across two words', () => {
      expect(containsAnswerToken('TANGO', 'insTANt ANGOra')).toBe(false)
    })

    it('finds an answer standing as its own token', () => {
      expect(containsAnswerToken('TANGO', 'a TANGO for two')).toBe(true)
    })

    it('matches case-insensitively and ignores punctuation, like every other check in this module', () => {
      expect(containsAnswerToken('tango', 'A "Tango", danced')).toBe(true)
    })

    // No length floor and no function-word exemption, because a three-letter answer in its own
    // clue is the failure this gate catches.
    it.each([
      ['a three-character answer', 'ARM', 'an ARM and a leg'],
      ['a four-character function word as the answer', 'THAT', 'THAT is the question'],
    ])('catches %s that leaksAnswerTokens would exempt', (_description, answer, prose) => {
      expect(containsAnswerToken(answer, prose)).toBe(true)
      expect(leaksAnswerTokens(answer, prose)).toBe(false)
    })

    // A set intersection, so a swap returns the identical boolean. The real hazard is WHICH of the
    // two functions you call, and the ARM/THAT rows above defend that.
    it('is symmetric, so no assertion can defend the argument order', () => {
      expect(containsAnswerToken('a TANGO for two', 'TANGO')).toBe(containsAnswerToken('TANGO', 'a TANGO for two'))
    })
  })

  describe('passesStringGates', () => {
    const options = (overrides: Partial<StringGateOptions> = {}): StringGateOptions => ({
      maxLength: 80,
      value: 'A perfectly ordinary label',
      ...overrides,
    })

    it('passes an ordinary model-authored string', () => {
      expect(passesStringGates(options())).toBe(true)
    })

    // G1 -- typeof and non-empty after trim; `value` is `unknown` because this runs on model output.
    it.each([
      ['a non-string', 5],
      ['null', null],
      ['undefined', undefined],
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s', (_description, value) => {
      expect(passesStringGates(options({ value }))).toBe(false)
    })

    // G2 -- per FIELD and required: bounding one player-visible string and not the next is not a
    // bound.
    it('rejects a string past its own cap', () => {
      expect(passesStringGates(options({ maxLength: 10, value: 'x'.repeat(11) }))).toBe(false)
      expect(passesStringGates(options({ maxLength: 11, value: 'x'.repeat(11) }))).toBe(true)
    })

    // G3 -- no Cc and no Cf, because endpoints.rest tells every client to render `text` verbatim.
    it.each([
      ['a newline', 'two\nlines'],
      // An escape and never pasted: a pasted U+202E is invisible in a diff.
      ['a right-to-left override', `harmless${'\u202E'}suffix`],
    ])('rejects %s', (_description, value) => {
      expect(passesStringGates(options({ value }))).toBe(false)
    })

    // G4 -- the blocklist, whole-token and never substring, so SCUNTHORPE survives. An explicit
    // literal, not `[...chargedWords][0]`, which G1-G3 could reject first and leave this row
    // vacuously green; the membership assertion keeps the literal honest.
    it('rejects a charged word and keeps a word that merely contains one', () => {
      expect(chargedWords.has('BASTARD')).toBe(true)
      expect(passesStringGates(options({ value: 'BASTARD' }))).toBe(false)
      expect(passesStringGates(options({ value: 'Scunthorpe United' }))).toBe(true)
    })

    // G5 -- waived by omitting `answer`, by ROLE: a cryptic clue, where the answer inside the clue
    // IS the puzzle, and a string that IS an answer, where it would empty the exclusion list.
    it('runs the answer-leak gate only when an answer is supplied', () => {
      expect(passesStringGates(options({ answer: 'The Empire Strikes Back', value: 'A film about an EMPIRE' }))).toBe(
        false,
      )
      expect(passesStringGates(options({ value: 'A film about an EMPIRE' }))).toBe(true)
    })

    // The only row saying G5 is leaksAnswerTokens and NOT containsAnswerToken, because no other
    // fixture here lives where the two differ: ARM is three characters, so the floor exempts it.
    it('gates on the leak predicate, not the answer-presence one', () => {
      expect(passesStringGates(options({ answer: 'ARM', value: 'an ARM and a leg' }))).toBe(true)
    })

    it('passes a supplied answer that the value does not leak', () => {
      expect(
        passesStringGates(options({ answer: 'The Empire Strikes Back', value: 'A film about a distant war' })),
      ).toBe(true)
    })

    // `answer: ''` is not a third way to waive: `answer !== undefined` is true for it, so an
    // undefended guard tokenizes to nothing and passes every value -- `puzzle.answer ?? ''` fails
    // OPEN.
    it.each([
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s as an answer rather than silently waiving the gate', (_description, answer) => {
      expect(passesStringGates(options({ answer, value: 'A film about a distant war' }))).toBe(false)
    })

    it('never rejects a string for leaking itself, because the gate is not asked', () => {
      expect(passesStringGates(options({ value: 'The Empire Strikes Back' }))).toBe(true)
    })

    // G6 -- opt IN, never a default: a label is not "the one string the player types". `typeable:
    // false` is not a duplicate of the omitted row, because the plausible slip is
    // `typeable !== undefined`, under which an explicit false applies the charset.
    it('applies the typeable charset only when asked for it', () => {
      expect(passesStringGates(options({ typeable: true, value: 'Catch 22' }))).toBe(false)
      expect(passesStringGates(options({ typeable: false, value: 'Catch 22' }))).toBe(true)
      expect(passesStringGates(options({ value: 'Catch 22' }))).toBe(true)
    })

    it('accepts a typeable string when the typeable charset is asked for', () => {
      expect(passesStringGates(options({ typeable: true, value: 'The Empire Strikes Back' }))).toBe(true)
    })
  })
})
