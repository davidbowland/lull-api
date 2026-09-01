import { Difficulty, Phrase } from '../../types'

// Below this there is no frequency traction: a nine-letter phrase gives a solver nothing to count.
const MIN_LETTERS = 12
// Fewer than six distinct letters is a degenerate puzzle, not an easy one.
const MIN_UNIQUE = 6
// A near-pangram is not a phrase anyone says. THE REASON HERE CHANGED WITH THE DIAL and the old one
// is kept because it is now exactly backwards: it read "near-pangrams are brutal with nothing
// pre-filled", which was the repetition model talking -- under a dial where distinct letters make a
// puzzle EASIER, twenty of them would be the easiest board there is, and this ceiling would be
// cutting off the easy end for no reason.
//
// It stays because the ceiling was never really about difficulty. A twenty-distinct-letter phrase at
// this length is a constructed pangram (the test fixture is `Pack my box with five dozen liquor
// jugs`), not an idiom or a title, and the corpus tops out at 15 distinct in practice. This bounds
// the artificial, not the hard.
const MAX_UNIQUE = 20

// REPETITION RATIO IS THE DIAL: (letters - unique) / letters, and MORE repetition is EASIER.
//
// THE COUNT OF DISTINCT LETTERS IS NOT THE DIAL, and this file briefly said it was. That version
// graded on `unique` alone with more meaning easier, which drops LENGTH out of the model -- and
// length is half of what makes a cryptogram hard. Eleven distinct letters is brutal across twelve
// tiles (JIGSAW PUZZLE) and gentle across twenty-seven (THE MEEK SHALL INHERIT THE EARTH), and a
// dial reading only the count grades those two identically. The ratio is what separates them.
//
// SO THE TWO ENDS ARE: long with few distinct letters is EASY -- many tiles per symbol, so every
// letter you crack pays out across the whole board. Short with many distinct letters is close to
// impossible -- each symbol appears once or twice, nothing constrains anything else, and there is
// neither frequency signal nor cross-word leverage to work with.
//
// SET AGAINST THE MEASURED DISTRIBUTION rather than the 0-1 theoretical range, which is the lesson
// this file paid for twice. Measured over 37 phrases that clear the floor: min 0.08, p20 0.29,
// median 0.37, p80 0.42, max 0.59. The boundaries sit on those quintiles, so a typical phrase lands
// mid-range and both declared bands have real supply.
const RATIO_TO_DIFFICULTY = (ratio: number): number =>
  ratio >= 0.5 ? 1 : ratio >= 0.42 ? 2 : ratio >= 0.33 ? 3 : ratio >= 0.25 ? 4 : 5

// Familiarity is the NUDGE, where it used to be the whole dial, and the direction is the thing most
// easily got backwards: high familiarity makes a cryptogram EASIER, because recognizing the phrase
// from a fragment is most of the solve.
//
// DEMOTING IT FIXES A REAL FRAGILITY rather than just making room, and this half survives from the
// distinct-letter attempt because it is independent of which letter property does the grading.
// familiarity is set by the reviewer, defaults to 3 when review does not run, and reviewPhrases
// catches its own errors and returns its input unchanged -- so on any night that call failed, a
// familiarity-driven dial derived the ENTIRE batch to one band and this type starved. That is the
// same argument phrazle/difficulty.ts makes for refusing familiarity outright. A dial computed from
// `text` survives a failed review pass; at the default familiarity of 3 neither nudge fires and the
// derivation is exactly RATIO_TO_DIFFICULTY.
const HIGH_FAMILIARITY = 4
const LOW_FAMILIARITY = 2

// THE CLAMP IS ON DIFFICULTY DIRECTLY NOW. The old pair clamped an "ease" and converted it with
// `6 - ease`, which was the shape a familiarity-primary dial wanted -- familiarity IS an ease. With
// distinct letters as the dial there is no ease to invert: UNIQUE_TO_DIFFICULTY returns a difficulty
// and the nudges move it, so the indirection would only be a second thing to keep straight.
const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

interface LetterStats {
  letters: number
  unique: number
}

// Guarded rather than assumed. meetsStructuralFloor keeps a letterless phrase away from every real
// caller, but the two run independently and a 0/0 division would produce NaN -- which compares false
// against every threshold below and would silently fall through to the hardest band rather than
// failing. The guard is asserted in the tests so it cannot be tidied away.
const repetitionOf = ({ letters, unique }: LetterStats): number => (letters === 0 ? 0 : (letters - unique) / letters)

const statsOf = (text: string): LetterStats => {
  const letters = text.toUpperCase().match(/[A-Z]/g) ?? []
  return { letters: letters.length, unique: new Set(letters).size }
}

/**
 * The three bounds a phrase must clear to be a cryptogram at ALL, independent of difficulty.
 *
 * Separate from the derived difficulty on purpose: a phrase can sit perfectly in a band and still be
 * unplayable, and a floor folded into the band would be re-argued every time the band moved.
 */
export const meetsStructuralFloor = (phrase: Phrase): boolean => {
  const { letters, unique } = statsOf(phrase.text)
  return letters >= MIN_LETTERS && unique >= MIN_UNIQUE && unique <= MAX_UNIQUE
}

/**
 * How hard this phrase is as a cryptogram, 1-5.
 *
 * THE REPETITION RATIO DOMINATES and familiarity nudges one step either way. See RATIO_TO_DIFFICULTY
 * above for why more repetition means easier, and why it is the ratio rather than the distinct-letter
 * COUNT this function briefly read.
 *
 * The two nudges are thresholds on one dimension and do not overlap, so a phrase at the default
 * familiarity of 3 derives to exactly its ratio band.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const raw =
    RATIO_TO_DIFFICULTY(repetitionOf(statsOf(phrase.text))) -
    (phrase.familiarity >= HIGH_FAMILIARITY ? 1 : 0) +
    (phrase.familiarity <= LOW_FAMILIARITY ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
