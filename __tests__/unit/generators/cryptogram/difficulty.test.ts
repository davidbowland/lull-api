import { derivedDifficulty, meetsStructuralFloor } from '@generators/cryptogram/difficulty'
import { Familiarity, Phrase } from '@types'

const phraseOf = (text: string, familiarity: Familiarity): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

// 14 letters, 5 repeats -- a repetition ratio of 0.36, between the two thresholds, so ease is
// familiarity untouched and derived is simply 6 - familiarity. The control case, and the case a
// real corpus is mostly made of.
const NEUTRAL = 'The Great Gatsby'
// 13 letters, 7 repeats -- a ratio of 0.54, at or above HIGH_REPETITION. +1 ease.
const REPETITIVE = 'To be or not to be'
// 15 letters, 1 repeat -- a ratio of 0.07, at or below LOW_REPETITION. -1 ease.
const VARIED = 'Quick brown foxes'
// Real phrases off the 2026-08-19 pack that shipped a band short. 16, 20 and 27 letters, ratios of
// 0.44, 0.40 and 0.41 -- all three neutral, and all three would have taken the old +1 for having six
// or more repeats. That is what "the count fired on practically everything" means in practice.
const ORDINARY = ['Singing in the rain', 'The Empire Strikes Back', 'Actions speak louder than words']

describe('derivedDifficulty', () => {
  // High familiarity makes a cryptogram EASIER and dominates the formula. The direction is the
  // thing most likely to be implemented backwards, so it is asserted at both ends.
  it.each([
    [1, 5],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 1],
  ] as [Familiarity, number][])(
    'turns familiarity %i into difficulty %i with neither flag set',
    (familiarity, expected) => {
      expect(derivedDifficulty(phraseOf(NEUTRAL, familiarity))).toEqual(expected)
    },
  )

  // Repetition is the solver's foothold: the same cipher letter appearing again and again is what
  // frequency analysis is made of, so a repetitive phrase is easier than its familiarity alone says.
  it('makes a repetitive phrase one step easier', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 3))).toEqual(2)
  })

  // Many distinct letters means many independent unknowns and almost nothing to lever off.
  it('makes a letter-varied phrase one step harder', () => {
    expect(derivedDifficulty(phraseOf(VARIED, 3))).toEqual(4)
  })

  // THE regression this rewrite exists for, asserted on real phrases rather than a fixture chosen to
  // sit in the gap. An absolute `repeats >= 6` fires on nearly everything that clears the
  // twelve-letter floor, so it was a constant +1 ease on the whole corpus rather than a nudge: every
  // phrase derived one band easier than its familiarity said, the modal reviewer rating of 4 or 5
  // landed on difficulty 1, and difficulty 4 needed a familiarity of 2 that the generation prompt
  // never asks for. The ratio leaves an ordinary phrase alone.
  it.each(ORDINARY)('takes no nudge on %s, an ordinary phrase', (text) => {
    expect(derivedDifficulty(phraseOf(text, 3))).toEqual(3)
  })

  // The consequence, stated as the thing that actually broke: difficulty 4 is one band from 3, so a
  // phrase the reviewer calls "well known, but some adults will pause" can now carry the hardest
  // cryptogram of the day. Under the counts it derived to 2 and difficulty 4 could not touch it.
  it('puts a familiarity-3 phrase within reach of the hardest band', () => {
    expect(derivedDifficulty(phraseOf(NEUTRAL, 3))).toEqual(3)
  })

  // Both thresholds are on one dimension, so unlike the flags they replaced they cannot fire at
  // once and there is no cancellation case to cover.
  it('never applies both nudges to one phrase', () => {
    expect(derivedDifficulty(phraseOf('Curiosity killed the cat', 3))).toEqual(3)
  })

  // Without the clamp these fall off the ends of the Difficulty union and produce a 0 or a 6, which
  // no generator declares and nothing downstream would ever match.
  it('clamps ease at the easy end', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 5))).toEqual(1)
  })

  it('clamps ease at the hard end', () => {
    expect(derivedDifficulty(phraseOf(VARIED, 1))).toEqual(5)
  })

  // meetsStructuralFloor keeps this away from every real caller, but the two run independently and a
  // ratio of 0/0 is NaN -- which compares false against BOTH thresholds and would silently take no
  // nudge rather than failing. Guarded, and asserted so the guard cannot be tidied away.
  it('derives a difficulty rather than NaN for a phrase with no letters', () => {
    expect(derivedDifficulty(phraseOf('   ', 3))).toEqual(4)
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

  // Near-pangrams are brutal with nothing pre-filled.
  it('rejects a phrase with too many distinct letters', () => {
    // A pangram: 32 letters, 26 unique.
    expect(meetsStructuralFloor(phraseOf('Pack my box with five dozen liquor jugs', 3))).toBe(false)
  })

  it('accepts a phrase exactly on the distinct-letter ceiling', () => {
    // 22 letters, 20 unique.
    expect(meetsStructuralFloor(phraseOf('Jumping wizards vex a bolt', 3))).toBe(true)
  })
})
