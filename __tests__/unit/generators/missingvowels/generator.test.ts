import { normalizeAnswer } from '@rules/normalize-answer'

import { packDate, phrase } from '../../__mocks__'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'

jest.mock('@utils/logging')

describe('missingVowelsGenerator', () => {
  // A seeded generator: a constant source is degenerate here, since the respacing jitter moves a letter
  // only when it draws two different chunk indices, so the retry loop would redraw the same split.
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

    // Three a day, from the pack-wide count table: the cheapest corpus consumer, so a band costs one phrase.
    it('generates three a day', () => {
      expect(missingVowelsGenerator.countPerDay).toBe(3)
    })

    // A phrase generator's input comes from a model call, so it only ever runs in the async builder.
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

    // The displayed string must hold exactly the answer's consonants, or the puzzle is unsolvable.
    it.each([1, 2, 3, 4, 5])('displays exactly the answer consonants at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      const expected = normalizeAnswer(puzzle.data.answer).replace(/[AEIOU]/g, '')
      expect(puzzle.data.displayed.replace(/ /g, '')).toEqual(expected)
    })

    it('never displays a vowel', async () => {
      const puzzle = await generate()

      expect(puzzle.data.displayed).not.toMatch(/[AEIOU]/)
    })

    // The secondary dial, row-for-row from the design table: generous category shown, weak one hidden.
    it.each([1, 2, 4])('shows the category at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      expect(puzzle.data.category).toEqual(phrase.category)
    })

    // Neither row ships here (difficulties is [1, 2, 4]), but the dial is shared by every phrase type.
    it.each([3, 5])('hides the category at difficulty %s', async (difficulty) => {
      const puzzle = await generate(difficulty)

      expect(puzzle.data.category).toBeUndefined()
    })

    // The only phrase generator that ships a ladder: bare strings in, { text } rungs out. Asserted as a
    // literal rather than through toHintLadder, so a bug in the helper cannot make this agree with itself.
    it('wraps the phrase hints into the wire hint shape', async () => {
      const puzzle = await generate()

      expect(puzzle.data.hints).toEqual([
        { text: phrase.hints[0] },
        { text: phrase.hints[1] },
        { text: phrase.hints[2] },
      ])
    })

    // Only bands this type ships. Two points determine both constants (60 = BASE, 75 - 60 = PER), so
    // pinning an unshipped band would describe behavior the type does not have.
    it.each([
      [1, 60],
      [2, 75],
    ])('estimates difficulty %i at %i seconds of play', async (difficulty, seconds) => {
      expect((await generate(difficulty)).estimatedSeconds).toBe(seconds)
    })

    // Holds the bands asserted above to the bands actually shipped, so the pins cannot drift off the type.
    it('pins every shipped difficulty and no other', () => {
      expect(missingVowelsGenerator.difficulties).toEqual([1, 2, 4])
    })
  })
})
