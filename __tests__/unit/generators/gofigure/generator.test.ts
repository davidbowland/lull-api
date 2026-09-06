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
      // The three ODD bands, from the pack-wide count table. goFigure is the only self-contained
      // type, so it is the only one that can cover a band without spending a phrase; the two corpus
      // consumers cover 2 and 4 between them.
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

    // The unhedged copy is an UNQUALIFIED claim -- "The 2nd operator from the left is X" -- that is
    // only honest on a puzzle whose tuple is unique. buildHints reads that off the solution list
    // rather than off the difficulty, so this asserts the two coincide end to end on a REAL puzzle.
    //
    // KEYED ON THE TUPLE COUNT, not on the difficulty. Difficulty 5 still IMPLIES a unique tuple --
    // it is the one-idea band and an idea never spans two tuples -- but nothing else does, in either
    // direction: a one-tuple puzzle reachable only by cheap operators is graded 2, and a difficulty-4
    // puzzle may have one tuple or two. Both must still print the copy their OWN tuple count earns.
    // A table of literal booleans per difficulty would assert something false about all three. The
    // surviving direction at 5 is pinned by its own test below.
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
        // The other half of the band, asserted on every rung: "from the left" is what stops the
        // unhedged ordinal colliding with the hint bar's decimal list marker.
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

    // Pinned separately from the equality above so a failure says WHICH half broke. Keyed on the
    // tuple count for the same reason the hedge test above is: a one-tuple puzzle can carry any
    // difficulty from 2 up, and it takes the one-tuple slot order at every one of them.
    it.each([1, 2, 3, 4, 5])('emits the slot order matching the tuple count at difficulty %s', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual(tuples.size === 1 ? [1, 0, 2] : [0, 1, 2])
    })

    // The literal end-to-end pin the two derived tests above deliberately gave up. FIVE ONLY, and
    // that is what grading on ideas rather than tuples cost: difficulty 5 is exactly the one-idea
    // band and an idea never spans two tuples, so 5 still implies a unique tuple, while 4 is the
    // TWO-idea band and those two ideas may or may not share a tuple. Measured over every bank
    // multiset 1-9 x 4, difficulty 5 is 100% one-tuple and difficulty 4 is 61%, so asserting this
    // constant at 4 would fail on real puzzles rather than catch anything.
    it('emits the one-tuple slot order at difficulty 5', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 5, seededRandom(41), shortId)

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual([1, 0, 2])
    })

    // The claim underneath the hedge test above, isolated so a failure says which half broke. The
    // unhedged copy is an UNQUALIFIED assertion -- "The 2nd operator from the left is X" -- with no
    // "one winning answer" to soften it, and it is only honest on a puzzle whose operator tuple
    // really is unique. buildHints reads that off the solution list, so what this pins is
    // difficultyForSolution's end of the deal: that a puzzle it grades 5 is genuinely one-tuple, and
    // that a re-band cannot quietly send a multi-tuple puzzle down the unhedged path.
    //
    // FIVE ONLY, for the reason given on the slot-order test above: 4 is the two-idea band, and two
    // ideas need not share a tuple.
    it('draws difficulty 5 from a puzzle whose operator tuple really is unique', async () => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', 5, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(tuples.size).toBe(1)
    })

    // difficultyForSolution's OTHER end of the deal, and the whole reason the operator cap exists. A
    // unique tuple used to be sufficient for the hard bands, which let "7+7+7+7" -- one arrangement,
    // and the first arrangement anybody tries -- ship as difficulty 4. A band the shelf calls hard
    // must not be reachable by typing cheap operators, so both shipped hard bands are asserted here
    // on a REAL generated puzzle rather than on a fixture.
    //
    // ASSERTED AS A COST FLOOR rather than as "spans both families", which is what the mix
    // predecessor of this cap could say. The families are the wrong axis: "+-+" is single-family and
    // costs 3, while "++*" spans both and costs 2, so a family test would admit the cheaper tuple
    // and reject the dearer one. Measured over every bank multiset 1-9 x 4, 0.3% of difficulty-4
    // goals have a single-family cheapest route -- rare, but real, and correct.
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
      // () => 0 draws [1,1,1,1] every time, which reaches difficulty 1 and 2 only: goals 1 and 2
      // land at 1 on twenty and fifteen ideas, and goals 3 and 4 are capped at 2 by their operators.
      // Goal 4 is the shape both halves of the grader have to agree on -- "1+1+1+1" is one idea, so
      // the ambiguity grade alone would call it a 5, and the cost cap is what puts it where a player
      // would.
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
    // WHICH operators, not how many kinds. The predecessor of this function sorted tuples into
    // same/family/cross and could not tell "+" from "/", so "++*" -- two of the three easiest
    // operators -- scored the same as "-/*". The rows below are ordered by the answer so the
    // escalation is readable: a repeated "+" costs nothing, and every step away from it costs.
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

    // The two halves of the sum, isolated. A tuple can be expensive because it reaches a hard
    // operator OR because it uses several, and neither term may be dropped: without the max, "+-+"
    // and "+*+" would tie; without the variety term, "---" and "-+-" would.
    it('prices a harder operator above an easier one at the same variety', () => {
      expect(operatorCost(['+', '*', '+'])).toBeLessThan(operatorCost(['+', '-', '+']))
      expect(operatorCost(['+', '-', '+'])).toBeLessThan(operatorCost(['+', '/', '+']))
    })

    it('prices more distinct operators above fewer at the same hardest operator', () => {
      expect(operatorCost(['-', '-', '-'])).toBeLessThan(operatorCost(['-', '+', '-']))
    })
  })

  describe('difficultyForSolution', () => {
    // One tuple per cap tier, named by the cap it produces rather than by its shape, because the
    // shape is no longer the point: UNCAPPED contains a '/' and costs 6, and CAP_FOUR is
    // single-family -- something the mix predecessor of this cap rated BELOW "++*", which is exactly
    // the inversion the operator weights exist to correct. A subtraction is harder to find than a
    // multiplication whichever family it sits in.
    const UNCAPPED: Operator[] = ['/', '-', '*']
    const CAP_FOUR: Operator[] = ['+', '-', '+']
    const CAP_THREE: Operator[] = ['+', '+', '*']
    const CAP_TWO: Operator[] = ['+', '+', '+']

    // The grader counts these and never reads them, so opaque strings are honest here: a fixture of
    // real expressions would imply the count came from somewhere it does not.
    const ideas = (count: number): string[] => Array.from({ length: count }, (_value, index) => `idea-${index}`)
    const expressions = (count: number): string[] =>
      Array.from({ length: count }, (_value, index) => `expression-${index}`)

    it.each([
      // Idea count, ungated: one idea is one route to find, and every added route makes the goal
      // easier to stumble into.
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
      // The defect the cap exists for, restated in the new terms: a lone all-plus route is the first
      // thing anybody tries, and uniqueness cannot make it hard.
      ['two ideas reachable by three pluses', 2, CAP_TWO, 2],
      // The cap only ever LOWERS. Ten ideas is difficulty 1 and a hard operator cannot lift it.
      ['ten ideas reachable only by a division', 10, UNCAPPED, 1],
      ['five ideas reachable by a subtraction and a plus', 5, CAP_FOUR, 2],
    ])('rates %s', (_description, ideaCount, tuple, expected) => {
      const solution = { expressions: expressions(ideaCount), ideas: ideas(ideaCount), operatorTuples: [tuple] }

      expect(difficultyForSolution(solution)).toBe(expected)
    })

    // THE REGRESSION THIS REWRITE EXISTS FOR. The expression count used to break the tie between
    // difficulty 5 and 4, and it is a count of how permutable the operands happened to be rather
    // than of anything a player does: over every bank multiset 1-9 x 4, 99% of goals with a unique
    // operator tuple are a single idea, so the old split sorted one shape into two bands. A solution
    // with eighty-eight expressions and one idea is one answer, and it must grade as one.
    it('grades on ideas alone, whatever the expression count', () => {
      const one = { expressions: expressions(1), ideas: ideas(1), operatorTuples: [UNCAPPED] }
      const many = { expressions: expressions(88), ideas: ideas(1), operatorTuples: [UNCAPPED] }

      expect(difficultyForSolution(many)).toBe(difficultyForSolution(one))
    })

    // The original game's own puzzle, goal 154 from bank 6,9,7,7. SIX expressions, one tuple, one
    // idea -- and the tuple is "++*", two of the three cheapest operators. It graded 4 under the
    // expression tiebreaker, which read its six orderings of a leading '+' run as ambiguity. One
    // idea puts it at 5 and the operator cap brings it to 3, which is the honest reading: there is
    // exactly one answer, and it is made of pluses and a times.
    it("rates the original game's puzzle on its one idea and its cheap operators", () => {
      const solution = { expressions: expressions(6), ideas: ideas(1), operatorTuples: [CAP_THREE] }

      expect(difficultyForSolution(solution)).toBe(3)
    })

    // The cap reads EVERY tuple, not the first one. enumerateSolutions sorts its tuples on raw
    // ASCII, where '*' precedes '+', so the easy all-plus arrangement is routinely NOT the one at
    // index 0 -- and a cap that only looked there would grade this puzzle 5 while the player finds
    // "+++" and never notices the other arrangement existed.
    it('caps on the cheapest tuple wherever it sits in the list', () => {
      const solution = { expressions: expressions(1), ideas: ideas(1), operatorTuples: [UNCAPPED, CAP_TWO] }

      expect(difficultyForSolution(solution)).toBe(2)
    })
  })
})
