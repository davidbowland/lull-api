import { readFileSync } from 'fs'
import { join } from 'path'

import { WORDS_PER_PUZZLE, wordGateFailure } from '@generators/themedanagrams/words'

// Not a row in __tests__/unit/prompts.test.ts: that file is a directory scan whose rows are
// cross-cutting invariants naming no file. A named-file, named-block check lives beside the
// generator whose constants it binds, as in crypticclue/generator.test.ts.
describe('prompts/create-anagram-sets.txt', () => {
  const prompt = readFileSync(join(__dirname, '../../../../prompts/create-anagram-sets.txt'), 'utf8')
  const blockOf = (name: string): string => prompt.split(`<${name}>`)[1].split(`</${name}>`)[0]

  const wordRules = blockOf('word_rules')
  const whyTheOverAsk = blockOf('why_the_over_ask')

  // The control: every assertion below is scoped to one block, so a block that was renamed or split
  // would leave them passing over the wrong text or over nothing.
  it('found the two blocks it scopes its assertions to', () => {
    expect(wordRules).toContain('Exactly `wordsPerSet` words per set.')
    expect(wordRules).not.toContain('why_the_over_ask')
    expect(whyTheOverAsk).toContain('words are asked for')
    expect(whyTheOverAsk).not.toContain('word_rules')
  })

  describe('the length band', () => {
    // The bullet states the band and stops there: reaching for the top buys a per-word survival rate
    // the over-ask does not need, at the cost of a length mix a themed category does not produce.
    it.each([['LEAN LONG'], ['Reach for the top'], ['FOUR TIMES'], ['treat the bottom as the exception']])(
      'no longer tells the model %s',
      (directive) => {
        expect(wordRules).not.toContain(directive)
      },
    )

    // Why the rows above name exact directives rather than matching on "long": six letters is the
    // worst surviving band, and this sentence is the only remaining brake on a set piling up there.
    it('still tells the model not to cluster at the bottom of the band', () => {
      expect(wordRules).toContain(
        'Some variety in length is good; a set built mostly of the shortest words allowed is a set that will not survive.',
      )
    })
  })

  describe('the word-form rule', () => {
    // Pins the BLEACH/BLEACHES contrast, both halves verified against the real gate. An example the
    // code rejects is worse than none: SCISSORS and CLOTHES would spend a slot on every set obeying.
    it('tells the model not to pad with an inflection, using contrasts the gate agrees with', () => {
      expect(wordRules).toContain('NEVER INFLECT A WORD TO MAKE IT LONGER')
      expect(wordRules).toContain('BLEACH, not BLEACHES')
      expect(wordRules).toContain('not EAGLES')
      expect(wordRules).toContain('not MUNCHED')
    })

    // The gate cannot see -ING, and a set mixing forms is the defect players notice, so agreement is
    // the model's job and stated as a rule of its own.
    it('tells the model every word in a set takes one grammatical form', () => {
      expect(wordRules).toContain('EVERY WORD IN A SET TAKES THE SAME GRAMMATICAL FORM')
    })

    // The field the reviewer holds the words to; asked for before the words so it is a decision
    // rather than a description written after the fact.
    it('tells the model to state the form before choosing the words', () => {
      expect(wordRules).toContain("write it in the set's `form` field BEFORE choosing any word")
    })

    // Grammar alone admits BURGLAR, ROBBERY and FELONY together: all singular nouns, three kinds of thing.
    it('tells the model every word in a set is the same kind of word', () => {
      expect(wordRules).toContain('The same goes for the KIND of word')
      expect(wordRules).toContain('never BURGLAR, ROBBERY, SHOPLIFT, FELONY')
    })

    // An example the gate disagrees with teaches the model to spend a slot on every set that obeys.
    it.each([
      ['BLEACHES', 'displacedForm'],
      ['EAGLES', 'paddedForm'],
      ['MUNCHED', 'paddedForm'],
    ])('names %s as a bad word, which the gate rejects as %s', (word, gate) => {
      expect(wordRules).toContain(word)
      expect(wordGateFailure(word, { seen: new Set(), used: new Set() })).toEqual(gate)
    })

    it.each([
      'BLEACH',
      'OSPREY',
      'VULTURE',
      'GOSHAWK',
      'LOBBING',
      'VOLLEYING',
      'GOBBLE',
      'GUZZLE',
      'NIBBLE',
      'BURGLAR',
      'ROBBER',
      'MUGGER',
      'POACHER',
      'BURGLARY',
      'ROBBERY',
      'LARCENY',
    ])('names %s as a good word, which the gate admits', (word) => {
      expect(wordRules).toContain(word)
      expect(wordGateFailure(word, { seen: new Set(), used: new Set() })).toBeUndefined()
    })

    // The gate admits a plural whose singular could never ship -- SPONGE collides with PONGES -- and
    // the model cannot consult the anagram index, so forbidding plurals loses the form outright.
    it('does not forbid plurals outright, so the gate stays reachable', () => {
      expect(wordRules).toContain('you are not being asked to avoid plurals')
    })
  })

  describe('the prose numbers', () => {
    const numberWords: Record<number, string> = { 1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX' }

    // Guards the mapping, not the prompt: a WORDS_PER_PUZZLE past this table would look up
    // `undefined` and fail the row below with a message about the wrong file.
    it('can spell the constant it is about to look for', () => {
      expect(Object.keys(numberWords).map(Number)).toContain(WORDS_PER_PUZZLE)
    })

    // Scoped to <why_the_over_ask>: FOUR is written out in <word_rules> too, so a whole-file match
    // would answer to sentences this row is not about.
    it('states the shipped-word count in prose, matching WORDS_PER_PUZZLE', () => {
      expect(whyTheOverAsk).toContain(`and ${numberWords[WORDS_PER_PUZZLE]} are shipped`)
    })
  })
})
