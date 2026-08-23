import { SEVERITY_BY_DIFFICULTY, isAcceptableScramble } from '@generators/themedanagrams/difficulty'
import { agreements } from '@generators/themedanagrams/letters'
import { Difficulty } from '@types'

// Every distinct string these letters can spell, so the assertions below are over the WHOLE space
// rather than over a sample. Deterministic by construction -- no random source anywhere in this file.
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

// One fixture per admissible length, each chosen for a non-empty hardest band and each cheap enough
// to enumerate exhaustively: 120 / 180 / 2,520 / 20,160 / 45,360 strings, about 68,000 in all.
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

// The same predicate with the SECOND AXIS REMOVED -- an agreement ceiling and nothing else. This is
// the table every version the panel proposed amounted to, and the control below is what says why it
// is not enough.
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

  // Recorded as a test rather than only as a comment, because an unexplained duplicate row is
  // exactly the thing someone later "fixes" by inventing a rule for a band nobody declared. The
  // metric bottoms out at zero agreements and no surviving bigram; there is nothing below row 4.
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

  // THE CATALOG'S "within one transposition" RULE, SUBSUMED by the same number that sets the
  // difficulty -- one rule, not two. One transposition of an N-letter word leaves N - 2 agreements,
  // and band 2's ceiling is below that at every admissible length, so every declared band already
  // rejects it.
  it.each([5, 6, 7, 8, 9])('subsumes the one-transposition rule at length %i', (length) => {
    expect(SEVERITY_BY_DIFFICULTY[2].maxAgreements(length)).toBeLessThan(length - 2)
  })
})

describe('isAcceptableScramble', () => {
  // THE BAND-SEPARATION PROPERTY, exhaustively, at every admissible length: the declared bands are
  // STRICTLY nested and none of them is empty. Strictly, because two bands accepting the same set is
  // a dial with two positions wearing three labels; non-empty, because a band nothing can fill is a
  // permanently incomplete pack with no code path able to clear it.
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

  // THE CONTROL, and the whole reason there are two axes rather than one.
  //
  // An agreement ceiling is integer-valued over a range of five positions, so it cannot separate
  // three bands at every admissible length. At length 5 floor(5/3) is 1 and band 3's ceiling is also
  // 1, so under the ceiling alone bands 2 and 3 accept the IDENTICAL set -- not a similar one, the
  // same one. This row is what goes red the moment someone decides maxPreservedRun is redundant and
  // deletes it, and it is stated as a positive claim about the ceiling rather than as a comment
  // nobody runs.
  it('needs the preserved-run axis: the ceiling alone collapses bands 2 and 3 at length 5', () => {
    const byCeiling2 = acceptedByCeilingAlone('WHISK', 2)
    const byCeiling3 = acceptedByCeilingAlone('WHISK', 3)

    expect([...byCeiling2].sort()).toStrictEqual([...byCeiling3].sort())
    // ...while the real predicate, with both axes, keeps them apart on the same word.
    expect(acceptedBy('WHISK', 2).size).toBeGreaterThan(acceptedBy('WHISK', 3).size)
  })

  // The catalog's own worked example, at the band this type declares as its hardest. Pinned by name
  // because it is the sparsest case any fixture here produces -- one acceptable scramble out of 180 --
  // and it is what the scrambler's attempt budget is sized against.
  it('leaves KETTLE exactly one acceptable scramble at band 4', () => {
    const band4 = [...acceptedBy('KETTLE', 4)].filter((scramble) => scramble !== 'KETTLE' && scramble[0] !== 'K')

    expect(band4).toStrictEqual(['LTEEKT'])
  })

  // A REAL WORD THAT CLEARS EVERY ADMISSIBILITY GATE AND STILL HAS NO ACCEPTABLE HARDEST-BAND
  // SCRAMBLE. That is a normal event rather than a bug -- about 6% of five-letter survivors -- and it
  // is why the type asks for six words and ships four, and why the scrambler returns undefined rather
  // than throwing.
  it('leaves ROBOT nothing at band 4', () => {
    expect(acceptedBy('ROBOT', 4).size).toEqual(0)
  })

  it('rejects a scramble that keeps a run at a shifted offset even with zero agreements', () => {
    // TOASTER -> ERTOAST agrees in no position at all and hands the reader TOAST intact, which is
    // precisely what Hamming cannot see.
    expect(agreements('TOASTER', 'ERTOAST')).toEqual(0)
    expect(isAcceptableScramble('TOASTER', 'ERTOAST', 4)).toBe(false)
    expect(isAcceptableScramble('TOASTER', 'ERTOAST', 3)).toBe(false)
  })
})
