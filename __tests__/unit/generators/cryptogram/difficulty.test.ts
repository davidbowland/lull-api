import { derivedDifficulty, meetsStructuralFloor } from '@generators/cryptogram/difficulty'
import { Familiarity, Phrase } from '@types'

const phraseOf = (text: string, familiarity: Familiarity): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

// 14 letters, 9 unique, 5 repeats -- under BOTH thresholds, so ease is familiarity untouched and
// derived is simply 6 - familiarity. The control case.
const NEUTRAL = 'The Great Gatsby'
// 20 letters, 12 unique, 8 repeats -- repeats >= 6 fires, unique >= 14 does not. +1 ease.
const REPETITIVE = 'The Empire Strikes Back'
// 15 letters, 14 unique, 1 repeat -- unique >= 14 fires, repeats >= 6 does not. -1 ease.
const VARIED = 'Quick brown foxes'
// 21 letters, 14 unique, 7 repeats -- BOTH fire and cancel. Only reachable at letters >= 20, which
// is the anti-correlation the spec calls out.
const BOTH = 'Curiosity killed the cat'

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

  it('lets the two flags cancel each other', () => {
    expect(derivedDifficulty(phraseOf(BOTH, 3))).toEqual(3)
  })

  // Without the clamp these fall off the ends of the Difficulty union and produce a 0 or a 6, which
  // no generator declares and nothing downstream would ever match.
  it('clamps ease at the easy end', () => {
    expect(derivedDifficulty(phraseOf(REPETITIVE, 5))).toEqual(1)
  })

  it('clamps ease at the hard end', () => {
    expect(derivedDifficulty(phraseOf(VARIED, 1))).toEqual(5)
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
