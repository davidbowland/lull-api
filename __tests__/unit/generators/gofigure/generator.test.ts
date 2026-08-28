import { enumerateSolutions, Solution } from '@generators/gofigure/enumerate'
import { evaluateLeftToRight } from '@generators/gofigure/evaluate'
import { difficultyForSolution, goFigureGenerator, operatorMix } from '@generators/gofigure/generator'
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
    // KEYED ON THE TUPLE COUNT, not on the difficulty, and that is a change the operator-mix cap
    // forced. Difficulty 4 and 5 still IMPLY a unique tuple -- the cap only ever lowers a grade, and
    // only the one-tuple branch reaches 4 or 5 before it applies -- but the CONVERSE is gone: a
    // one-tuple puzzle whose operators are all the same is now difficulty 2, and it must still print
    // the unhedged copy, because its tuple really is unique. A table of literal booleans per
    // difficulty would now assert something false about that puzzle. The surviving 4-and-5 direction
    // is pinned by its own test below.
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
    // tuple count for the same reason the hedge test above is: since the operator-mix cap, a
    // one-tuple puzzle can carry any difficulty from 2 up, and it takes the one-tuple slot order at
    // every one of them.
    it.each([1, 2, 3, 4, 5])('emits the slot order matching the tuple count at difficulty %s', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = new Set(puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, '')))

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual(tuples.size === 1 ? [1, 0, 2] : [0, 1, 2])
    })

    // The literal end-to-end pin the two derived tests above deliberately gave up. Difficulty 4 and
    // 5 remain the one-tuple bands, so their slot order is knowable without consulting the puzzle,
    // and asserting it as a constant is what catches a future re-band that lets a multi-tuple puzzle
    // reach 4 -- the derived tests would follow such a puzzle down and stay green.
    it.each([4, 5])('emits the one-tuple slot order at difficulty %s', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)

      expect(puzzle.data.hints.map((hint) => hint.metadata.slot)).toEqual([1, 0, 2])
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

    // difficultyForSolution's OTHER end of the deal, and the whole reason the operator-mix cap
    // exists. A unique tuple used to be sufficient for the hard bands, which let "7+7+7+7" -- one
    // arrangement, and the first arrangement anybody tries -- ship as difficulty 4. Roughly one in
    // eleven difficulty-4 goals over 500 random banks was that shape. A band the shelf calls hard
    // must not be reachable by typing the same operator three times, so both shipped hard bands are
    // asserted here on a REAL generated puzzle rather than on a fixture.
    it.each([4, 5])('draws difficulty %s from a puzzle whose operators span both families', async (difficulty) => {
      const puzzle = await goFigureGenerator.generate('2026-06-15', difficulty as Difficulty, seededRandom(41), shortId)
      const tuples = puzzle.data.acceptedSolutions.map((solution) => solution.replace(/[0-9]/g, ''))

      expect(tuples.every((tuple) => /[+-]/.test(tuple) && /[*/]/.test(tuple))).toBe(true)
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
      // () => 0 draws [1,1,1,1] every time, which reaches difficulty 1 and 2 only. It used to reach
      // 5 as well -- goal 1 is "1*1*1*1", one tuple and one expression -- and the operator-mix cap
      // is what took that away: every arrangement this bank admits is a single repeated operator.
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

  describe('operatorMix', () => {
    // One row per tier per family, so neither family can be the one the predicate happens to get
    // right. The 'cross' rows include "++*", the original game's own tuple for goal 154 from bank
    // 6,9,7,7 -- the puzzle this type was built to reproduce is cross-family, which is why the cap
    // leaves the hard bands with anything in them at all.
    it.each([
      [['+', '+', '+'], 'same'],
      [['-', '-', '-'], 'same'],
      [['*', '*', '*'], 'same'],
      [['/', '/', '/'], 'same'],
      [['+', '-', '+'], 'family'],
      [['-', '+', '+'], 'family'],
      [['*', '/', '*'], 'family'],
      [['/', '*', '*'], 'family'],
      [['+', '+', '*'], 'cross'],
      [['*', '+', '+'], 'cross'],
      [['-', '/', '-'], 'cross'],
      [['/', '-', '*'], 'cross'],
    ])('reads %s as %s', (tuple, mix) => {
      expect(operatorMix(tuple as Operator[])).toBe(mix)
    })
  })

  describe('difficultyForSolution', () => {
    const allOperators: Operator[] = ['+', '-', '*', '/']

    // GENUINELY DIFFERENT tuples, all of them CROSS-FAMILY. Slots 0 and 1 always come from opposite
    // families, and index 16 and up swaps which slot holds which, so the two halves cannot collide:
    // 32 distinct tuples, none of which trips the mix cap, and the table below asks for 20.
    //
    // The cross-family part is what this fixture gained when the cap arrived. Its predecessor read
    // the index as a base-4 numeral over all four operators, which made distinctTuples(1) the tuple
    // "+++" -- so every one-tuple row in the old table was silently describing a homogeneous puzzle,
    // and every one of them would now grade 2. Distinctness alone is no longer enough for a fixture;
    // it has to fix the mix too, or the row is testing a different puzzle than its name claims.
    const crossTuples = (count: number): Operator[][] =>
      Array.from({ length: count }, (_value, index) => {
        const additive: Operator = index % 2 === 0 ? '+' : '-'
        const multiplicative: Operator = (index >> 1) % 2 === 0 ? '*' : '/'
        const tail: Operator = allOperators[(index >> 2) % 4]
        return index < 16 ? [additive, multiplicative, tail] : [multiplicative, additive, tail]
      })

    // A solution is as easy as its EASIEST arrangement -- a player only has to find one of them --
    // so a fixture for a mix tier plants ONE tuple of that tier among cross-family filler. No cross
    // tuple can equal a homogeneous or one-family tuple, so the list stays distinct the way
    // enumerateSolutions's dedupe guarantees.
    const SAME: Operator[] = ['+', '+', '+']
    const ONE_FAMILY: Operator[] = ['+', '-', '+']
    const withEasiest = (easiest: Operator[], count: number): Operator[][] => [easiest, ...crossTuples(count - 1)]

    it.each([
      // Cross-family: the ambiguity grade stands untouched, exactly as it read before the cap
      ['one cross tuple and one expression', crossTuples(1), 1, 5],
      ['one cross tuple and two expressions', crossTuples(1), 2, 5],
      ['one cross tuple and three expressions', crossTuples(1), 3, 4],
      ["the original game's puzzle: one cross tuple and six expressions", crossTuples(1), 6, 4],
      ['two cross tuples', crossTuples(2), 2, 3],
      ['three cross tuples', crossTuples(3), 5, 2],
      ['four cross tuples', crossTuples(4), 9, 2],
      ['five cross tuples', crossTuples(5), 5, 1],
      ['many cross tuples', crossTuples(20), 20, 1],
      // All one operator, capped at 2. The first two rows ARE the defect the cap exists for: a
      // unique tuple, which the ambiguity grade alone reads as the hardest thing this type emits,
      // and which a player solves by tapping the same operator three times.
      ['a lone all-same tuple with one expression', withEasiest(SAME, 1), 1, 2],
      ['a lone all-same tuple with six expressions', withEasiest(SAME, 1), 6, 2],
      ['an all-same tuple beside one other', withEasiest(SAME, 2), 2, 2],
      ['an all-same tuple among four', withEasiest(SAME, 4), 9, 2],
      // The cap only ever LOWERS. Five tuples is difficulty 1 and an easy arrangement cannot lift it.
      ['an all-same tuple among five', withEasiest(SAME, 5), 5, 1],
      // Mixed, but inside one family: a smaller search than a cross-family tuple, capped at 3
      ['a lone one-family tuple with one expression', withEasiest(ONE_FAMILY, 1), 1, 3],
      ['a lone one-family tuple with six expressions', withEasiest(ONE_FAMILY, 1), 6, 3],
      ['a one-family tuple beside one other', withEasiest(ONE_FAMILY, 2), 2, 3],
      ['a one-family tuple among four', withEasiest(ONE_FAMILY, 4), 9, 2],
      ['a one-family tuple among five', withEasiest(ONE_FAMILY, 5), 5, 1],
    ])('rates %s', (_description, operatorTuples, expressionCount, expected) => {
      const expressions = Array.from({ length: expressionCount as number }, (_value, index) => `expression-${index}`)

      expect(difficultyForSolution({ expressions, operatorTuples: operatorTuples as Operator[][] })).toBe(expected)
    })

    // The cap reads EVERY tuple, not the first one. enumerateSolutions sorts its tuples on raw
    // ASCII, where '*' precedes '+', so the easy all-plus arrangement is routinely NOT the one at
    // index 0 -- and a cap that only looked there would grade this puzzle 3 while the player finds
    // "+++" and never notices the other arrangement existed.
    it('caps on the easiest tuple wherever it sits in the list', () => {
      const operatorTuples: Operator[][] = [...crossTuples(1), SAME]

      expect(difficultyForSolution({ expressions: ['a', 'b'], operatorTuples })).toBe(2)
    })
  })
})
