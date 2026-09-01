import { derivedDifficulty, meetsStructuralFloor } from '@generators/cryptogram/difficulty'
import { Familiarity, Phrase } from '@types'

const phraseOf = (text: string, familiarity: Familiarity): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

// THE DIAL IS THE REPETITION RATIO -- (letters - unique) / letters -- and MORE repetition is EASIER.
// Both ends of that need a fixture, and the pair below is chosen so the COUNT of distinct letters
// cannot explain the difference: they sit at 9 and 14 distinct, but what separates them is how many
// tiles those symbols are spread across.
//
// 14 letters, 9 distinct, ratio 0.36 -- mid-range, difficulty 3 at the default familiarity. The
// control case, and close to the measured median of 0.37.
const NEUTRAL = 'The Great Gatsby'
// 13 letters, 6 distinct, ratio 0.54 -- long for its alphabet. Every symbol appears twice or more,
// so cracking one pays out across the board. Difficulty 1.
const REPETITIVE = 'To be or not to be'
// 15 letters, 14 distinct, ratio 0.07 -- almost every tile its own symbol. Nothing constrains
// anything else and there is no frequency signal at this length. Difficulty 5.
const VARIED = 'Quick brown foxes'
// THE PAIR THAT PROVES IT IS A RATIO AND NOT A COUNT. Both carry ELEVEN distinct letters and they
// land at opposite ends, because one spreads them over twelve tiles and the other over twenty-seven.
// A dial reading the count alone grades these identically; the whole point is that it must not.
const SHORT_ELEVEN = 'Jigsaw puzzle'
const LONG_ELEVEN = 'The meek shall inherit the earth'
// Real phrases off the 2026-08-19 pack, ratios 0.44, 0.40 and 0.41 -- all near the median, which is
// what an ordinary phrase looks like.
const ORDINARY: [string, number][] = [
  ['Singing in the rain', 2],
  ['The Empire Strikes Back', 3],
  ['Actions speak louder than words', 3],
]

describe('derivedDifficulty', () => {
  // MORE REPETITION IS EASIER, pinned at both ends and in the middle. This direction has now been
  // written both ways in this file, so it gets the most explicit rows in it.
  it.each([
    [REPETITIVE, 1],
    [NEUTRAL, 3],
    [VARIED, 5],
  ] as [string, number][])('grades %s to difficulty %i at the default familiarity', (text, expected) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
  })

  // THE ROW A DISTINCT-LETTER COUNT CANNOT PASS, and the reason the dial is a ratio. These two
  // phrases carry the SAME eleven distinct letters; one spreads them over twelve tiles and the other
  // over twenty-seven. Eleven symbols across twelve tiles leaves nothing constraining anything else;
  // across twenty-seven, every symbol repeats and each one cracked pays out everywhere.
  it('grades the same distinct-letter count differently by length', () => {
    expect(derivedDifficulty(phraseOf(SHORT_ELEVEN, 3))).toEqual(5)
    expect(derivedDifficulty(phraseOf(LONG_ELEVEN, 3))).toEqual(1)
  })

  // MONOTONIC, asserted rather than implied by the rows above. A dial that graded the ends correctly
  // and inverted somewhere in the middle would pass every fixture and still be wrong.
  it('never grades a more repetitive phrase as harder', () => {
    const byRatio = [VARIED, SHORT_ELEVEN, NEUTRAL, REPETITIVE, LONG_ELEVEN]
    const derived = byRatio.map((text) => derivedDifficulty(phraseOf(text, 3)))

    expect(derived).toStrictEqual([...derived].sort((left, right) => right - left))
  })

  it.each(ORDINARY)('grades %s, an ordinary phrase, to %i', (text, expected) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
  })

  // FAMILIARITY IS THE NUDGE, one step either way, and high familiarity makes a cryptogram EASIER
  // because recognizing the phrase from a fragment is most of the solve.
  it.each([
    [1, 4],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 2],
  ] as [Familiarity, number][])('nudges a mid-ratio phrase at familiarity %i to %i', (familiarity, expected) => {
    expect(derivedDifficulty(phraseOf(NEUTRAL, familiarity))).toEqual(expected)
  })

  // THE FRAGILITY THE DEMOTION FIXES, and the reason familiarity is a nudge rather than the dial.
  // familiarity defaults to 3 when review does not run, and reviewPhrases catches its own errors and
  // returns its input unchanged -- so a familiarity-driven dial derived the ENTIRE batch to one band
  // on any night that call failed. At the default neither nudge fires and two phrases with different
  // ratios still grade differently, which is what "survives a failed review pass" means.
  it('derives from the text alone at the default familiarity', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 3))).not.toEqual(derivedDifficulty(phraseOf(VARIED, 3)))
  })

  // The two nudges are thresholds on ONE dimension and do not overlap, so unlike the flags they
  // replaced they cannot both fire and there is no cancellation case to cover.
  it('never applies both nudges to one phrase', () => {
    expect(derivedDifficulty(phraseOf('Curiosity killed the cat', 3))).toEqual(3)
  })

  // Without the clamp these fall off the ends of the Difficulty union and produce a 0 or a 6, which
  // no generator declares and nothing downstream would ever match.
  it('clamps at the easy end', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 5))).toEqual(1)
  })

  it('clamps at the hard end', () => {
    expect(derivedDifficulty(phraseOf(VARIED, 1))).toEqual(5)
  })

  // meetsStructuralFloor keeps this away from every real caller, but the two run independently and a
  // ratio of 0/0 is NaN -- which compares false against every threshold and would silently fall
  // through to the hardest band rather than failing. Guarded, and asserted so the guard cannot be
  // tidied away.
  it('derives a difficulty rather than NaN for a phrase with no letters', () => {
    expect(derivedDifficulty(phraseOf('   ', 3))).toEqual(5)
  })
})

describe('meetsStructuralFloor', () => {
  it('accepts a phrase inside every bound', () => {
    expect(meetsStructuralFloor(phraseOf(NEUTRAL, 3))).toBe(true)
  })

  // Below twelve letters there is no frequency traction at all. This excludes every `compact` phrase
  // by construction, which is correct -- the generator prompt guarantees some in each batch.
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

  // Fewer than six distinct letters is a degenerate puzzle rather than an easy one.
  it('rejects a phrase with too few distinct letters', () => {
    // 12 letters, 2 unique. Synthetic: no real phrase does this, and the bound still has to hold.
    expect(meetsStructuralFloor(phraseOf('Abba baba abab', 3))).toBe(false)
  })

  // A near-pangram is a constructed sentence rather than a phrase anyone says -- which is the reason
  // this bound survived the dial changing direction. It is not excluded for being hard; under the
  // distinct-letter dial it would be the EASIEST thing the floor could admit.
  it('rejects a phrase with too many distinct letters', () => {
    // A pangram: 32 letters, 26 unique.
    expect(meetsStructuralFloor(phraseOf('Pack my box with five dozen liquor jugs', 3))).toBe(false)
  })

  it('accepts a phrase exactly on the distinct-letter ceiling', () => {
    // 22 letters, 20 unique.
    expect(meetsStructuralFloor(phraseOf('Jumping wizards vex a bolt', 3))).toBe(true)
  })
})
