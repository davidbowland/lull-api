import { normalizeAnswer } from '@rules/normalize-answer'

import { packDate, phrase } from '../../__mocks__'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'

jest.mock('@utils/logging')

describe('missingVowelsGenerator', () => {
  // A seeded generator rather than a constant. A constant random source is degenerate here: the
  // respacing jitter moves a letter only when it draws two different chunk indices, so a constant
  // never moves anything and the retry loop redraws the identical failing split every attempt.
  const seeded = (seed: number): (() => number) => {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  const generate = (difficulty = 3, random = seeded(31)) =>
    missingVowelsGenerator.generate(packDate, difficulty as never, phrase, undefined, random)

  describe('registration', () => {
    it('declares one difficulty per puzzle', () => {
      expect(missingVowelsGenerator.difficulties).toHaveLength(missingVowelsGenerator.countPerDay)
    })

    // Four a day, per the system design's launch distribution.
    it('generates four a day', () => {
      expect(missingVowelsGenerator.countPerDay).toBe(4)
    })

    // No inRequest grade by construction: a phrase generator's input comes from a model call, so
    // it only ever runs in the async builder.
    it('declares no inRequest grade', () => {
      expect(missingVowelsGenerator).not.toHaveProperty('inRequest')
    })
  })

  describe('generate', () => {
    it('builds a puzzle from a corpus phrase', async () => {
      const puzzle = await generate()

      expect(puzzle.type).toBe('missingvowels')
      expect(puzzle.id).toMatch(/^2026-06-15:missingvowels:[0-9a-f]+$/)
      expect(puzzle.data.answer).toEqual(phrase.text)
    })

    // The displayed string must hold exactly the answer's consonants -- nothing added, removed, or
    // reordered -- or the puzzle is unsolvable rather than hard.
    it.each([1, 2, 3, 4, 5])('displays exactly the answer consonants at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      const expected = normalizeAnswer(puzzle.data.answer).replace(/[AEIOU]/g, '')
      expect(puzzle.data.displayed.replace(/ /g, '')).toEqual(expected)
    })

    it('never displays a vowel', async () => {
      const puzzle = await generate()

      expect(puzzle.data.displayed).not.toMatch(/[AEIOU]/)
    })

    // The secondary dial. Row-for-row from the design table: generous category becomes shown, weak
    // category becomes hidden. Hiding is a harder jump than weakening, and it REMOVES a free tier
    // rather than being cushioned by the ladder -- rung 1 is a narrowing of the category, so on a
    // hidden-category puzzle the player pays a rung for strictly more than the category.
    it.each([1, 2, 4])('shows the category at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      expect(puzzle.data.category).toEqual(phrase.category)
    })

    // Difficulty 5 is never generated -- difficulties is [1, 2, 3, 4] against countPerDay 4 -- so
    // hidden fires on exactly one of the four Missing Vowels puzzles a day. Row 5 is asserted for
    // completeness.
    it.each([3, 5])('hides the category at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      expect(puzzle.data.category).toBeUndefined()
    })

    // Without this the entire UI half of this work is dead: PhrasePuzzleData promises hints on every
    // phrase-derived puzzle, and this is the only generator that can keep the promise today.
    // WRAPPED, not passed through. A Phrase carries three bare strings; the wire carries three
    // { text } rungs, the same shape goFigure ships, so one renderer can read both. Asserted as a
    // literal rather than as toHintLadder(phrase.hints), so a bug inside the helper cannot make this
    // agree with itself.
    it('wraps the phrase hints into the wire hint shape', async () => {
      const puzzle = await generate()

      expect(puzzle.data.hints).toEqual([
        { text: phrase.hints[0] },
        { text: phrase.hints[1] },
        { text: phrase.hints[2] },
      ])
    })

    it('sets estimatedSeconds inside the catalog range for the type', async () => {
      const easiest = await generate(1)
      const hardest = await generate(5)

      expect(easiest.estimatedSeconds).toBe(60)
      expect(hardest.estimatedSeconds).toBe(120)
    })
  })
})
