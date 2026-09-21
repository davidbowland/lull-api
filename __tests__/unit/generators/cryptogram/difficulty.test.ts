import { crossWordLinkage, derivedDifficulty, meetsStructuralFloor } from '@generators/cryptogram/difficulty'
import { Familiarity, Phrase } from '@types'

const phraseOf = (text: string, familiarity: Familiarity): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

// The dial is the repetition ratio -- (letters - unique) / letters -- and more repetition is easier. NEUTRAL is
// ratio 0.36, on the measured median of 0.37; REPETITIVE is 0.54; VARIED is 0.07. SHORT_ELEVEN and LONG_ELEVEN
// carry eleven distinct letters each over twelve tiles and twenty-seven, so a count-based dial grades them
// identically. ORDINARY are real phrases off the 2026-08-19 pack at ratios 0.44, 0.40 and 0.41.
const NEUTRAL = 'The Great Gatsby'
const REPETITIVE = 'To be or not to be'
const VARIED = 'Quick brown foxes'
const SHORT_ELEVEN = 'Jigsaw puzzle'
const LONG_ELEVEN = 'The meek shall inherit the earth'
const ORDINARY: [string, number][] = [
  ['Singing in the rain', 2],
  ['The Empire Strikes Back', 3],
  ['Actions speak louder than words', 3],
]

describe('derivedDifficulty', () => {
  it.each([
    [REPETITIVE, 1],
    [NEUTRAL, 3],
    [VARIED, 5],
  ] as [string, number][])('grades %s to difficulty %i at the default familiarity', (text, expected) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
  })

  it('grades the same distinct-letter count differently by length', () => {
    expect(derivedDifficulty(phraseOf(SHORT_ELEVEN, 3))).toEqual(5)
    expect(derivedDifficulty(phraseOf(LONG_ELEVEN, 3))).toEqual(1)
  })

  // A dial that grades the ends correctly and inverts in the middle passes every fixture above and is wrong.
  it('never grades a more repetitive phrase as harder', () => {
    const byRatio = [VARIED, SHORT_ELEVEN, NEUTRAL, REPETITIVE, LONG_ELEVEN]
    const derived = byRatio.map((text) => derivedDifficulty(phraseOf(text, 3)))

    expect(derived).toStrictEqual([...derived].sort((left, right) => right - left))
  })

  it.each(ORDINARY)('grades %s, an ordinary phrase, to %i', (text, expected) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
  })

  // High familiarity is easier: recognizing the phrase from a fragment is most of the solve.
  it.each([
    [1, 4],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 2],
  ] as [Familiarity, number][])('nudges a mid-ratio phrase at familiarity %i to %i', (familiarity, expected) => {
    expect(derivedDifficulty(phraseOf(NEUTRAL, familiarity))).toEqual(expected)
  })

  // Why familiarity is a nudge rather than the dial: reviewPhrases returns its input unchanged on error, so on a
  // night that call fails every phrase carries the default 3 and a familiarity-driven dial grades one band.
  it('derives from the text alone at the default familiarity', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 3))).not.toEqual(derivedDifficulty(phraseOf(VARIED, 3)))
  })

  it('never applies both nudges to one phrase', () => {
    expect(derivedDifficulty(phraseOf('Curiosity killed the cat', 3))).toEqual(3)
  })

  // Without the clamp these fall off the Difficulty union as a 0 or a 6, which nothing downstream matches.
  it('clamps at the easy end', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 5))).toEqual(1)
  })

  it('clamps at the hard end', () => {
    expect(derivedDifficulty(phraseOf(VARIED, 1))).toEqual(5)
  })

  // Unreachable through the floor, but a ratio of 0/0 is NaN, which compares false and falls through to band 5.
  it('derives a difficulty rather than NaN for a phrase with no letters', () => {
    expect(derivedDifficulty(phraseOf('   ', 3))).toEqual(5)
  })
})

describe('meetsStructuralFloor', () => {
  it('accepts a phrase inside every bound', () => {
    expect(meetsStructuralFloor(phraseOf(NEUTRAL, 3))).toBe(true)
  })

  // Below twelve letters there is no frequency traction. This excludes every `compact` phrase by construction.
  it.each([
    ['Big cat', 6],
    ['Cats and dogs', 11],
  ])('rejects %s, which has only %i letters', (text) => {
    expect(meetsStructuralFloor(phraseOf(text, 3))).toBe(false)
  })

  it('accepts a phrase exactly on the letter floor', () => {
    // 12 letters, 9 unique.
    expect(meetsStructuralFloor(phraseOf('Winter storms', 3))).toBe(true)
  })

  it('rejects a phrase with too few distinct letters', () => {
    // 12 letters, 2 unique. Synthetic: no real phrase does this, and the bound still has to hold.
    expect(meetsStructuralFloor(phraseOf('Abba baba abab', 3))).toBe(false)
  })

  // A near-pangram is a constructed sentence rather than a phrase anyone says; it is not excluded for being hard.
  it('rejects a phrase with too many distinct letters', () => {
    // A pangram: 32 letters, 26 unique.
    expect(meetsStructuralFloor(phraseOf('Pack my box with five dozen liquor jugs', 3))).toBe(false)
  })

  // 31 letters, 20 unique, linkage 0.68. Synthetic: no real phrase carries twenty distinct letters across words.
  it('accepts a phrase exactly on the distinct-letter ceiling', () => {
    expect(meetsStructuralFloor(phraseOf('Jumping wizards waltz sphinx boxful', 3))).toBe(true)
  })

  // The linkage clause. Every phrase clears the other three bounds, so each row fails on linkage alone, and all
  // four shipped: solving GRAVEYARD leaves SHIFT as five tiles with nothing constraining any of them.
  it.each([
    ['Graveyard shift', 0],
    ['To err is human', 0],
    ['Yellow submarine', 0.13],
    ['Sleeping beauty', 0.21],
  ])('rejects %s, whose cross-word linkage is %d', (text) => {
    expect(meetsStructuralFloor(phraseOf(text, 3))).toBe(false)
  })

  it.each([
    ['If the shoe fits', 0.92],
    ['Let them eat cake', 0.64],
    ['All that glitters is not gold', 0.79],
  ])('accepts %s, whose cross-word linkage is %d', (text) => {
    expect(meetsStructuralFloor(phraseOf(text, 3))).toBe(true)
  })

  // Exactly on the floor, so the comparison cannot quietly become strictly-greater: SNAP DECISION is 12 tiles and
  // SNAP's S and N both recur in DECISION, for 4 of 12.
  it('accepts a phrase sitting exactly on the linkage floor', () => {
    expect(meetsStructuralFloor(phraseOf('Snap decision', 3))).toBe(true)
  })
})

describe('crossWordLinkage', () => {
  it('counts the share of tiles whose letter appears in more than one word', () => {
    // Four of LET THEM EAT CAKE's letters are E, three are T and two are A: nine of fourteen tiles.
    expect(crossWordLinkage('Let them eat cake')).toBeCloseTo(9 / 14)
  })

  it('returns zero when no letter appears in two words', () => {
    expect(crossWordLinkage('Graveyard shift')).toEqual(0)
  })

  // The distinction from the repetition ratio: HIGH NOON has a repetition ratio of 0.25 and a linkage of 0.
  it('ignores letters repeated inside one word', () => {
    expect(crossWordLinkage('High noon')).toEqual(0)
  })

  // 0/0 is NaN, NaN compares false against the floor, and the phrase is then rejected for a reason nobody wrote.
  it('returns zero rather than NaN for a phrase with no letters', () => {
    expect(crossWordLinkage('   ')).toEqual(0)
  })
})
