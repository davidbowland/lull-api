import { normalizeAnswer } from '@rules/normalize-answer'

import { corpus, corpusEntries, packDate } from '../../__mocks__'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'
import { getLatestCorpus, markCorpusEntriesUsed } from '@services/dynamodb'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('missingVowelsGenerator', () => {
  beforeAll(() => {
    jest.mocked(getLatestCorpus).mockResolvedValue(corpus)
  })

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
    missingVowelsGenerator.generate(packDate, difficulty as never, random)

  describe('registration', () => {
    it('declares one difficulty per puzzle', () => {
      expect(missingVowelsGenerator.difficulties).toHaveLength(missingVowelsGenerator.countPerDay)
    })

    // Four a day, per the system design's launch distribution.
    it('generates four a day', () => {
      expect(missingVowelsGenerator.countPerDay).toBe(4)
    })

    // Measured, not assumed -- the system design requires this be graded per type rather than
    // inherited from a tier. No model call, and one corpus read per generate.
    it('is graded fast enough to run inside a request', () => {
      expect(missingVowelsGenerator.inRequest).toBe(true)
    })
  })

  describe('generate', () => {
    it('builds a puzzle from a corpus phrase', async () => {
      const puzzle = await generate()

      expect(puzzle.type).toBe('missingvowels')
      expect(puzzle.id).toMatch(/^2026-06-15:missingvowels:[0-9a-f]+$/)
      expect(corpusEntries.map((entry) => entry.text)).toContain(puzzle.data.answer)
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

    // The category-specificity dial. A hard puzzle gets the weaker hint.
    it.each([
      [1, 'categorySpecific'],
      [2, 'categorySpecific'],
      [3, 'categoryBroad'],
      [4, 'categorySpecific'],
      [5, 'categoryBroad'],
    ])('shows the %s difficulty the %s label', async (difficulty, field) => {
      const puzzle = await generate(difficulty as number)

      const entry = corpusEntries.find((candidate) => candidate.text === puzzle.data.answer)
      expect(puzzle.data.category).toEqual(entry?.[field as 'categoryBroad' | 'categorySpecific'])
    })

    it('sets estimatedSeconds inside the catalog range for the type', async () => {
      const easiest = await generate(1)
      const hardest = await generate(5)

      expect(easiest.estimatedSeconds).toBe(60)
      expect(hardest.estimatedSeconds).toBe(120)
    })

    // Marked as consumed so a later pack drawing from the same fallback corpus skips it.
    it('marks the chosen entry used', async () => {
      const puzzle = await generate()

      const entry = corpusEntries.find((candidate) => candidate.text === puzzle.data.answer)
      expect(markCorpusEntriesUsed).toHaveBeenCalledWith(corpus.date, [entry?.id])
    })

    it('never chooses an entry already used', async () => {
      const used = corpusEntries.slice(0, 4).map((entry) => entry.id)
      jest.mocked(getLatestCorpus).mockResolvedValueOnce({ ...corpus, usedIds: used })

      const puzzle = await generate()

      expect(puzzle.data.answer).toEqual(corpusEntries[4].text)
    })

    // A missing corpus costs one puzzle through createPack's per-generate catch, which is exactly
    // the isolation the pack design exists for. It must never take the whole pack down.
    it('throws when no corpus is stored at all', async () => {
      jest.mocked(getLatestCorpus).mockResolvedValueOnce(undefined)

      await expect(generate()).rejects.toThrow('no corpus')
    })

    it('throws when every entry is already used', async () => {
      jest.mocked(getLatestCorpus).mockResolvedValueOnce({
        ...corpus,
        usedIds: corpusEntries.map((entry) => entry.id),
      })

      await expect(generate()).rejects.toThrow('no unused')
    })

    // The generator reads the corpus itself because the Generator contract passes only a date and
    // a difficulty. One read per puzzle is what keeps that contract unchanged for every other type.
    it('reads the corpus on every call', async () => {
      await generate()

      expect(getLatestCorpus).toHaveBeenCalled()
    })
  })
})
