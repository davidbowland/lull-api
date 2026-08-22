import { enumerateSolutions, Solution } from '@generators/gofigure/enumerate'
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

    // THE WIRE SHAPE, pinned as a whole key set rather than as a `not.toHaveProperty`, because the
    // set catches a field being ADDED silently as well as one failing to be removed.
    //
    // `operatorTuples` was on this list. It shipped so lull-ui could decide the hedge from
    // `operatorTuples.length > 1`; the backend authors the hedged sentence again, so nothing reads
    // it and sending it would be shipping the same fact twice.
    it('ships exactly the five data fields, with no operator tuple list', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 3, seededRandom(41), shortId)

      expect(Object.keys(puzzle.data).sort()).toEqual(['acceptedSolutions', 'bank', 'goal', 'hints', 'operators'])
    })

    // `operatorTuples` no longer ships -- it existed so lull-ui could decide the hedge, and the
    // hedge is authored here again -- but the fact it carried is now load-bearing INSIDE this repo,
    // so it has to keep being checked. TWO derivations of "how many operator arrangements reach this
    // goal" survive: enumerate.ts's authoritative dedupe over real Operator[] tuples, and the
    // digit-strip that hints.ts counts to decide the hedge. Nothing else compares them, and if they
    // ever part company the copy hedges on the wrong puzzles with the whole suite green.
    //
    // Re-enumerated from the puzzle's OWN bank and operators rather than captured from the
    // generator, so this reads the same Solution the difficulty was graded off.
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

        // SET EQUALITY, not just matching sizes. Comparing counts alone passes whenever the two
        // derivations happen to find the same NUMBER of tuples while disagreeing about which ones,
        // and the hedge is read off one of them while the ladder is built from the other.
        expect(fromSolutions).toEqual(new Set(solution.operatorTuples.map((tuple) => tuple.join(''))))
      },
    )

    // Difficulties 4 and 5 are DEFINED as the one-tuple band by difficultyForSolution, and the
    // unhedged copy is an UNQUALIFIED claim -- "The 2nd operator from the left is X" -- that is only
    // honest on a puzzle whose tuple is unique. buildHints reads that off the solution list rather
    // than off the difficulty, so this asserts the two still coincide end to end on a REAL puzzle.
    // A re-banding that moved difficultyForSolution's boundary and updated its own tests in step
    // would break here and nowhere else.
    it.each([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ])('hedges the hint copy at difficulty %s: %s', async (difficulty, hedged) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const [first, ...rest] = puzzle.data.hints.map((hint) => hint.text)

      expect(first.startsWith('One winning answer has ')).toBe(hedged)
      expect(rest.every((text) => text.startsWith('The same answer has '))).toBe(hedged)
      // The other half of the band, asserted on every rung: "from the left" is what stops the
      // unhedged ordinal colliding with the hint bar's decimal list marker.
      expect(puzzle.data.hints.every((hint) => hint.text.includes('operator from the left'))).toBe(!hedged)
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
          .sort((left, right) => left.metadata.slot - right.metadata.slot)
          .map((hint) => hint.metadata.operator)
          .join('')

        expect(puzzle.data.hints).toHaveLength(3)
        expect(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, ''))).toContain(tuple)
      },
    )

    // The assertion above is order-independent and true of a tuple taken from ANY single accepted
    // solution, so on its own it cannot see the way this one call site can be wrong:
    //
    //   buildHints([expressions[0]]) -- the canonical-tuple rule is discarded at the one site that
    //                                   runs in production, and the hedge with it, because a lone
    //                                   expression is trivially one tuple
    //
    // Comparing against buildHints itself is what closes it: the argument is the thing under test,
    // and hints.test.ts already pins what buildHints does with it. The difficulty is no longer part
    // of that argument list -- see hints.ts -- so this now pins the WHOLE solution list reaching it.
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

    // Pinned separately from the equality above so a failure says WHICH half broke, and stated in
    // terms of DIFFICULTY even though buildHints no longer sees one. That is the point: the slot
    // order is read off the tuple count now, so this is the end-to-end check that a generated
    // difficulty-4 puzzle really does come out on the one-tuple order.
    it.each([
      [1, [0, 1, 2]],
      [2, [0, 1, 2]],
      [3, [0, 1, 2]],
      [4, [1, 0, 2]],
      [5, [1, 0, 2]],
    ])('emits the difficulty-%s slot order on a generated puzzle', async (difficulty, slots) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual(slots)
    })

    // The claim underneath the hedge test above, isolated so a failure says which half broke. The
    // unhedged copy is an UNQUALIFIED assertion -- "The 2nd operator from the left is X" -- with no
    // "one winning answer" to soften it, and it is only honest on a puzzle whose operator tuple
    // really is unique. buildHints reads that off the solution list, so what this pins is
    // difficultyForSolution's end of the deal: that a puzzle it grades 4 or 5 is genuinely
    // one-tuple, and that a re-band cannot quietly send a multi-tuple puzzle down the unhedged path.
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
    // GENUINELY DIFFERENT tuples, the index read as a base-4 numeral, rather than one tuple repeated
    // n times. difficultyForSolution only reads the length, so a repeated tuple would pass every row
    // below -- but enumerateSolutions dedupes by joined tuple and so cannot emit that shape, and a
    // fixture the producer cannot produce is how a test starts describing a thing that does not
    // exist. Distinct through index 63, which covers the 20 this table asks for.
    const allOperators: Operator[] = ['+', '-', '*', '/']
    const distinctTuples = (count: number): Operator[][] =>
      Array.from({ length: count }, (_value, index) => [
        allOperators[(index >> 4) % 4],
        allOperators[(index >> 2) % 4],
        allOperators[index % 4],
      ])

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
    ])('rates %s', (_description, tupleCount, expressionCount, expected) => {
      const expressions = Array.from({ length: expressionCount as number }, (_value, index) => `expression-${index}`)

      expect(difficultyForSolution({ expressions, operatorTuples: distinctTuples(tupleCount as number) })).toBe(
        expected,
      )
    })
  })
})
