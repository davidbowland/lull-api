import { Difficulty, Phrase } from '../../types'

// Below this there is no frequency traction: a nine-letter phrase gives a solver nothing to count.
const MIN_LETTERS = 12
// Fewer than six distinct letters is a degenerate puzzle, not an easy one.
const MIN_UNIQUE = 6
// Near-pangrams are brutal with nothing pre-filled.
const MAX_UNIQUE = 20

// Repetition is the solver's foothold: the same cipher letter appearing again and again is what
// frequency analysis is made of, and its absence leaves many independent unknowns. Measured as a
// SHARE of the phrase's letters, never as an absolute count -- and that distinction is the whole
// reason these two constants replaced `repeats >= 6` and `unique >= 14`.
//
// Over phrases that clear the twelve-letter floor, almost every one has six or more repeats and
// almost none has fourteen distinct letters. So the old pair was not a two-sided nudge at all: it
// was a constant +1 ease applied to practically the entire corpus, shifting every phrase one band
// easier than its familiarity said. That put the modal phrase -- which the reviewer rates 4 or 5 --
// at derived difficulty 1, and left cryptogram's difficulty 4 reachable only from a familiarity of
// 2 or less. The generation prompt asks for phrases an ordinary adult can place, so that band was
// empty by construction: a pack short its hardest cryptogram was the NORMAL outcome, not a bad draw.
//
// A ratio has no such bias. These two sit either side of a real corpus's middle, so a typical phrase
// takes neither nudge and derives to exactly 6 - familiarity. They cannot both fire.
const HIGH_REPETITION = 0.5
const LOW_REPETITION = 0.3

const MIN_EASE = 1
const MAX_EASE = 5
// derived = MAX_EASE + 1 - ease, so ease 5 is difficulty 1 and ease 1 is difficulty 5.
const EASE_TO_DIFFICULTY = MAX_EASE + 1

interface LetterStats {
  letters: number
  repeats: number
  unique: number
}

const statsOf = (text: string): LetterStats => {
  const letters = text.toUpperCase().match(/[A-Z]/g) ?? []
  const unique = new Set(letters).size
  return { letters: letters.length, repeats: letters.length - unique, unique }
}

// Guarded rather than assumed. meetsStructuralFloor keeps a letterless phrase away from every real
// caller, but the two run independently and a division that can produce NaN would silently defeat
// both comparisons below rather than failing.
const repetitionOf = ({ letters, repeats }: LetterStats): number => (letters === 0 ? 0 : repeats / letters)

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
 * Familiarity is set by the REVIEWER and dominates, and its direction is the thing most easily got
 * backwards: high familiarity makes a cryptogram EASIER, because recognizing the phrase from a
 * fragment is most of the solve. Repetition nudges one step either way.
 *
 * A typical phrase takes no nudge at all, so `6 - familiarity` is the mapping to reason about and
 * the ratio is the correction on top. That centering is load-bearing rather than tidy: every band
 * this generator declares has to be reachable from a familiarity the generation prompt actually
 * produces, or the band starves.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const repetition = repetitionOf(statsOf(phrase.text))
  const raw = phrase.familiarity + (repetition >= HIGH_REPETITION ? 1 : 0) - (repetition <= LOW_REPETITION ? 1 : 0)
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, raw))
  return (EASE_TO_DIFFICULTY - ease) as Difficulty
}
