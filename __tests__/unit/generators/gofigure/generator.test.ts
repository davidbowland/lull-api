import { evaluateLeftToRight } from '@generators/gofigure/evaluate'
import { difficultyForSolution, goFigureGenerator } from '@generators/gofigure/generator'
import { buildHints } from '@generators/gofigure/hints'
import { Difficulty, Operator } from '@types'

jest.mock('@utils/logging')

// A seeded Lehmer generator. A constant source is a trap: () => 0 draws bank [1,1,1,1], which
// reaches no goal at difficulty 2, 3, or 4 -- see the redraw-cap test below.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

const shortId = () => 'abc123de'

describe('generator', () => {
  describe('goFigureGenerator', () => {
    it('declares one difficulty per puzzle', () => {
      expect(goFigureGenerator.type).toBe('gofigure')
      expect(goFigureGenerator.countPerDay).toBe(5)
      expect(goFigureGenerator.difficulties).toEqual([1, 2, 3, 4, 5])
      expect(goFigureGenerator.difficulties).toHaveLength(goFigureGenerator.countPerDay)
    })

    it('is graded fast enough to run inside a request', () => {
      expect(goFigureGenerator.inRequest).toBe(true)
    })
  })

  describe('generate', () => {
    it('builds an id from the date and type with an opaque, non-positional suffix', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 3, seededRandom(7), shortId)

      expect(puzzle.id).toBe('2026-06-15:gofigure:abc123de')
      expect(puzzle.type).toBe('gofigure')
    })

    it.each([
      [1, 60],
      [2, 90],
      [3, 120],
      [4, 150],
      [5, 180],
    ])('generates difficulty %s with estimatedSeconds %s', async (difficulty, estimatedSeconds) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(11), shortId)

      expect(puzzle.difficulty).toBe(difficulty)
      expect(puzzle.estimatedSeconds).toBe(estimatedSeconds)
    })

    it('draws a bank of four digits between 1 and 9 and offers every operator', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 3, seededRandom(23), shortId)

      expect(puzzle.data.bank).toHaveLength(4)
      expect(puzzle.data.bank.every((digit) => digit >= 1 && digit <= 9)).toBe(true)
      expect(puzzle.data.operators).toEqual(['+', '-', '*', '/'])
    })

    it.each([1, 2, 3, 4, 5])('offers only solutions that reach the goal at difficulty %s', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const evaluated = puzzle.data.acceptedSolutions.map((solution) => {
        const operands = solution.split(/[-+*/]/).map(Number)
        const operators = [...solution].filter((token) => '+-*/'.includes(token)) as Operator[]
        return evaluateLeftToRight(operands, operators)
      })

      expect(puzzle.data.acceptedSolutions.length).toBeGreaterThan(0)
      expect(evaluated).toEqual(evaluated.map(() => puzzle.data.goal))
    })

    it.each([1, 2, 3, 4, 5])(
      'spends three hint rungs on one real operator tuple at difficulty %s',
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )

        // SORTED BY SLOT ascending, never read in rung order. On difficulties 4 and 5 the rungs come
        // out slots 1, 0, 2, so reading them as-is yields the tuple scrambled and this assertion would
        // fail against a perfectly correct ladder.
        //
        // This is the property that makes a spent ladder SOLVABLE rather than merely plausible: three
        // rungs a player acts on that no accepted solution satisfies are worse than no rungs at all.
        const tuple = [...puzzle.data.hints]
          .sort((left, right) => left.slot - right.slot)
          .map((hint) => hint.operator)
          .join('')

        expect(puzzle.data.hints).toHaveLength(3)
        expect(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, ''))).toContain(tuple)
      },
    )

    // The assertion above is order-independent and true of a tuple taken from ANY single accepted
    // solution, so on its own it cannot see the two ways this one call site can be wrong. Both
    // survived the whole suite until this test existed:
    //
    //   buildHints(expressions, 1)               -- every puzzle gets the easy band's slot order and
    //                                               the hedged copy, deleting the difficulty split
    //   buildHints([expressions[0]], difficulty) -- the canonical-tuple rule is discarded at the one
    //                                               site that runs in production
    //
    // Comparing against buildHints itself is what closes both: the arguments are the thing under
    // test, and hints.test.ts already pins what buildHints does with them.
    it.each([1, 2, 3, 4, 5])(
      'hands buildHints this puzzle and this difficulty at difficulty %s',
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )

        expect(puzzle.data.hints).toEqual(buildHints(puzzle.data.acceptedSolutions, difficulty as Difficulty))
      },
    )

    // Pinned separately from the equality above so a failure says WHICH half broke. The slot order
    // is decision 3 and the hedge is decision 5; they split at 4 for the same structural reason and
    // live in two tables that can drift apart.
    it.each([
      [1, [0, 1, 2], true],
      [2, [0, 1, 2], true],
      [3, [0, 1, 2], true],
      [4, [1, 0, 2], false],
      [5, [1, 0, 2], false],
    ])('emits the difficulty-%s slot order and hedging on a generated puzzle', async (difficulty, slots, hedged) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)

      expect(puzzle.data.hints.map((hint) => hint.slot)).toEqual(slots)
      expect(puzzle.data.hints[0].text.startsWith('One winning answer')).toBe(hedged)
    })

    // The unhedged copy is an UNQUALIFIED claim -- "The 2nd operator from the left is X" -- with no
    // "one winning answer" to soften it. That is only honest because difficulties 4 and 5 are
    // exactly the one-tuple puzzles, a fact owned by difficultyForSolution and merely mirrored by
    // HEDGED_BY_DIFFICULTY. Nothing tied the two together: a deliberate re-band that updated
    // difficultyForSolution and its own tests in step would leave every difficulty-4 hint asserting
    // something false about solutions it does not describe, with the whole suite green.
    it.each([4, 5])('draws difficulty %s from a puzzle whose operator tuple really is unique', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(tuples.size).toBe(1)
    })

    it('returns the same puzzle for the same random source', async () => {
      const first = await goFigureGenerator.generate('2026-06-15', 4, seededRandom(3), shortId)
      const second = await goFigureGenerator.generate('2026-06-15', 4, seededRandom(3), shortId)

      expect(first).toEqual(second)
    })

    it('returns a different puzzle for a different random source', async () => {
      const first = await goFigureGenerator.generate('2026-06-15', 4, seededRandom(3), shortId)
      const second = await goFigureGenerator.generate('2026-06-15', 4, seededRandom(9999), shortId)

      expect(first.data).not.toEqual(second.data)
    })

    it('throws at the redraw cap rather than retrying forever', async () => {
      // () => 0 draws [1,1,1,1] every time, which reaches difficulty 5 and 1 only
      await expect(goFigureGenerator.generate('2026-06-15', 3, () => 0, shortId)).rejects.toThrow(
        'Could not draw a goFigure bank reaching difficulty 3 in 100 attempts',
      )
    })

    it('defaults its random source and id source', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 1)

      expect(puzzle.id).toMatch(/^2026-06-15:gofigure:[0-9a-f]+$/)
      expect(puzzle.difficulty).toBe(1)
    })
  })

  describe('difficultyForSolution', () => {
    it.each([
      ['one tuple and one expression', 1, 1, 5],
      ['one tuple and two expressions', 1, 2, 5],
      ['one tuple and three expressions', 1, 3, 4],
      ["the original game's puzzle: one tuple and six expressions", 1, 6, 4],
      ['two tuples', 2, 2, 3],
      ['three tuples', 3, 5, 2],
      ['four tuples', 4, 9, 2],
      ['five tuples', 5, 5, 1],
      ['many tuples', 20, 20, 1],
    ])('rates %s', (_description, operatorTuples, expressionCount, expected) => {
      const expressions = Array.from({ length: expressionCount as number }, (_value, index) => `expression-${index}`)

      expect(difficultyForSolution({ expressions, operatorTuples: operatorTuples as number })).toBe(expected)
    })
  })
})
