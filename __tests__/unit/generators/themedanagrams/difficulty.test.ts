import { SEVERITY_BY_DIFFICULTY, isAcceptableScramble } from '@generators/themedanagrams/difficulty'
import { agreements } from '@generators/themedanagrams/letters'
import { Difficulty } from '@types'

// Every distinct string these letters can spell, so the assertions run over the whole space.
const distinctPermutationsOf = (word: string): string[] => {
  const found: string[] = []
  const walk = (prefix: string, rest: string[]): void => {
    if (rest.length === 0) {
      found.push(prefix)
      return
    }
    const tried = new Set<string>()
    for (let index = 0; index < rest.length; index += 1) {
      const letter = rest[index]
      if (tried.has(letter)) {
        continue
      }
      tried.add(letter)
      walk(prefix + letter, [...rest.slice(0, index), ...rest.slice(index + 1)])
    }
  }
  walk('', [...word].sort())
  return found
}

// One fixture per admissible length, each with a non-empty hardest band and cheap to enumerate.
const FIXTURES: [number, string][] = [
  [5, 'WHISK'],
  [6, 'KETTLE'],
  [7, 'SPATULA'],
  [8, 'SAUCEPAN'],
  [9, 'ENTERTAIN'],
]

const DECLARED: Difficulty[] = [2, 3, 4]

const acceptedBy = (word: string, difficulty: Difficulty): Set<string> =>
  new Set(distinctPermutationsOf(word).filter((candidate) => isAcceptableScramble(word, candidate, difficulty)))

// The same predicate with the second axis removed -- an agreement ceiling and nothing else.
const acceptedByCeilingAlone = (word: string, difficulty: Difficulty): Set<string> =>
  new Set(
    distinctPermutationsOf(word).filter(
      (candidate) => agreements(word, candidate) <= SEVERITY_BY_DIFFICULTY[difficulty].maxAgreements(word.length),
    ),
  )

describe('SEVERITY_BY_DIFFICULTY', () => {
  it('is total over every Difficulty, so no lookup can be undefined', () => {
    expect(Object.keys(SEVERITY_BY_DIFFICULTY).sort()).toStrictEqual(['1', '2', '3', '4', '5'])
  })

  // The metric bottoms out at zero agreements and no surviving bigram, so there is nothing below row 4.
  it('makes row 5 a deliberate duplicate of row 4', () => {
    expect(SEVERITY_BY_DIFFICULTY[5].maxPreservedRun).toEqual(SEVERITY_BY_DIFFICULTY[4].maxPreservedRun)
    expect([5, 6, 7, 8, 9].map((length) => SEVERITY_BY_DIFFICULTY[5].maxAgreements(length))).toStrictEqual(
      [5, 6, 7, 8, 9].map((length) => SEVERITY_BY_DIFFICULTY[4].maxAgreements(length)),
    )
  })

  it.each([
    [5, [2, 1, 1, 0, 0]],
    [6, [3, 2, 1, 0, 0]],
    [7, [3, 2, 1, 0, 0]],
    [8, [4, 2, 1, 0, 0]],
    [9, [4, 3, 1, 0, 0]],
  ])('sets the agreement ceilings at length %i', (length, expected) => {
    expect(
      ([1, 2, 3, 4, 5] as Difficulty[]).map((d) => SEVERITY_BY_DIFFICULTY[d].maxAgreements(length as number)),
    ).toStrictEqual(expected)
  })

  // One transposition leaves N - 2 agreements, and band 2's ceiling is below that at every length.
  it.each([5, 6, 7, 8, 9])('subsumes the one-transposition rule at length %i', (length) => {
    expect(SEVERITY_BY_DIFFICULTY[2].maxAgreements(length)).toBeLessThan(length - 2)
  })
})

describe('isAcceptableScramble', () => {
  // The declared bands are strictly nested and none is empty: two bands accepting one set is a dial
  // with two positions and three labels, and a band nothing can fill is an incomplete pack forever.
  describe.each(FIXTURES)('at length %i', (_length, word) => {
    it('accepts a strictly smaller set at each harder band', () => {
      const [band2, band3, band4] = DECLARED.map((difficulty) => acceptedBy(word, difficulty))

      expect(band4.size).toBeGreaterThan(0)
      expect([...band4].every((scramble) => band3.has(scramble))).toBe(true)
      expect(band3.size).toBeGreaterThan(band4.size)
      expect([...band3].every((scramble) => band2.has(scramble))).toBe(true)
      expect(band2.size).toBeGreaterThan(band3.size)
    })
  })

  // At length 5 floor(5/3) is 1 and band 3's ceiling is also 1, so under the ceiling alone bands 2
  // and 3 accept the identical set. This goes red the moment maxPreservedRun is deleted as redundant.
  it('needs the preserved-run axis: the ceiling alone collapses bands 2 and 3 at length 5', () => {
    const byCeiling2 = acceptedByCeilingAlone('WHISK', 2)
    const byCeiling3 = acceptedByCeilingAlone('WHISK', 3)

    expect([...byCeiling2].sort()).toStrictEqual([...byCeiling3].sort())
    expect(acceptedBy('WHISK', 2).size).toBeGreaterThan(acceptedBy('WHISK', 3).size)
  })

  // The sparsest case any fixture here produces -- one of 180 -- and what the budget is sized against.
  it('leaves KETTLE exactly one acceptable scramble at band 4', () => {
    const band4 = [...acceptedBy('KETTLE', 4)].filter((scramble) => scramble !== 'KETTLE' && scramble[0] !== 'K')

    expect(band4).toStrictEqual(['LTEEKT'])
  })

  // Normal rather than a bug: about 6% of five-letter survivors, which is why the type over-asks.
  it('leaves ROBOT nothing at band 4', () => {
    expect(acceptedBy('ROBOT', 4).size).toEqual(0)
  })

  it('rejects a scramble that keeps a run at a shifted offset even with zero agreements', () => {
    // ERTOAST agrees in no position and hands the reader TOAST intact, which Hamming cannot see.
    expect(agreements('TOASTER', 'ERTOAST')).toEqual(0)
    expect(isAcceptableScramble('TOASTER', 'ERTOAST', 4)).toBe(false)
    expect(isAcceptableScramble('TOASTER', 'ERTOAST', 3)).toBe(false)
  })
})
