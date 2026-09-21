import { cryptogramPuzzle, missingVowelsPuzzle, phrase } from '../__mocks__'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '@generators/category-visibility'
import { PhraseHints } from '@types'
import { toHintLadder } from '@utils/hints'

const texts: PhraseHints = [
  'A space opera sequel',
  'The middle chapter, where the heroes lose',
  'The one where a lightsaber duel ends with a revelation about parentage',
]

describe('hints', () => {
  describe('toHintLadder', () => {
    // The one place a phrase's three bare strings become the wire shape.
    it('wraps each text in its own rung, in order', () => {
      expect(toHintLadder(texts)).toEqual([{ text: texts[0] }, { text: texts[1] }, { text: texts[2] }])
    })

    // No `metadata: undefined`, which differs from an absent key: JSON.stringify drops it either
    // way, but the audit's blind reader and every toEqual here see the difference.
    it('adds no metadata key at all', () => {
      expect(toHintLadder(texts).map((hint) => Object.keys(hint))).toEqual([['text'], ['text'], ['text']])
    })

    // Handing back anything the caller references lets a later mutation of the Phrase reach a
    // puzzle already written into a pack.
    it('builds a new ladder on every call', () => {
      expect(toHintLadder(texts)).not.toBe(toHintLadder(texts))
      expect(toHintLadder(texts)[0]).not.toBe(toHintLadder(texts)[0])
    })
  })

  // The fixture guard for the two shared phrase puzzles: tsconfig.json excludes __tests__/, so
  // their Puzzle<...> annotations are never typechecked and a drifted copy teaches every suite
  // that imports them a shape the generators cannot emit. The two answer opposite ways, and
  // cryptogram's absence gets its own row because a stray `hints` would otherwise go unnoticed.
  describe('the shared phrase puzzle fixtures', () => {
    it('carries missingVowelsPuzzle hints in the shape its generator emits', () => {
      expect(missingVowelsPuzzle.data.hints).toEqual(toHintLadder(phrase.hints))
    })

    it('carries no hints at all on cryptogramPuzzle, whose generator ships none', () => {
      expect('hints' in cryptogramPuzzle.data).toBe(false)
    })

    // The same guard, one field over: a fixture whose difficulty and category disagree with
    // CATEGORY_HIDDEN_BY_DIFFICULTY is a shape no generator emits. Asserted against the table
    // rather than a literal, so re-banding moves this row with it.
    it.each([
      ['missingVowelsPuzzle', missingVowelsPuzzle],
      ['cryptogramPuzzle', cryptogramPuzzle],
    ])('shows or hides %s category as its difficulty requires', (_description, puzzle) => {
      expect(puzzle.data.category === undefined).toBe(CATEGORY_HIDDEN_BY_DIFFICULTY[puzzle.difficulty])
    })
  })
})
