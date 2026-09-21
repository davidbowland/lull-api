import { enumerateSolutions, Solution } from '@generators/gofigure/enumerate'
import { evaluateLeftToRight } from '@generators/gofigure/evaluate'
import { difficultyForSolution, goFigureGenerator, operatorCost } from '@generators/gofigure/generator'
import { buildHints } from '@generators/gofigure/hints'
import { Difficulty, Operator } from '@types'

jest.mock('@utils/logging')

// A seeded Lehmer generator. A constant source is a trap: () => 0 draws bank [1,1,1,1], which
// reaches no goal at difficulty 3, 4, or 5 -- see the redraw-cap test below.
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
      expect(goFigureGenerator.countPerDay).toBe(3)
      // From the pack-wide count table: goFigure is self-contained, so it covers a band without a phrase.
      expect(goFigureGenerator.difficulties).toEqual([2, 4, 5])
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

    // The whole key set rather than a `not.toHaveProperty`, so a field added silently also fails here.
    // `operatorTuples` shipped so lull-ui could decide the hedge; the backend authors that sentence now.
    it('ships exactly the five data fields, with no operator tuple list', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 3, seededRandom(41), shortId)

      expect(Object.keys(puzzle.data).sort()).toEqual(['acceptedSolutions', 'bank', 'goal', 'hints', 'operators'])
    })

    // Two derivations of "how many arrangements reach this goal" survive -- enumerate.ts's dedupe and the
    // digit-strip hints.ts counts for the hedge -- and nothing else compares them.
    it.each([1, 2, 3, 4, 5])(
      'strips digits to the same tuple count the enumerator deduped to, difficulty %s',
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )
        const solution = enumerateSolutions(puzzle.data.bank, puzzle.data.operators).get(puzzle.data.goal) as Solution
        const fromSolutions = new Set(
          puzzle.data.acceptedSolutions.map((expression) => expression.replace(/[0-9]/g, '')),
        )

        // Set equality, not matching sizes: equal counts over different tuples split hedge from ladder.
        expect(fromSolutions).toEqual(new Set(solution.operatorTuples.map((tuple) => tuple.join(''))))
      },
    )

    // Keyed on the tuple count, not on the difficulty: a one-tuple puzzle reachable only by cheap
    // operators is graded 2, and a difficulty-4 puzzle may have one tuple or two, so a table of literal
    // booleans per difficulty would assert something false.
    it.each([1, 2, 3, 4, 5])(
      'hedges the hint copy only when the operator tuple is not unique, difficulty %s',
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )
        const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))
        const hedged = tuples.size > 1
        const [first, ...rest] = puzzle.data.hints.map((hint) => hint.text)

        expect(first.startsWith('One winning answer has ')).toBe(hedged)
        expect(rest.every((text) => text.startsWith('The same answer has '))).toBe(hedged)
        // "From the left" is what stops the unhedged ordinal colliding with the hint bar's list marker.
        expect(puzzle.data.hints.every((hint) => hint.text.includes('operator from the left'))).toBe(!hedged)
      },
    )

    it.each([1, 2, 3, 4, 5])(
      'spends three hint rungs on one real operator tuple at difficulty %s',
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )

        // Sorted by slot: rungs come out 1, 0, 2 on some puzzles, so rung order would scramble the tuple.
        const tuple = [...puzzle.data.hints]
          .sort((left, right) => left.metadata.slot - right.metadata.slot)
          .map((hint) => hint.metadata.operator)
          .join('')

        expect(puzzle.data.hints).toHaveLength(3)
        expect(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, ''))).toContain(tuple)
      },
    )

    // The assertion above holds for a tuple taken from any single accepted solution, so it cannot catch
    // `buildHints([expressions[0]])`. Comparing against buildHints pins the whole list reaching it.
    it.each([1, 2, 3, 4, 5])(
      "hands buildHints this puzzle's entire solution list at difficulty %s",
      async (difficulty) => {
        const puzzle = await goFigureGenerator.generate(
          '2026-06-15',
          difficulty as Difficulty,
          seededRandom(41),
          shortId,
        )

        expect(puzzle.data.hints).toEqual(buildHints(puzzle.data.acceptedSolutions))
      },
    )

    // Separate from the equality above so a failure says which half broke, and keyed on the tuple count.
    it.each([1, 2, 3, 4, 5])('emits the slot order matching the tuple count at difficulty %s', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual(tuples.size === 1 ? [1, 0, 2] : [0, 1, 2])
    })

    // Five only: it is the one-idea band and an idea never spans two tuples. Measured over every bank
    // multiset 1-9 x 4, difficulty 5 is 100% one-tuple and difficulty 4 only 61%.
    it('emits the one-tuple slot order at difficulty 5', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 5, seededRandom(41), shortId)

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual([1, 0, 2])
    })

    // The grader's end of the deal: a puzzle it grades 5 really is one-tuple, so the unhedged copy is honest.
    it('draws difficulty 5 from a puzzle whose operator tuple really is unique', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 5, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(tuples.size).toBe(1)
    })

    // A hard band must not be reachable by typing cheap operators: without the cap "7+7+7+7" ships as a 4.
    // A cost floor, not "spans both families": "+-+" is single-family and costs 3 while "++*" costs 2.
    it.each([
      [4, 3],
      [5, 4],
    ])('draws difficulty %s only where every route costs at least %s', async (difficulty, floor) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = puzzle.data.acceptedSolutions.map((solution) => [...solution.replace(/[0-9]/g, '')] as Operator[])

      expect(tuples.every((tuple) => operatorCost(tuple) >= floor)).toBe(true)
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
      // () => 0 draws [1,1,1,1] every time, which reaches difficulty 1 and 2 only, so 3 exhausts the cap.
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

  describe('operatorCost', () => {
    // Which operators, not how many kinds: rows are ordered by the answer, so the escalation is readable.
    it.each([
      [['+', '+', '+'], 0],
      [['*', '*', '*'], 1],
      [['-', '-', '-'], 2],
      [['+', '+', '*'], 2],
      [['*', '+', '+'], 2],
      [['+', '-', '+'], 3],
      [['*', '-', '*'], 3],
      [['/', '/', '/'], 4],
      [['+', '-', '*'], 4],
      [['+', '+', '/'], 5],
      [['*', '/', '*'], 5],
      [['/', '-', '*'], 6],
    ])('costs %s at %s', (tuple, cost) => {
      expect(operatorCost(tuple as Operator[])).toBe(cost)
    })

    // Neither term may be dropped: without the max "+-+" and "+*+" tie; without variety, "---" and "-+-".
    it('prices a harder operator above an easier one at the same variety', () => {
      expect(operatorCost(['+', '*', '+'])).toBeLessThan(operatorCost(['+', '-', '+']))
      expect(operatorCost(['+', '-', '+'])).toBeLessThan(operatorCost(['+', '/', '+']))
    })

    it('prices more distinct operators above fewer at the same hardest operator', () => {
      expect(operatorCost(['-', '-', '-'])).toBeLessThan(operatorCost(['-', '+', '-']))
    })
  })

  describe('difficultyForSolution', () => {
    // One tuple per cap tier, named by the cap it produces rather than by its shape: UNCAPPED holds a
    // '/' and costs 6, and CAP_FOUR is single-family yet dearer than the cross-family "++*".
    const UNCAPPED: Operator[] = ['/', '-', '*']
    const CAP_FOUR: Operator[] = ['+', '-', '+']
    const CAP_THREE: Operator[] = ['+', '+', '*']
    const CAP_TWO: Operator[] = ['+', '+', '+']

    // The grader counts these and never reads them, so opaque strings keep the count from implying more.
    const ideas = (count: number): string[] => Array.from({ length: count }, (_value, index) => `idea-${index}`)
    const expressions = (count: number): string[] =>
      Array.from({ length: count }, (_value, index) => `expression-${index}`)

    it.each([
      // Idea count, ungated: every added route makes the goal easier to stumble into.
      ['a single idea', 1, UNCAPPED, 5],
      ['two ideas', 2, UNCAPPED, 4],
      ['three ideas', 3, UNCAPPED, 3],
      ['four ideas', 4, UNCAPPED, 3],
      ['five ideas', 5, UNCAPPED, 2],
      ['nine ideas', 9, UNCAPPED, 2],
      ['ten ideas', 10, UNCAPPED, 1],
      ['many ideas', 40, UNCAPPED, 1],
      // The cap, tier by tier, on a solution the idea count alone would call 5.
      ['a single idea reachable by a subtraction and a plus', 1, CAP_FOUR, 4],
      ['a single idea reachable by two pluses and a times', 1, CAP_THREE, 3],
      ['a single idea reachable by three pluses', 1, CAP_TWO, 2],
      // A lone all-plus route is the first thing anybody tries, and uniqueness cannot make it hard.
      ['two ideas reachable by three pluses', 2, CAP_TWO, 2],
      // The cap only ever lowers: ten ideas is difficulty 1 and a hard operator cannot lift it.
      ['ten ideas reachable only by a division', 10, UNCAPPED, 1],
      ['five ideas reachable by a subtraction and a plus', 5, CAP_FOUR, 2],
    ])('rates %s', (_description, ideaCount, tuple, expected) => {
      const solution = { expressions: expressions(ideaCount), ideas: ideas(ideaCount), operatorTuples: [tuple] }

      expect(difficultyForSolution(solution)).toBe(expected)
    })

    // The expression count measures how permutable the operands are, not anything a player does: over
    // every bank multiset 1-9 x 4, 99% of goals with a unique operator tuple are a single idea.
    it('grades on ideas alone, whatever the expression count', () => {
      const one = { expressions: expressions(1), ideas: ideas(1), operatorTuples: [UNCAPPED] }
      const many = { expressions: expressions(88), ideas: ideas(1), operatorTuples: [UNCAPPED] }

      expect(difficultyForSolution(many)).toBe(difficultyForSolution(one))
    })

    // The original game's puzzle, goal 154 from bank 6,9,7,7: six expressions, one idea, tuple "++*" of
    // cheap operators. One idea puts it at 5 and the operator cap brings it to 3.
    it("rates the original game's puzzle on its one idea and its cheap operators", () => {
      const solution = { expressions: expressions(6), ideas: ideas(1), operatorTuples: [CAP_THREE] }

      expect(difficultyForSolution(solution)).toBe(3)
    })

    // The cap reads every tuple: enumerateSolutions sorts on raw ASCII, where '*' precedes '+', so the
    // easy all-plus arrangement is routinely not the one at index 0.
    it('caps on the cheapest tuple wherever it sits in the list', () => {
      const solution = { expressions: expressions(1), ideas: ideas(1), operatorTuples: [UNCAPPED, CAP_TWO] }

      expect(difficultyForSolution(solution)).toBe(2)
    })
  })
})
