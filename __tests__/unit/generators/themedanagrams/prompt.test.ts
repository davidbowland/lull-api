import { readFileSync } from 'fs'
import { join } from 'path'

import { WORDS_PER_PUZZLE } from '@generators/themedanagrams/words'

/**
 * THE ANAGRAM PROMPT'S OWN CONTRACT, and it is deliberately NOT a row in __tests__/unit/prompts.test.ts.
 * That file is a directory scan on purpose (see its header at :4-16): its rows are cross-cutting
 * security invariants that must hold for every prompt, including ones nobody has written yet, and
 * their whole value is that they name no file. A named-file, named-block assertion sitting among
 * them would read as one of those invariants and is not one.
 *
 * So it lives beside the generator whose constants it binds, following
 * crypticclue/generator.test.ts:203-228, where the analogous prompt-prose-to-TS agreement check
 * lives with its own generator rather than in the shared scanner.
 */
describe('prompts/create-anagram-sets.txt', () => {
  const prompt = readFileSync(join(__dirname, '../../../../prompts/create-anagram-sets.txt'), 'utf8')
  const blockOf = (name: string): string => prompt.split(`<${name}>`)[1].split(`</${name}>`)[0]

  const wordRules = blockOf('word_rules')
  const whyTheOverAsk = blockOf('why_the_over_ask')

  // THE CONTROL. Every assertion below is scoped to one block, and a block that stopped being found
  // -- renamed, retagged, split -- would leave those assertions passing over the wrong text or over
  // nothing at all. This row is what says the two blocks are real and distinct before anything reads
  // them.
  it('found the two blocks it scopes its assertions to', () => {
    expect(wordRules).toContain('Exactly `wordsPerSet` words per set.')
    expect(wordRules).not.toContain('why_the_over_ask')
    expect(whyTheOverAsk).toContain('words are asked for')
    expect(whyTheOverAsk).not.toContain('word_rules')
  })

  describe('the length band', () => {
    // AC-001. The bullet states the band and stops there. "Reach for the top of the band first" was
    // buying a per-word survival rate the over-ask no longer needs, at the cost of a length mix a
    // themed category does not naturally produce -- and the ratio sentence ("nearly FOUR TIMES as
    // likely to be thrown out") existed only to justify it, so it goes with it.
    it.each([['LEAN LONG'], ['Reach for the top'], ['FOUR TIMES'], ['treat the bottom as the exception']])(
      'no longer tells the model %s',
      (directive) => {
        expect(wordRules).not.toContain(directive)
      },
    )

    // THE OTHER HALF OF AC-001, and the reason the rows above name exact directives instead of
    // matching on "long" or "length". "Do not cluster at the bottom" is not "reach for the top": six
    // letters is the WORST surviving band (63.2% against 88.2% at nine), and this sentence is the
    // only remaining brake on a set piling up there. A blunt absence check would have deleted it
    // silently and undershot the survival rate the over-ask is sized against.
    it('still tells the model not to cluster at the bottom of the band', () => {
      expect(wordRules).toContain(
        'Some variety in length is good; a set built mostly of the shortest words allowed is a set that will not survive.',
      )
    })
  })

  describe('the word-form rule', () => {
    /*
     * C-1's OTHER HALF, which nothing bound until this row existed. Both length sentences were
     * pinned in two directions while the bullet the change was FOR could be deleted outright with a
     * green suite -- an odd asymmetry for the deliverable.
     *
     * It pins the BLEACH/BLEACHES contrast specifically, because that pair is the whole rule in one
     * line and both halves are verified against the real gate: BLEACH is admitted, BLEACHES returns
     * displacedForm. An example the code rejects would be worse than none -- the bullet briefly
     * offered SCISSORS and CLOTHES, and both are thrown away (multiplicity and displacedForm
     * respectively), which would have spent a slot of the over-ask on every set that obeyed.
     */
    it('tells the model not to pad with a plural, using a contrast the gate agrees with', () => {
      expect(wordRules).toContain('NEVER REACH FOR A PLURAL TO MAKE A WORD LONGER')
      expect(wordRules).toContain('BLEACH, not BLEACHES')
    })

    /*
     * AND THAT IT DOES NOT OVERSHOOT INTO "SINGULAR, ALWAYS", which is a different rule and a worse
     * one. The gate admits a plural whose singular could never have shipped -- SPONGE collides with
     * PONGES, so SPONGES is accepted -- and the class is not a curiosity: 293 of the 3,174 nouns in
     * src/assets/nouns.ts pluralize into a word this gate admits while the singular itself cannot
     * ship.
     * The model cannot consult the anagram index, so a prompt forbidding plurals means it offers
     * SPONGE, loses the slot, and never offers the form the gate would have taken. Those concepts
     * leave the game through the prompt even though the code would have allowed them.
     */
    it('does not forbid plurals outright, so the gate stays reachable', () => {
      expect(wordRules).toContain('you are not being asked to avoid plurals')
    })
  })

  describe('the prose numbers', () => {
    const numberWords: Record<number, string> = { 1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX' }

    // Guards the mapping rather than the prompt: a WORDS_PER_PUZZLE moved past this table would
    // otherwise look up `undefined` and fail the row below with a message about the prompt, which is
    // the wrong file to go read.
    it('can spell the constant it is about to look for', () => {
      expect(Object.keys(numberWords).map(Number)).toContain(WORDS_PER_PUZZLE)
    })

    // AC-004, SCOPED TO <why_the_over_ask> ON PURPOSE. The sentence there states WORDS_PER_PUZZLE in
    // prose instead of receiving it interpolated, and the number is the entire argument for asking
    // for `wordsPerSet` and shipping fewer. The scope matters because FOUR is written out in
    // <word_rules> too -- as the "FIRST FOUR that survive" ordering rule, and as a ratio ("nearly
    // FOUR TIMES") until this change removed it -- so a whole-file match on the number would be
    // answering to sentences this row is not about, and re-adding any "four times" phrasing
    // elsewhere must not be able to satisfy or break this row either.
    it('states the shipped-word count in prose, matching WORDS_PER_PUZZLE', () => {
      expect(whyTheOverAsk).toContain(`and ${numberWords[WORDS_PER_PUZZLE]} are shipped`)
    })
  })
})
