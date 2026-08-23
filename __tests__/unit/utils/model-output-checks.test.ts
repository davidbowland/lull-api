import { chargedWords } from '../../../src/assets/blocklist'
import {
  collapse,
  containsAnswerToken,
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

    // The tokenizer's `?? []`. A string with no letter-and-digit run at all -- which a model can
    // return, and which every caller here passes straight through -- makes `match` return null, and
    // null.some is a TypeError inside a gate whose whole job is to not throw on model output.
    it('reads a string with no letter or digit at all as no tokens', () => {
      expect(containsChargedWord('!!! ---')).toBe(false)
    })

    // THE INFLECTIONS. This check has no stemming and never will -- a stemmer is substring matching
    // wearing a hat, and substring matching is what costs ASSESS and SCUNTHORPE. So the exact-token
    // gap the tokenizer comment calls "accepted rather than overlooked" is only acceptable while the
    // LIST carries the inflected forms, and on the 21 vendored base forms alone it did not: every
    // string below tokenizes to a word that was not in chargedWords, so every one of them was an
    // admissible ANSWER and an admissible hint. WATCHED RED: narrow containsChargedWord back to
    // src/assets/blocklist.ts and this whole table goes green-to-red at once.
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
    ])('catches %s, an inflection of a vendored base form', (word) => {
      expect(containsChargedWord(word)).toBe(true)
    })

    // THE CATEGORIES THE VENDORED LIST HAS NO ROW FOR AT ALL. It was "seeded with unambiguous
    // profanity" and never extended, so an ethnic or a disability slur was not a near-miss -- it was
    // simply absent, at every inflection, on every gate in this repo.
    it.each(['chinks', 'gooks', 'kikes', 'coons', 'wetbacks', 'jigaboos', 'golliwog', 'squaw', 'darky', 'honkies'])(
      'catches %s, an ethnic slur absent from the vendored list',
      (word) => {
        expect(containsChargedWord(word)).toBe(true)
      },
    )

    it.each(['mongoloid', 'spastics', 'spaz', 'cretin', 'imbecile', 'midget'])(
      'catches %s, a disability slur absent from the vendored list',
      (word) => {
        expect(containsChargedWord(word)).toBe(true)
      },
    )

    // The widened list did NOT widen the matching rule, and this is the row that says so. Every one
    // of these contains an entry as a substring and none of them is one, so a stemmer or a
    // substring check bolted on later reddens here rather than in production.
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

  describe('leaksAnswerTokens', () => {
    it('catches a four-character word of the phrase in the prose', () => {
      expect(leaksAnswerTokens('Time flies like an arrow', 'An arrow of some kind')).toBe(true)
    })

    it('matches case-insensitively and across punctuation', () => {
      expect(leaksAnswerTokens('The Empire Strikes Back', 'What the empire, exactly?')).toBe(true)
    })

    // The floor is load-bearing. A strict whole-token check would drop nearly every quote-shape
    // phrase, because a hint for TO BE OR NOT TO BE cannot avoid "to", "be", "or" and "not".
    it('lets the function words of a quote-shape phrase through', () => {
      expect(leaksAnswerTokens('To be or not to be', 'A prince asks whether to go on or not')).toBe(false)
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
      expect(leaksAnswerTokens(text, prose)).toBe(false)
    })

    // The exemption is function words ONLY. A noun, verb or adjective of the phrase in a hint is
    // exactly the leak this check exists to catch.
    it('still catches a content word of the same phrase', () => {
      expect(leaksAnswerTokens('Time flies like an arrow', 'An insect that flies, more or less')).toBe(true)
    })

    it('does not stem: STRIKES in the text does not catch STRIKE in the prose', () => {
      expect(leaksAnswerTokens('The Empire Strikes Back', 'A strike of lightning')).toBe(false)
    })

    // NO TEST HERE PINS THE ARGUMENT ORDER, and none can: this predicate is symmetric. `leaky` is
    // tokens(answer) run through a per-token filter, and the result is whether tokens(prose) meets
    // it -- which is filter(tokens(answer) INTERSECT tokens(prose)), the same set either way round.
    // A swapped call returns the identical boolean, so a test asserting the order would pass
    // unconditionally. The `(answer, prose)` order is a CONVENTION for the reader and for the second
    // rule that lands beside it, not a property this suite can defend.
  })

  // Reached through isPhraseHints before the split; exported now, so gated directly here. The
  // compositional cases stay in phrase-checks.test.ts.
  describe('collapse', () => {
    // Punctuation is STRIPPED and whitespace COLLAPSED, not discarded -- the difference from
    // normalizeAnswer, which drops spacing entirely. Two rungs that differ only in punctuation and
    // spacing are the same rung to a player.
    it('reads two spellings of one sentence as one string', () => {
      expect(collapse('A red car!')).toBe(collapse('  a   red car  '))
    })

    // Spacing is kept, which is what makes this wrong for a one-phrase answer and right for prose.
    it('keeps the word boundary rather than closing it up', () => {
      expect(collapse('A red car')).toBe('A RED CAR')
    })
  })

  // Reached through isPhraseHints and isFilledString before the split; exported now, so gated
  // directly here. The compositional cases stay in phrase-checks.test.ts.
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

    // Characters that DO something instead of saying something, none of which `trim()` removes from
    // the middle of a string. The wire contract says render `text` VERBATIM, so a rung is only as
    // safe as the narrowest renderer that obeys it.
    it.each([
      ['a right-to-left override', `A space opera${'\u202E'}sequel`],
      ['a null byte', 'A space opera\u0000sequel'],
      ['a newline', 'A space opera\nsequel'],
      ['a zero-width joiner', `A space opera${'\u200D'}sequel`],
    ])('rejects prose containing %s', (_description, value) => {
      expect(isSafeProse(value, 200)).toBe(false)
    })

    // Deliberately NOT a whitelist: prose legitimately carries punctuation, digits, apostrophes and
    // accents, and an over-broad class here drops good rungs invisibly except in the logs.
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
    // Number.isFinite, never `typeof === 'number'`. NaN and Infinity are both typeof number and
    // JSON.stringify writes them as `null`, so an unguarded value produces a puzzle that is invalid
    // only AFTER it is persisted -- and nothing in this repo rewrites a stored pack.
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
    // WHOLE-TOKEN, over the same module-private tokenizer leaksAnswerTokens uses. The `hidden` cryptic
    // device is the case that decides the shape: TANGO hidden across `insTANt ANGOra` tokenizes to
    // INSTANT and ANGORA, and neither is TANGO -- so a whole-token check passes a legitimate hidden
    // clue, which is what makes it the right instrument for that type's verifier.
    it('does not find an answer split across two words', () => {
      expect(containsAnswerToken('TANGO', 'insTANt ANGOra')).toBe(false)
    })

    it('finds an answer standing as its own token', () => {
      expect(containsAnswerToken('TANGO', 'a TANGO for two')).toBe(true)
    })

    it('matches case-insensitively and ignores punctuation, like every other check in this module', () => {
      expect(containsAnswerToken('tango', 'A "Tango", danced')).toBe(true)
    })

    // NO length floor and NO function-word exemption, unlike leaksAnswerTokens. Those two exist
    // because a hint for TO BE OR NOT TO BE cannot avoid "to", "be", "or" and "not"; a cryptic clue
    // asserting containsAnswerToken(answer, clue) === false has no such problem, and a three-letter
    // answer sitting in its own clue is exactly the failure the gate exists to catch.
    it.each([
      ['a three-character answer', 'ARM', 'an ARM and a leg'],
      ['a four-character function word as the answer', 'THAT', 'THAT is the question'],
    ])('catches %s that leaksAnswerTokens would exempt', (_description, answer, prose) => {
      expect(containsAnswerToken(answer, prose)).toBe(true)
      expect(leaksAnswerTokens(answer, prose)).toBe(false)
    })

    // THE ARGUMENT ORDER IS NOT PINNED HERE, AND NO TEST CAN PIN IT -- because a swap is provably
    // free, not because the suite is weak. containsAnswerToken(a, b) is `tokens(b) meets
    // set(tokens(a))`, which is `tokens(a) INTERSECT tokens(b) is non-empty`, and set intersection is
    // commutative, so a swapped call returns the IDENTICAL boolean. The plan's draft called
    // `('TANGO', 'a TANGO for two')` versus `('a TANGO for two', 'TANGO')` an asymmetric pair; both
    // are true, as its own expectations conceded. Its BLOCK was falsifiable -- so is this one -- but
    // the ORDER PROPERTY it named cannot fail under any implementation, which is the part that would
    // have been theater.
    //
    // So this asserts the property that is actually there, and it is falsifiable: change `some` to
    // `every` and it goes red. What it does NOT do is stand in for the real hazard, which is not the
    // order of the arguments but WHICH OF THE TWO FUNCTIONS you call. leaksAnswerTokens and
    // containsAnswerToken share the exact `(string, string) => boolean` signature over one tokenizer,
    // so the compiler cannot separate them -- but a test can, and the tests do. They differ only on
    // tokens shorter than MIN_LEAK_TOKEN_LENGTH or listed in FUNCTION_WORDS; the ARM/THAT rows above
    // pin the difference here, and the 'gates on the leak predicate' row in passesStringGates pins it
    // at the composition every model-authored string passes through. Those rows, not the parameter
    // names, are the defense.
    //
    // ONE ROW IS ALL THAT IS POSSIBLE. This started as four and the other three could not fail. A
    // row over two strings that share no token, and its transpose, die only to a mutant that invents
    // an arbitrary threshold -- and one of the two was literally the other with the `toBe` operands
    // swapped, which `Object.is` cannot tell apart. The surviving row is the only one that dies to an
    // edit anyone would actually make to a three-line set intersection: `some` -> `every` makes the
    // two sides true and false.
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

    // G1 -- typeof and non-empty after trim. `value` is `unknown` on purpose: these gates run over
    // model output and a caller that had already proved it was a string would not need the row.
    it.each([
      ['a non-string', 5],
      ['null', null],
      ['undefined', undefined],
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s', (_description, value) => {
      expect(passesStringGates(options({ value }))).toBe(false)
    })

    // G2 -- the cap is per FIELD and is a required parameter, never one global number.
    // phrase-checks.ts:118-120 records that bounding hints and leaving `category` unbounded "is not a
    // bound", and that { category: 'x'.repeat(5000) } cleared every gate before the second cap existed.
    it('rejects a string past its own cap', () => {
      expect(passesStringGates(options({ maxLength: 10, value: 'x'.repeat(11) }))).toBe(false)
      expect(passesStringGates(options({ maxLength: 11, value: 'x'.repeat(11) }))).toBe(true)
    })

    // G3 -- no Cc and no Cf. endpoints.rest tells every client to render `text` VERBATIM, and a rung
    // is only as safe as the narrowest renderer that takes the instruction literally.
    it.each([
      ['a newline', 'two\nlines'],
      // Written as an ESCAPE and never pasted, the same discipline __mocks__.ts applies to U+00D7:
      // U+202E RIGHT-TO-LEFT OVERRIDE reverses the rendering of everything after it, so a pasted one
      // is invisible in a diff and reverses the file in half the tools that open it.
      ['a right-to-left override', `harmless${'\u202E'}suffix`],
    ])('rejects %s', (_description, value) => {
      expect(passesStringGates(options({ value }))).toBe(false)
    })

    // G4 -- the blocklist, whole-token and never substring, so SCUNTHORPE survives.
    //
    // An explicit literal, NOT `[...chargedWords][0]`. Reading the first entry couples the row to
    // insertion order in blocklist.ts, and a first entry that was not a plain token inside the
    // 80-character cap would be rejected by G1-G3 before G4 saw it -- leaving the row VACUOUSLY green
    // instead of red. The membership assertion is what keeps the literal honest: drop BASTARD from
    // the list and this fails at the first line rather than passing for the wrong reason.
    it('rejects a charged word and keeps a word that merely contains one', () => {
      expect(chargedWords.has('BASTARD')).toBe(true)
      expect(passesStringGates(options({ value: 'BASTARD' }))).toBe(false)
      expect(passesStringGates(options({ value: 'Scunthorpe United' }))).toBe(true)
    })

    // G5 -- WAIVED by omitting `answer`, and the waiver is by ROLE. Two roles need it: a cryptic clue,
    // where the answer's letters sitting inside the clue IS the puzzle; and a string that IS an
    // answer, which is utils/exclusions.ts -- leaksAnswerTokens(answer, answer) is true for every
    // entry of four characters or more, so running G5 there would empty the list every night.
    it('runs the answer-leak gate only when an answer is supplied', () => {
      expect(passesStringGates(options({ answer: 'The Empire Strikes Back', value: 'A film about an EMPIRE' }))).toBe(
        false,
      )
      expect(passesStringGates(options({ value: 'A film about an EMPIRE' }))).toBe(true)
    })

    // G5 IS leaksAnswerTokens AND NOT containsAnswerToken, and this row is the only thing in the
    // repo that says so at the composition. Substitute containsAnswerToken on that line and every
    // other assertion here stays green: the two predicates agree everywhere except on tokens shorter
    // than MIN_LEAK_TOKEN_LENGTH or listed in FUNCTION_WORDS, and no other fixture in this describe
    // lives there -- the G5 pair either shares EMPIRE, a six-character content word both predicates
    // catch, or shares nothing.
    //
    // ARM is three characters, so the floor exempts it and G5 must pass "an ARM and a leg".
    // containsAnswerToken has no floor and no exemption, so the substituted gate would reject it --
    // and rejecting a hint for saying a three-letter or function word of its own answer is the exact
    // regression MIN_LEAK_TOKEN_LENGTH and FUNCTION_WORDS exist to prevent. The unit-level pair at
    // 'catches %s that leaksAnswerTokens would exempt' proves the difference; this carries it into
    // the one composition every model-authored string passes through.
    it('gates on the leak predicate, not the answer-presence one', () => {
      expect(passesStringGates(options({ answer: 'ARM', value: 'an ARM and a leg' }))).toBe(true)
    })

    it('passes a supplied answer that the value does not leak', () => {
      expect(
        passesStringGates(options({ answer: 'The Empire Strikes Back', value: 'A film about a distant war' })),
      ).toBe(true)
    })

    // `answer: ''` IS NOT A THIRD WAY TO WAIVE. `answer !== undefined` is true for it, so on the
    // undefended guard G5 runs, tokenizes the answer to nothing, and passes every value -- a waiver
    // that LOOKS applied. A caller writing `answer: puzzle.answer ?? ''` would get it silently and
    // fail OPEN, and StringGateOptions says a G5 waiver is written down in a spec and never
    // discovered. An empty or whitespace-only answer is rejected instead: loud on the first draft,
    // costing one item, rather than a hole in the gate table nobody can see.
    it.each([
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s as an answer rather than silently waiving the gate', (_description, answer) => {
      expect(passesStringGates(options({ answer, value: 'A film about a distant war' }))).toBe(false)
    })

    it('never rejects a string for leaking itself, because the gate is not asked', () => {
      expect(passesStringGates(options({ value: 'The Empire Strikes Back' }))).toBe(true)
    })

    // G6 -- opt IN, never a default. A label is not in the role "the one string the player types".
    //
    // `typeable: false` written OUT is the third row and not a duplicate of the omitted one: the gate
    // is `typeable !== true`, and the plausible slip is `typeable !== undefined`, under which an
    // explicit false starts applying the charset while an omitted one still does not. Only a row that
    // says false out loud separates those two implementations.
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
