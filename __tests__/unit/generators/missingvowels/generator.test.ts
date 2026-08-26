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

    // Three a day, from the pack-wide count table. This type is corpus-bounded and the CHEAPEST of
    // the corpus consumers -- isUsablePhrase is a six-consonant floor with no difficulty term in it
    // -- so a band added here costs one phrase and carries no per-band supply risk.
    it('generates three a day', () => {
      expect(missingVowelsGenerator.countPerDay).toBe(3)
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

    // NEITHER row is generated: difficulties is [1, 2, 4] and CATEGORY_HIDDEN_BY_DIFFICULTY hides
    // only at 3 and 5. So this type still never hides its category, and the hidden-category
    // experience belongs to Cryptogram at band 3 and Phrazle at 3 and 5. Both rows are asserted for
    // completeness -- the dial is shared by every phrase type, so what it does at 3 and 5 is this
    // module's behavior whether or not this type asks for it.
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

    // 60 / 75, over the bands this type SHIPS -- and it ships two of them now, not four. An earlier
    // version of this pinned difficulty 5, which was not in `difficulties` then either; the pair
    // still caught a mutation to secondsPerDifficulty, but the only measurement holding that
    // constant in place was taken at a band no pack will ever contain, so the assertion described
    // behavior the type does not have. Two shipped points still determine both constants uniquely
    // (60 = BASE, 75 - 60 = PER), so nothing is lost by dropping 90 and 105 along with it. 120 is
    // the catalog's high end, which is what PER was DERIVED from ((120 - 60) / 4 = 15); it is not an
    // output. The top shipped band is 75.
    it.each([
      [1, 60],
      [2, 75],
    ])('estimates difficulty %i at %i seconds of play', async (difficulty, seconds) => {
      expect((await generate(difficulty)).estimatedSeconds).toBe(seconds)
    })

    // And the bands asserted above are exactly the bands shipped, so the pins cannot drift off the
    // type the way the difficulty-5 pin did.
    it('pins every shipped difficulty and no other', () => {
      expect(missingVowelsGenerator.difficulties).toEqual([1, 2, 4])
    })
  })
})
