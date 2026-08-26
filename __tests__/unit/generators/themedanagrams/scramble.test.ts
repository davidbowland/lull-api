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

// A seeded, repeatable source. NEVER Math.random in a test body: a suite that passes today and fails
// tomorrow is broken. Mulberry32, so the same seed replays the same draws exactly.
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

// Every distinct string a word's letters can spell. Exhaustive rather than sampled, so the rows below
// can say what a word's acceptable set IS instead of what 200 draws happened to find -- and 40,320
// for a nine-letter answer is cheap enough to do exactly.
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

// The set scrambleWord is choosing from at this band, structural floor included: not the answer, the
// head has moved, and the severity dial is satisfied. The charged gate is deliberately NOT applied
// here -- these rows exist to show what the gate has to remove.
const acceptableScrambles = (answer: string, difficulty: Difficulty): string[] =>
  distinctScrambles(answer).filter(
    (candidate) =>
      candidate !== answer && candidate[0] !== answer[0] && isAcceptableScramble(answer, candidate, difficulty),
  )

// 200, matching the measurement that opened the incident report: 200 band-4 runs of AGING, 200 of
// which shipped a slur. Seeds 0-199 rather than 200 live draws, because a suite that rolls its own
// dice passes today and fails tomorrow.
const RUNS = 200
const SEEDS = Array.from({ length: RUNS }, (_, seed) => seed)

describe('attemptBudget', () => {
  // Seven times the space, so a one-in-n target is missed with probability under 0.1%: with t draws
  // over n distinct permutations P(miss) is about e^(-t/n), and under 0.1% needs t >= n * ln(1000).
  it.each([
    ['APPLE', 60, 420],
    ['KETTLE', 180, 1_260],
    ['UKULELE', 630, 4_410],
  ])('gives %s seven draws per permutation', (word, space, budget) => {
    expect(distinctPermutations(word as string)).toEqual(space)
    expect(attemptBudget(word as string)).toEqual(budget)
    expect(ATTEMPTS_PER_PERMUTATION * (space as number)).toEqual(budget)
  })

  // The cap binds only above n = 714, which is length 7 and up -- and that is where singleton
  // acceptable sets stop happening.
  it('caps the budget on a large space', () => {
    expect(attemptBudget('SPATULA')).toEqual(SCRAMBLE_ATTEMPT_CAP)
  })
})

// THE SEPARATION CEILING, restated here rather than imported into the assertion it checks. Importing
// maxSharedPositions into every row would make the rows agree with the implementation by
// construction; this table is the independent statement of what the numbers ARE, and the rows below
// spend the imported function only where they are asserting the gate's EFFECT.
describe('maxSharedPositions', () => {
  // A third of the tiles, rounded down: the reshuffle has to move most of the board or it did not
  // happen as far as a player is concerned. Band-independent on purpose -- this is about whether the
  // board changed, not about how hard it is, and both strings already clear the dial against the
  // answer.
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

  // A NAMED fixture per admissible length, each with a non-empty acceptable set at every declared
  // band, so the row says WHICH word it is claiming this of rather than asserting a universal that is
  // false -- see the ROBOT row below.
  describe.each(['WHISK', 'KETTLE', 'SPATULA', 'SAUCEPAN', 'ENTERTAIN'])('%s', (answer) => {
    it.each(DECLARED)('returns between one and four scrambles at band %i', (difficulty) => {
      const scrambles = drawScrambles(answer, difficulty, seededRandom(11))

      expect(scrambles.length).toBeGreaterThanOrEqual(1)
      expect(scrambles.length).toBeLessThanOrEqual(SCRAMBLES_PER_ENTRY)
    })

    // EVERY member, not just the first. The whole point of shipping a list is that the player sees
    // all of it, so a gate applied only to the string that happens to be at index 0 is a gate the
    // reshuffle button walks straight past.
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

    // THE RESHUFFLE GATE. Pairwise over the whole list rather than between neighbours: a player can
    // press the button twice, so scramble 3 has to differ from scramble 1 as well as from scramble 2.
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
      // This is also what discharges the `S != A` premise of the uniqueness proof: the answer IS a
      // word, so a shuffle returning the identity permutation would falsify "no scramble of an
      // admitted word is a word" on exactly that case.
      const scrambles = DECLARED.flatMap((difficulty) => drawScrambles('KETTLE', difficulty, seededRandom(3)))

      expect(scrambles).not.toContain('KETTLE')
    })

    it('always moves the first letter, which the agreement ceiling does not imply', () => {
      // At band 2 a nine-letter word may keep three agreements, so a scramble that kept its head
      // would clear the ceiling. Nothing but the floor stops it.
      const scrambles = drawScrambles('ENTERTAIN', 2, seededRandom(5))

      expect(scrambles.map((scramble) => scramble[0])).not.toContain('E')
    })
  })

  // THE ROW THAT REPLACES A FALSE UNIVERSAL. ROBOT clears every admissibility gate and has zero
  // acceptable band-4 scrambles, which is about 6% of five-letter survivors. Exhaustion is a normal
  // outcome of a word property, so it must not throw: throwing would name the wrong cause at 3am and
  // convert a word-shape problem into a missing puzzle.
  it('returns nothing for ROBOT at band 4 and does not throw', () => {
    expect(() => drawScrambles('ROBOT', 4, seededRandom(2))).not.toThrow()
    expect(drawScrambles('ROBOT', 4, seededRandom(2))).toStrictEqual([])
  })

  // THE OTHER END OF BEST-EFFORT, and the row that stops "1 to 4" quietly becoming "4 or nothing".
  // KETTLE's band-4 acceptable set is a SINGLETON -- the catalog's own worked example -- so four is
  // unreachable here by a property of the word, not by bad luck. A caller that demanded four would
  // drop a word that ships fine today, which is the trade this design deliberately refuses.
  it('returns the one scramble KETTLE has at band 4 rather than dropping the word', () => {
    expect(acceptableScrambles('KETTLE', 4)).toHaveLength(1)
    expect(drawScrambles('KETTLE', 4, seededRandom(11))).toHaveLength(1)
  })

  // WATCHED RED against a separation gate that only looks at the PREVIOUS scramble. Checking
  // neighbours is the cheap mistake -- it passes every row above, because a list of two has only one
  // pair -- and it lets scramble 3 come back nearly identical to scramble 1, which a player reaches
  // by pressing the button twice. This word's space is large enough that four are always found, so a
  // short list cannot make this row pass vacuously.
  it('separates the first and last of four scrambles, not merely each from its neighbour', () => {
    const scrambles = drawScrambles('ENTERTAIN', 3, seededRandom(11))

    expect(scrambles).toHaveLength(SCRAMBLES_PER_ENTRY)
    expect(agreements(scrambles[0], scrambles[3])).toBeLessThanOrEqual(maxSharedPositions('ENTERTAIN'.length))
  })

  // THE VISITED SET IS AN EXIT, NOT A BUDGET. ROBOT's space is 60 strings and its budget is 420
  // attempts, and its band-4 acceptable set is empty -- so the ONLY two ways out are the exhaustion
  // exit and the budget. One Fisher-Yates pass over a five-letter word draws four times, so attempts
  // are draws / 4, and this run takes 233 of the 420: the loop stopped because it had PROVED the
  // space empty, not because it ran out of tries. Delete the exhaustion arm and this reads exactly
  // 420.
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

  /**
   * THE ROWS THAT GO RED IF THE CHARGED GATE IS DELETED FROM isShippable.
   *
   * These seven answers all cleared every word gate -- length, multiplicity, the 60-permutation
   * floor, uniqueness, and the answer-side blocklist -- because each keys to an INFLECTION of a
   * listed charged word rather than to the listed word, and an inflection is a different letter
   * multiset. The build-time key filter never saw them.
   *
   * They are all gone from the committed lexicon now (anagram-words.test.ts pins that), so the
   * generator can no longer be handed one. This suite calls scrambleWord DIRECTLY, which is the only
   * way to test the second defense on its own: it asks what the scrambler does with a doomed word
   * regardless of who admitted it, and that is exactly the question a list cannot answer for the next
   * unlisted form.
   */
  describe('the charged-scramble gate', () => {
    // The worst case in the set, and the reason the gate is not optional. Sixty distinct
    // permutations, exactly ONE of them acceptable at band 4, and that one is a slur -- so the
    // scrambler was not occasionally unlucky, it was deterministic.
    it('leaves AGING with a band-4 acceptable set of exactly one, which is charged', () => {
      const acceptable = acceptableScrambles('AGING', 4)

      expect(acceptable).toHaveLength(1)
      expect(containsChargedWord(acceptable[0])).toBe(true)
    })

    // WATCHED RED. Delete `!containsChargedWord(scramble)` from isShippable and this row returns that
    // one acceptable string 200 times out of 200 instead of nothing. Nothing else in the suite
    // moves: the word is not in the lexicon, so no admissibility test can catch this.
    it(`returns nothing for AGING at band 4 across ${RUNS} seeds rather than the one charged scramble`, () => {
      const drawn = SEEDS.map((seed) => drawScrambles('AGING', 4, seededRandom(seed)))

      expect(drawn.flat()).toStrictEqual([])
    })

    // Exhaustion by an all-charged acceptable set exits exactly like exhaustion by an empty one -- an
    // empty list, never a throw, and the caller drops the word down the existing scrambleExhausted
    // path. A gate that threw here would name a content problem as a scrambler bug at 3am.
    it('does not throw when every acceptable scramble is charged', () => {
      expect(() => drawScrambles('AGING', 4, seededRandom(2))).not.toThrow()
    })

    // The exposure, stated per (word, band) so the sweep below is measuring something rather than
    // passing vacuously. Each of these acceptable sets contains at least one charged string that the
    // gate has to reject and redraw around.
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

    // SWANKER is the odd one out and is recorded rather than quietly dropped: its charged permutation
    // keeps a six-letter run of the answer, and the longest-preserved-run axis rejects that at every
    // declared band. It was reachable through the WORD gate -- the lexicon admitted it -- and never
    // through the scramble one. Both halves of the fix cover it; only the first was ever load-bearing.
    it.each(DECLARED)(
      'leaves SWANKER no charged acceptable scramble at band %i, on the run axis alone',
      (difficulty) => {
        expect(acceptableScrambles('SWANKER', difficulty).filter(containsChargedWord)).toStrictEqual([])
      },
    )

    // The sweep: every word from the incident, every declared band, 200 seeds each. Every string in
    // every list is one no gate objects to -- never a charged one, at any position. Flattened rather
    // than sampled at index 0, because the reshuffle button reaches the whole list.
    describe.each(['AGING', 'AGINGS', 'GAZING', 'ENTRAIN', 'ENTRAINS', 'SWANKER', 'SRADHAS'])('%s', (answer) => {
      it.each(DECLARED)(`ships nothing charged at band %i across ${RUNS} seeds`, (difficulty) => {
        const drawn = SEEDS.flatMap((seed) => drawScrambles(answer, difficulty, seededRandom(seed)))

        expect(drawn.filter(containsChargedWord)).toStrictEqual([])
      })
    })
  })

  describe('a hostile random source', () => {
    // CLAMPED, because `random` is injectable and an out-of-range or NaN draw is silent corruption
    // rather than a crash: an unclamped pick reads past the end of the array and the write-back
    // EXTENDS it, so the joined string carries the literal "undefined".
    it.each([
      ['NaN', () => Number.NaN],
      ['Infinity', () => Number.POSITIVE_INFINITY],
      ['above 1', () => 5],
      ['negative', () => -5],
    ])('produces real permutations from a %s draw', (_name, random) => {
      const scrambles = drawScrambles('KETTLE', 2, random)

      // Every one of these is a CONSTANT source, so the shuffle produces one string over and over and
      // the visited set turns every repeat into a redraw -- so the list is at most ONE long however
      // many attempts the budget buys. Whatever comes back, nothing may contain the string
      // "undefined" and nothing may throw.
      expect(scrambles.length).toBeLessThanOrEqual(1)
      for (const scramble of scrambles) {
        expect(sortedLetters(scramble)).toEqual(sortedLetters('KETTLE'))
        expect(scramble).not.toContain('undefined')
      }
    })
  })
})
