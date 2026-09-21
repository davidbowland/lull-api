import { isAcceptableScramble } from '@generators/themedanagrams/difficulty'
import { agreements, distinctPermutations, sortedLetters } from '@generators/themedanagrams/letters'
import {
  ATTEMPTS_PER_PERMUTATION,
  SCRAMBLES_PER_ENTRY,
  SCRAMBLE_ATTEMPT_CAP,
  attemptBudget,
  drawScrambles,
  maxSharedPositions,
} from '@generators/themedanagrams/scramble'
import { Difficulty } from '@types'
import { containsChargedWord } from '@utils/model-output-checks'

// A seeded, repeatable source -- mulberry32, so the same seed replays the same draws exactly.
const seededRandom = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DECLARED: Difficulty[] = [2, 3, 4]

// Exhaustive, so the rows below say what a word's acceptable set IS rather than what draws found.
const distinctScrambles = (answer: string): string[] => {
  const found = new Set<string>()
  const walk = (prefix: string, rest: string): void => {
    found.add(prefix + rest)
    for (let index = 0; index < rest.length; index += 1) {
      walk(prefix + rest[index], rest.slice(0, index) + rest.slice(index + 1))
    }
  }
  walk('', answer)
  return [...found].filter((candidate) => candidate.length === answer.length)
}

// The set scrambleWord chooses from at this band. The charged gate is deliberately not applied here.
const acceptableScrambles = (answer: string, difficulty: Difficulty): string[] =>
  distinctScrambles(answer).filter(
    (candidate) =>
      candidate !== answer && candidate[0] !== answer[0] && isAcceptableScramble(answer, candidate, difficulty),
  )

// Seeds 0-199 rather than live draws; 200 matches the incident measurement of AGING at band 4.
const RUNS = 200
const SEEDS = Array.from({ length: RUNS }, (_, seed) => seed)

describe('attemptBudget', () => {
  // Seven draws per permutation: P(miss) is about e^(-t/n), so t >= n * ln(1000) keeps it under 0.1%.
  it.each([
    ['APPLE', 60, 420],
    ['KETTLE', 180, 1_260],
    ['UKULELE', 630, 4_410],
  ])('gives %s seven draws per permutation', (word, space, budget) => {
    expect(distinctPermutations(word as string)).toEqual(space)
    expect(attemptBudget(word as string)).toEqual(budget)
    expect(ATTEMPTS_PER_PERMUTATION * (space as number)).toEqual(budget)
  })

  // The cap binds only above n = 714, which is length 7 and up.
  it('caps the budget on a large space', () => {
    expect(attemptBudget('SPATULA')).toEqual(SCRAMBLE_ATTEMPT_CAP)
  })
})

// Restated rather than imported: importing maxSharedPositions would make the rows agree by construction.
describe('maxSharedPositions', () => {
  // A third of the tiles, rounded down, and band-independent: this is about whether the board changed.
  it.each([
    [5, 1],
    [6, 2],
    [7, 2],
    [8, 2],
    [9, 3],
  ])('lets %i letters share at most %i positions', (length, shared) => {
    expect(maxSharedPositions(length)).toEqual(shared)
  })
})

describe('drawScrambles', () => {
  it('is deterministic for a given random source', () => {
    expect(drawScrambles('KETTLE', 2, seededRandom(7))).toEqual(drawScrambles('KETTLE', 2, seededRandom(7)))
  })

  // A named fixture per length, each with a non-empty acceptable set at every band -- see ROBOT below.
  describe.each(['WHISK', 'KETTLE', 'SPATULA', 'SAUCEPAN', 'ENTERTAIN'])('%s', (answer) => {
    it.each(DECLARED)('returns between one and four scrambles at band %i', (difficulty) => {
      const scrambles = drawScrambles(answer, difficulty, seededRandom(11))

      expect(scrambles.length).toBeGreaterThanOrEqual(1)
      expect(scrambles.length).toBeLessThanOrEqual(SCRAMBLES_PER_ENTRY)
    })

    // Every member, not just index 0: the reshuffle button walks past a gate applied to the first.
    it.each(DECLARED)('returns only acceptable scrambles at band %i', (difficulty) => {
      const scrambles = drawScrambles(answer, difficulty, seededRandom(11))

      for (const scramble of scrambles) {
        expect(sortedLetters(scramble)).toEqual(sortedLetters(answer))
        expect(isAcceptableScramble(answer, scramble, difficulty)).toBe(true)
      }
    })

    it.each(DECLARED)('returns distinct scrambles at band %i', (difficulty) => {
      const scrambles = drawScrambles(answer, difficulty, seededRandom(11))

      expect(new Set(scrambles).size).toEqual(scrambles.length)
    })

    it.each(DECLARED)('separates every pair of scrambles at band %i', (difficulty) => {
      const scrambles = drawScrambles(answer, difficulty, seededRandom(11))

      for (const [index, scramble] of scrambles.entries()) {
        for (const other of scrambles.slice(index + 1)) {
          expect(agreements(scramble, other)).toBeLessThanOrEqual(maxSharedPositions(answer.length))
        }
      }
    })
  })

  describe('the structural floor', () => {
    it('never returns the answer itself, at any band', () => {
      // Also discharges the `S != A` premise of the uniqueness proof: the answer itself is a word.
      const scrambles = DECLARED.flatMap((difficulty) => drawScrambles('KETTLE', difficulty, seededRandom(3)))

      expect(scrambles).not.toContain('KETTLE')
    })

    it('always moves the first letter, which the agreement ceiling does not imply', () => {
      // At band 2 a nine-letter word may keep three agreements, so a head-keeping scramble clears it.
      const scrambles = drawScrambles('ENTERTAIN', 2, seededRandom(5))

      expect(scrambles.map((scramble) => scramble[0])).not.toContain('E')
    })
  })

  // ROBOT clears every gate and has zero acceptable band-4 scrambles: a word property, so no throw.
  it('returns nothing for ROBOT at band 4 and does not throw', () => {
    expect(() => drawScrambles('ROBOT', 4, seededRandom(2))).not.toThrow()
    expect(drawScrambles('ROBOT', 4, seededRandom(2))).toStrictEqual([])
  })

  // KETTLE's band-4 acceptable set is a singleton, so four is unreachable by a property of the word.
  it('returns the one scramble KETTLE has at band 4 rather than dropping the word', () => {
    expect(acceptableScrambles('KETTLE', 4)).toHaveLength(1)
    expect(drawScrambles('KETTLE', 4, seededRandom(11))).toHaveLength(1)
  })

  // Watched red against a separation gate that only checks the previous scramble: a list of two has
  // one pair, so every row above passes. ENTERTAIN always yields four, so this cannot pass vacuously.
  it('separates the first and last of four scrambles, not merely each from its neighbor', () => {
    const scrambles = drawScrambles('ENTERTAIN', 3, seededRandom(11))

    expect(scrambles).toHaveLength(SCRAMBLES_PER_ENTRY)
    expect(agreements(scrambles[0], scrambles[3])).toBeLessThanOrEqual(maxSharedPositions('ENTERTAIN'.length))
  })

  // ROBOT's band-4 acceptable set is empty, so the only exits are exhaustion and the 420-attempt
  // budget. One Fisher-Yates pass over five letters draws four times, so attempts are draws / 4;
  // this run takes 233. Delete the exhaustion arm and it reads exactly 420.
  it('stops on the exhausted space rather than spending the whole budget', () => {
    const seeded = seededRandom(13)
    let draws = 0
    const counted = (): number => {
      draws += 1
      return seeded()
    }

    drawScrambles('ROBOT', 4, counted)

    expect(attemptBudget('ROBOT')).toEqual(420)
    expect(draws / ('ROBOT'.length - 1)).toEqual(233)
  })

  // These seven answers cleared every word gate because each keys to an INFLECTION of a listed charged
  // word, a multiset the key filter never saw. Called directly, to test the second defense alone.
  describe('the charged-scramble gate', () => {
    // Sixty distinct permutations, exactly one acceptable at band 4, and that one is a slur.
    it('leaves AGING with a band-4 acceptable set of exactly one, which is charged', () => {
      const acceptable = acceptableScrambles('AGING', 4)

      expect(acceptable).toHaveLength(1)
      expect(containsChargedWord(acceptable[0])).toBe(true)
    })

    // Watched red: delete `!containsChargedWord(scramble)` from isShippable and this returns that one
    // charged string on all 200 seeds. The word is not in the lexicon, so no other test catches it.
    it(`returns nothing for AGING at band 4 across ${RUNS} seeds rather than the one charged scramble`, () => {
      const drawn = SEEDS.map((seed) => drawScrambles('AGING', 4, seededRandom(seed)))

      expect(drawn.flat()).toStrictEqual([])
    })

    it('does not throw when every acceptable scramble is charged', () => {
      expect(() => drawScrambles('AGING', 4, seededRandom(2))).not.toThrow()
    })

    // The exposure, stated per (word, band) so the sweep below is not passing vacuously.
    it.each([
      ['AGING', 2],
      ['AGING', 3],
      ['AGING', 4],
      ['AGINGS', 2],
      ['AGINGS', 3],
      ['GAZING', 2],
      ['ENTRAIN', 2],
      ['ENTRAINS', 2],
      ['SRADHAS', 2],
    ] as [string, Difficulty][])("has a charged string in %s's band-%i acceptable set", (answer, difficulty) => {
      expect(acceptableScrambles(answer, difficulty).filter(containsChargedWord).length).toBeGreaterThan(0)
    })

    // SWANKER's charged permutation keeps a six-letter run, which the run axis rejects at every band.
    it.each(DECLARED)(
      'leaves SWANKER no charged acceptable scramble at band %i, on the run axis alone',
      (difficulty) => {
        expect(acceptableScrambles('SWANKER', difficulty).filter(containsChargedWord)).toStrictEqual([])
      },
    )

    describe.each(['AGING', 'AGINGS', 'GAZING', 'ENTRAIN', 'ENTRAINS', 'SWANKER', 'SRADHAS'])('%s', (answer) => {
      it.each(DECLARED)(`ships nothing charged at band %i across ${RUNS} seeds`, (difficulty) => {
        const drawn = SEEDS.flatMap((seed) => drawScrambles(answer, difficulty, seededRandom(seed)))

        expect(drawn.filter(containsChargedWord)).toStrictEqual([])
      })
    })
  })

  describe('a hostile random source', () => {
    // Clamped, because `random` is injectable and an out-of-range or NaN draw is silent corruption:
    // an unclamped pick reads past the array end and the write-back extends it with "undefined".
    it.each([
      ['NaN', () => Number.NaN],
      ['Infinity', () => Number.POSITIVE_INFINITY],
      ['above 1', () => 5],
      ['negative', () => -5],
    ])('produces real permutations from a %s draw', (_name, random) => {
      const scrambles = drawScrambles('KETTLE', 2, random)

      // A constant source shuffles to one string, and the visited set turns every repeat into a
      // redraw, so the list is at most one long however many attempts the budget buys.
      expect(scrambles.length).toBeLessThanOrEqual(1)
      for (const scramble of scrambles) {
        expect(sortedLetters(scramble)).toEqual(sortedLetters('KETTLE'))
        expect(scramble).not.toContain('undefined')
      }
    })
  })
})
