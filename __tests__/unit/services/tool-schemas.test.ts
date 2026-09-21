import Ajv from 'ajv'

import { crypticTool } from '@generators/crypticclue/generator'
import { MAX_GLOSS_LENGTH } from '@generators/crypticclue/hints'
import { CRYPTIC_VERDICTS, crypticReviewTool } from '@generators/crypticclue/review'
import { CRYPTIC_DEVICES, MAX_CLUE_LENGTH, MAX_CUE_TOKENS } from '@generators/crypticclue/verify'
import { MAX_WORD_LENGTH, MIN_WORD_LENGTH, WORDS_REQUESTED } from '@generators/themedanagrams/words'
import { MAX_THEME_WORDS, anagramSetTool } from '@services/anagram-sets'
import { SHAPES, phraseTool } from '@services/phrases'
import { VERDICTS, reviewTool } from '@services/review'
import { ToolSchema } from '@types'
import { MAX_FAMILIARITY, MIN_FAMILIARITY } from '@utils/phrase-checks'

// Every exported input_schema in the repo; a new tool joins by being added here, since a
// structural sweep of src/ cannot tell a tool schema from another object. The two review tools
// are not a duplication -- they run in separate concurrent builder invocations.
const tools: [string, ToolSchema][] = [
  ['anagramSetTool', anagramSetTool],
  ['crypticReviewTool', crypticReviewTool],
  ['crypticTool', crypticTool],
  ['phraseTool', phraseTool],
  ['reviewTool', reviewTool],
]

describe('tool schemas', () => {
  // The PERMITTED key set at every level, rather than a blocklist somebody must remember to
  // extend. `type` is the one most easily missed: ajv enforces it at every depth.
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
      // An empty object rather than an absence: only one is a statement this walker can assert on.
      expect(batch.items).toEqual({})
      expect(Object.keys(batch.items)).toHaveLength(0)
    })

    // Compiled and run exactly as bedrock.ts does, over good elements plus one malformed one.
    describe('a batch with one bad element still validates', () => {
      const validate = new Ajv().compile(tool.input_schema)
      const key = tool.input_schema.required[0]
      const good = {
        category: 'Film',
        hints: ['a', 'b', 'c'],
        index: 0,
        shape: 'title',
        text: 'A Phrase',
        clue: 'Dance hidden in instant angora',
        definition: 'Dance',
        device: 'hidden',
        fodder: 'instant angora',
        indicator: 'hidden in',
        theme: 'Kitchen tools',
        verdict: 'keep',
        words: ['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'teapot'],
      }

      it.each([
        ['a wrong-typed field', { ...good, device: 5, shape: 5, verdict: 5, words: 5 }],
        ['an unknown device', { ...good, device: 'charade' }],
        ['an extra field', { ...good, extra: true }],
        ['a null field', { ...good, text: null, theme: null, verdict: null }],
        ['a missing field', { category: 'Film', hints: ['a', 'b', 'c'], index: 0 }],
        ['a null element', null],
        ['a non-object element', 'not an object'],
        ['an array where an object belongs', []],
      ])('survives %s', (_description, bad) => {
        expect(validate({ [key]: [good, good, bad] })).toBe(true)
      })

      // The one surviving constraint, and why `required` is permitted above: with no batch key
      // there is nothing to iterate and nothing for a per-item filter to do.
      it('still rejects a payload with no batch key at all', () => {
        expect(validate({})).toBe(false)
      })
    })
  })

  // What the schema stopped saying, the description now says -- and a sentence does not
  // reference a constant, so adding a shape leaves it listing the old four. These rows are the
  // replacement coupling, asserted on the VALUES so rewording the prose is free.
  describe('the description states the constants it describes', () => {
    it.each(SHAPES)('phraseTool names the %s shape', (shape) => {
      expect(phraseTool.description).toContain(`"${shape}"`)
    })

    it.each([...VERDICTS])('reviewTool names the %s verdict', (verdict) => {
      expect(reviewTool.description).toContain(`"${verdict}"`)
    })

    // The one numeric bound reaching the description as DIGITS: toFamiliarity silently replaces
    // anything outside the band with the default, so widening MAX_FAMILIARITY alone collapses
    // every new rating to 3. MIN_WORDS/MAX_WORDS and HINT_COUNT reach the prose as number words
    // and are not pinned: the description already contains "three", so a word table would stay
    // green on MIN_WORDS becoming 3.
    it('reviewTool states the familiarity band its own bounds enforce', () => {
      expect(reviewTool.description).toContain(`${MIN_FAMILIARITY} to ${MAX_FAMILIARITY}`)
    })

    // Under `items: {}` this description is the only thing specifying a set to the model, and a
    // literal '5 to 9 letters' stayed green through two changes to the constants it named.
    it('anagramSetTool names both keys, the length band and the two cross-set rules', () => {
      expect(anagramSetTool.description).toContain('`theme`')
      expect(anagramSetTool.description).toContain('`words`')
      expect(anagramSetTool.description).toContain(`array of ${WORDS_REQUESTED} strings`)
      expect(anagramSetTool.description).toContain(`${MIN_WORD_LENGTH} to ${MAX_WORD_LENGTH} letters`)
      expect(anagramSetTool.description).toContain('Do not repeat a word across sets')
      expect(anagramSetTool.description).toContain('do not use a word that appears in the theme')
    })

    // Load-bearing, not advisory: entriesAt walks `words` in submission order and ships the first
    // WORDS_PER_PUZZLE that survive the gates, so most of the list is dropped by position.
    it('anagramSetTool tells the model that word order decides what ships', () => {
      expect(anagramSetTool.description).toContain('ordered best first')
    })

    // CRYPTIC_DEVICES is closed in src/types.ts and enforced in verify.ts, and driving this row
    // off the union means a device cannot be added without a sentence to go with it.
    it.each([...CRYPTIC_DEVICES])('crypticTool names the %s device', (device) => {
      expect(crypticTool.description).toContain(`"${device}"`)
    })

    it('crypticTool names the caps its gates enforce', () => {
      expect(crypticTool.description).toContain(`at most ${MAX_CLUE_LENGTH} characters`)
      expect(crypticTool.description).toContain('one to four words')
    })

    // verify.ts rejects `cue-too-long` and `connective-in-cue` silently, so a batch not told the
    // rules can break all of them. They bound what was an unbounded declared range: `ignore all
    // previous instructions vehicle` was an accepted cue for CAR. Two assertions rather than an
    // interpolation, since the description spells the bound as an English word.
    it('crypticTool states both rules bounding a cue', () => {
      expect(MAX_CUE_TOKENS).toEqual(3)
      expect(crypticTool.description).toContain('at most THREE WORDS')
      expect(crypticTool.description).toContain('NO LINKING WORD')
    })

    // The gloss's gate lives outside verify.ts, so the sentence is the only place the model
    // learns what gatedGloss enforces. "the definition" without backticks, deliberately:
    // `doubledefinition` carries `definitions` and no `definition` field.
    it('crypticTool states the gloss cap and both rules its gate enforces', () => {
      expect(crypticTool.description).toContain(`at most ${MAX_GLOSS_LENGTH} characters`)
      expect(crypticTool.description).toContain('never naming it')
      expect(crypticTool.description).toContain('never reusing a substantive word from the definition')
    })

    it.each([...CRYPTIC_VERDICTS])('crypticReviewTool names the %s verdict', (verdict) => {
      expect(crypticReviewTool.description).toContain(`"${verdict}"`)
    })

    // Unrecoverable if the reviewer breaks it: `clue` is stored byte-identical to the string
    // verify.ts proved, and two spans index it. applyFix enforces it; this pins that it is said.
    it('crypticReviewTool forbids rewriting the proved string', () => {
      expect(crypticReviewTool.description).toContain('Never rewrite the clue')
      expect(crypticReviewTool.description).toContain('fix sets ONLY its gloss')
    })

    // A rejected gloss reaches the reviewer as an ABSENT key, so the fix ADDS a rung rather than
    // replacing one; the word pinned is `NEW`.
    it('crypticReviewTool tells the reviewer a missing gloss is a fix, not just a replacement', () => {
      expect(crypticReviewTool.description).toContain('NEW')
      expect(crypticReviewTool.description).toContain('no `gloss` field at all')
    })

    // The one gate bound reaching the description as a number WORD, so it is pinned through a
    // lookup table rather than the digit.
    it('anagramSetTool states the theme word cap its own gate enforces', () => {
      const words: Record<number, string> = { 3: 'three', 4: 'four', 5: 'five' }

      expect(anagramSetTool.description).toContain(`at most ${words[MAX_THEME_WORDS]} words`)
    })
  })
})
