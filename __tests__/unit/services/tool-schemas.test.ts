import Ajv from 'ajv'

import { MAX_THEME_WORDS, anagramSetTool } from '@services/anagram-sets'
import { SHAPES, phraseTool } from '@services/phrases'
import { VERDICTS, reviewTool } from '@services/review'
import { ToolSchema } from '@types'
import { MAX_FAMILIARITY, MIN_FAMILIARITY } from '@utils/phrase-checks'

// Every exported input_schema in the repo. A new tool joins by being added here, deliberately: the
// alternative is a structural sweep of src/, which cannot tell a tool schema from any other object.
const tools: [string, ToolSchema][] = [
  ['anagramSetTool', anagramSetTool],
  ['phraseTool', phraseTool],
  ['reviewTool', reviewTool],
]

describe('tool schemas', () => {
  // The PERMITTED key set, at every level, rather than a blocklist of banned keywords. A blocklist
  // is a list somebody has to remember to extend, and this is the third attempt at writing one --
  // the first two both missed `type`, which ajv enforces at every depth and which fails the whole
  // payload over one malformed element.
  describe.each(tools)('%s', (_name, tool) => {
    it('describes the top level and nothing below it', () => {
      expect(Object.keys(tool.input_schema).sort()).toEqual(['properties', 'required', 'type'])
      expect(tool.input_schema.type).toEqual('object')
      expect(tool.input_schema.required).toHaveLength(1)

      const key = tool.input_schema.required[0]
      expect(Object.keys(tool.input_schema.properties)).toEqual([key])

      const batch = tool.input_schema.properties[key]
      expect(Object.keys(batch).sort()).toEqual(['items', 'type'])
      expect(batch.type).toEqual('array')
      // An EMPTY object, and an absence measures identically -- an empty object is written because
      // it is a visible statement of intent that this walker can assert on and an absence is not.
      expect(batch.items).toEqual({})
      expect(Object.keys(batch.items)).toHaveLength(0)
    })

    // Compiled and run exactly as bedrock.ts does (services/bedrock.ts:22, :177-185), against a
    // batch of good elements plus one malformed one. Every row below RAN and failed the whole
    // payload against the schema on master.
    describe('a batch with one bad element still validates', () => {
      const validate = new Ajv().compile(tool.input_schema)
      const key = tool.input_schema.required[0]
      const good = {
        category: 'Film',
        hints: ['a', 'b', 'c'],
        index: 0,
        shape: 'title',
        text: 'A Phrase',
        theme: 'Kitchen tools',
        verdict: 'keep',
        words: ['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'teapot'],
      }

      it.each([
        ['a wrong-typed field', { ...good, shape: 5, verdict: 5, words: 5 }],
        ['a null field', { ...good, text: null, theme: null, verdict: null }],
        ['a missing field', { category: 'Film', hints: ['a', 'b', 'c'], index: 0 }],
        ['a null element', null],
        ['a non-object element', 'not an object'],
        ['an array where an object belongs', []],
      ])('survives %s', (_description, bad) => {
        expect(validate({ [key]: [good, good, bad] })).toBe(true)
      })

      // The one surviving constraint, asserted through ajv rather than only read off the schema.
      // A payload with no batch key is not a batch at all: there is nothing to iterate and nothing
      // left for a per-item filter to do. This row is why `required` is the one keyword the walker
      // above permits alongside `type` and `properties`.
      it('still rejects a payload with no batch key at all', () => {
        expect(validate({})).toBe(false)
      })
    })
  })

  // What the schema stopped saying, the description now says -- and a sentence does not reference a
  // constant. `enum: SHAPES` and the verdict enum were LIVE references: adding a fifth shape used to
  // change the payload the model was sent. Now it changes SHAPES and isUsable, the sentence keeps
  // listing four, the batch comes back without the new tag, isUsable accepts nothing new, and no
  // test fails. These rows are the replacement coupling, and they are the ONLY thing standing
  // between a new tag and a silent no-op.
  //
  // Asserted on the VALUES rather than on the whole sentence, so rewording the prose is free and
  // changing the constant is not.
  describe('the description states the constants it describes', () => {
    it.each(SHAPES)('phraseTool names the %s shape', (shape) => {
      expect(phraseTool.description).toContain(`"${shape}"`)
    })

    it.each([...VERDICTS])('reviewTool names the %s verdict', (verdict) => {
      expect(reviewTool.description).toContain(`"${verdict}"`)
    })

    // The one numeric bound that reaches the description as DIGITS, so it can be pinned to the
    // constants rather than to English. toFamiliarity silently replaces anything outside this band
    // with the default, so widening MAX_FAMILIARITY without widening the sentence gives the model no
    // way to ask for the new rating and every attempt at one collapses to 3.
    //
    // This does match the connective: rewriting "from 1 to 5" as "between 1 and 5" turns it red for
    // no behavioural reason. That is the accepted cost, and the fix is one word. The word-count
    // bounds (MIN_WORDS/MAX_WORDS, "two to six words") and HINT_COUNT ("exactly three strings")
    // reach the prose as English NUMBER WORDS and are deliberately NOT pinned here: a digit-to-word
    // table would pass on a change it should catch, because the description already contains the
    // word "three" for the hints, so MIN_WORDS becoming 3 would find its word and stay green. A test
    // that passes when the thing it names is broken is worse than no test.
    it('reviewTool states the familiarity band its own bounds enforce', () => {
      expect(reviewTool.description).toContain(`${MIN_FAMILIARITY} to ${MAX_FAMILIARITY}`)
    })

    // Under `items: {}` this description is the ONLY thing that specifies a set to the model, which
    // is the cost of an opaque element and the reason a one-sentence description would be the
    // failure mode of that decision. Asserted on the values that reach the prose as digits; the word
    // counts reach it as English number words and are deliberately not pinned, because a
    // digit-to-word table passes on changes it should catch.
    it('anagramSetTool names both keys, the length band and the two cross-set rules', () => {
      expect(anagramSetTool.description).toContain('`theme`')
      expect(anagramSetTool.description).toContain('`words`')
      expect(anagramSetTool.description).toContain('5 to 9 letters')
      expect(anagramSetTool.description).toContain('Do not repeat a word across sets')
      expect(anagramSetTool.description).toContain('do not use a word that appears in the theme')
    })

    // The one bound the gate enforces that reaches the description as a NUMBER WORD. Pinned through
    // a table rather than the digit, because the sentence genuinely reads "at most four words" and
    // rewriting the gate's constant without rewriting the sentence is the drift worth catching.
    it('anagramSetTool states the theme word cap its own gate enforces', () => {
      const words: Record<number, string> = { 3: 'three', 4: 'four', 5: 'five' }

      expect(anagramSetTool.description).toContain(`at most ${words[MAX_THEME_WORDS]} words`)
    })
  })
})
