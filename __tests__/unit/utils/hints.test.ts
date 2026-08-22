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
    // The ONE place a phrase's three bare strings become the wire shape. Both phrase generators go
    // through it, so neither can drift into shipping raw strings the way they both did before the
    // shape was unified.
    it('wraps each text in its own rung, in order', () => {
      expect(toHintLadder(texts)).toEqual([{ text: texts[0] }, { text: texts[1] }, { text: texts[2] }])
    })

    // No `metadata: undefined`, which is a different thing from an absent key: JSON.stringify drops
    // the key either way, but the audit's blind reader and every toEqual in this repo can see the
    // difference, and a phrase rung has no structure a board could act on.
    it('adds no metadata key at all', () => {
      expect(toHintLadder(texts).map((hint) => Object.keys(hint))).toEqual([['text'], ['text'], ['text']])
    })

    // A fresh array of fresh objects. Handing back anything the caller still holds a reference to
    // would let a later mutation of the Phrase reach a puzzle already written into a pack.
    it('builds a new ladder on every call', () => {
      expect(toHintLadder(texts)).not.toBe(toHintLadder(texts))
      expect(toHintLadder(texts)[0]).not.toBe(toHintLadder(texts)[0])
    })
  })

  // THE FIXTURE GUARD, and it is here because there was nowhere else it could go. goFigure's shared
  // fixture is pinned to buildHints in hints.test.ts; the two phrase fixtures had no equivalent, so
  // nothing at all checked them -- and tsconfig.json excludes __tests__/, so their
  // Puzzle<MissingVowelsData> / Puzzle<CryptogramData> annotations are never typechecked either.
  // Both carry the shared `phrase` fixture's ladder, so an unwrapped or drifted copy in the mocks
  // teaches every suite that imports them a shape the generators cannot emit.
  describe('the shared phrase puzzle fixtures', () => {
    it.each([
      ['missingVowelsPuzzle', missingVowelsPuzzle],
      ['cryptogramPuzzle', cryptogramPuzzle],
    ])('carries %s hints in the shape its generator emits', (_description, puzzle) => {
      expect(puzzle.data.hints).toEqual(toHintLadder(phrase.hints))
    })

    // The SAME guard, one field over, and it was missed the first time -- missingVowelsPuzzle sat at
    // difficulty 3 carrying `category: 'Film'` while CATEGORY_HIDDEN_BY_DIFFICULTY hides the category
    // at 3 and 5, so it was exactly the "shape the generator cannot emit" the comment above warns
    // about. audit-hints.test.ts uses that fixture as its CATEGORY SHOWN row, a bucket the puzzle
    // would never have been in.
    //
    // Asserted against the table rather than against a literal, so re-banding the table moves this
    // test with it instead of leaving it asserting yesterday's answer.
    it.each([
      ['missingVowelsPuzzle', missingVowelsPuzzle],
      ['cryptogramPuzzle', cryptogramPuzzle],
    ])('shows or hides %s category as its difficulty requires', (_description, puzzle) => {
      expect(puzzle.data.category === undefined).toBe(CATEGORY_HIDDEN_BY_DIFFICULTY[puzzle.difficulty])
    })
  })
})
