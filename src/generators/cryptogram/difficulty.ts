import { Difficulty, Phrase } from '../../types'

// Below this there is no frequency traction: a nine-letter phrase gives a solver nothing to count.
const MIN_LETTERS = 12
// Fewer than six distinct letters is a degenerate puzzle, not an easy one.
const MIN_UNIQUE = 6
// Near-pangrams are brutal with nothing pre-filled.
const MAX_UNIQUE = 20

// Repetition is the solver's foothold; many distinct letters means many independent unknowns. The
// two are anti-correlated over real phrases, so both flags fire together only at letters >= 20.
const REPEAT_THRESHOLD = 6
const UNIQUE_THRESHOLD = 14

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
 * fragment is most of the solve. The two structural flags nudge one step each.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const { repeats, unique } = statsOf(phrase.text)
  const raw = phrase.familiarity + (repeats >= REPEAT_THRESHOLD ? 1 : 0) - (unique >= UNIQUE_THRESHOLD ? 1 : 0)
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, raw))
  return (EASE_TO_DIFFICULTY - ease) as Difficulty
}
