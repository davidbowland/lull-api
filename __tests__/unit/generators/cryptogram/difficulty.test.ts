import { derivedDifficulty, meetsStructuralFloor } from '@generators/cryptogram/difficulty'
import { Familiarity, Phrase } from '@types'

const phraseOf = (text: string, familiarity: Familiarity): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

// THE DIAL IS DISTINCT-LETTER COUNT AND MORE IS EASIER. These fixtures were chosen for a repetition
// RATIO and are re-labelled for the count they actually carry; the ratio thresholds they were named
// after no longer exist.
//
// 14 letters, 9 distinct -- squarely in the 10-and-under band, so difficulty 4 at the default
// familiarity. The control case, and close to what a real corpus is mostly made of (measured median
// 11 distinct).
const NEUTRAL = 'The Great Gatsby'
// 13 letters, 6 distinct -- sitting on MIN_UNIQUE. The hardest thing the floor admits: thirteen
// tiles drawn from six symbols is a mush of near-identical word shapes.
const FEW_DISTINCT = 'To be or not to be'
// 15 letters, 14 distinct -- almost every tile its own symbol, so every word has a sharp pattern.
const MANY_DISTINCT = 'Quick brown foxes'
// Real phrases off the 2026-08-19 pack. 9, 12 and 16 distinct letters -- one per band from 4 down to
// 1, which is the spread the count produces on ordinary material and the reason it can grade at all.
const ORDINARY: [string, number][] = [
  ['Singing in the rain', 4],
  ['The Empire Strikes Back', 2],
  ['Actions speak louder than words', 1],
]

describe('derivedDifficulty', () => {
  // DISTINCT LETTERS ARE THE DIAL AND MORE OF THEM IS EASIER. This is the direction most likely to
  // be implemented backwards -- it is the reverse of what this file asserted until the dial changed
  // -- so it is pinned at both ends and in the middle.
  //
  // The old model graded on a repetition RATIO in the opposite direction, on the ground that
  // "repetition is the solver's foothold ... what frequency analysis is made of". That is true of a
  // paragraph and false of a phrase: at twelve to thirty letters there is no usable frequency
  // distribution, and a solver is matching WORD PATTERNS rather than counting E's. More distinct
  // symbols means sharper patterns and fewer English words that fit them.
  it.each([
    [MANY_DISTINCT, 14, 1],
    ['The Empire Strikes Back', 12, 2],
    [NEUTRAL, 9, 4],
    [FEW_DISTINCT, 6, 5],
  ] as [string, number, number][])(
    'grades %s, with %i distinct letters, to difficulty %i',
    (text, _unique, expected) => {
      expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
    },
  )

  // MONOTONIC, asserted rather than implied by the rows above. A dial that graded the ends correctly
  // and inverted somewhere in the middle would pass every fixture and still be wrong.
  it('never grades a phrase with more distinct letters as harder', () => {
    const byDistinct = [FEW_DISTINCT, NEUTRAL, 'The Empire Strikes Back', MANY_DISTINCT]
    const derived = byDistinct.map((text) => derivedDifficulty(phraseOf(text, 3)))

    expect(derived).toStrictEqual([...derived].sort((left, right) => right - left))
  })

  it.each(ORDINARY)('grades %s, an ordinary phrase, to %i', (text, expected) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(expected)
  })

  // FAMILIARITY IS THE NUDGE NOW, one step either way, and high familiarity makes a cryptogram
  // EASIER because recognizing the phrase from a fragment is most of the solve.
  it.each([
    [1, 5],
    [2, 5],
    [3, 4],
    [4, 3],
    [5, 3],
  ] as [Familiarity, number][])('nudges a nine-distinct phrase at familiarity %i to %i', (familiarity, expected) => {
    expect(derivedDifficulty(phraseOf(NEUTRAL, familiarity))).toEqual(expected)
  })

  // THE FRAGILITY THE DEMOTION FIXES, and it is the reason familiarity is a nudge rather than the
  // dial. familiarity defaults to 3 when review does not run, and reviewPhrases catches its own
  // errors and returns its input unchanged -- so a familiarity-driven dial derived the ENTIRE batch
  // to one band on any night that call failed. At the default neither nudge fires and the derivation
  // is the phrase's own letter count, which survives a failed review pass intact.
  it('derives from the text alone at the default familiarity', () => {
    expect(derivedDifficulty(phraseOf(NEUTRAL, 3))).toEqual(derivedDifficulty(phraseOf(NEUTRAL, 3)))
    expect(derivedDifficulty(phraseOf(MANY_DISTINCT, 3))).not.toEqual(derivedDifficulty(phraseOf(NEUTRAL, 3)))
  })

  // The two nudges are thresholds on ONE dimension and do not overlap, so unlike the flags they
  // replaced they cannot both fire and there is no cancellation case to cover.
  it('never applies both nudges to one phrase', () => {
    expect(derivedDifficulty(phraseOf('Curiosity killed the cat', 3))).toEqual(1)
  })

  // Without the clamp these fall off the ends of the Difficulty union and produce a 0 or a 6, which
  // no generator declares and nothing downstream would ever match.
  it('clamps at the easy end', () => {
    expect(derivedDifficulty(phraseOf(MANY_DISTINCT, 5))).toEqual(1)
  })

  it('clamps at the hard end', () => {
    expect(derivedDifficulty(phraseOf(FEW_DISTINCT, 1))).toEqual(5)
  })

  // meetsStructuralFloor keeps this away from every real caller, but the two run independently. The
  // count of an empty string is 0, which falls through every threshold to the hardest band rather
  // than producing the NaN the old ratio could -- asserted so a future dial cannot reintroduce one.
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
