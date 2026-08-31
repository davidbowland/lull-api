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

// UNIQUE LETTERS ARE THE DIAL, and more of them is EASIER. This inverts what this file used to say,
// so the old argument is kept here rather than deleted -- it was not stupid, it was borrowed from
// the wrong length regime.
//
// THE OLD CLAIM: "repetition is the solver's foothold: the same cipher letter appearing again and
// again is what frequency analysis is made of". True of a paragraph. False of a phrase, and this
// file already knew it: MIN_LETTERS' own comment says "below this there is no frequency traction --
// a nine-letter phrase gives a solver nothing to count". At twelve to thirty letters there is no
// usable frequency distribution either; a solver is not counting E's, they are matching WORD
// PATTERNS. And pattern matching wants the opposite of repetition: the more distinct symbols a word
// carries, the sharper its shape and the fewer English words fit it. A phrase built from eight
// letters is a mush of near-identical patterns; one built from fifteen tells you what each word is.
//
// So the thresholds below grade on the COUNT of distinct letters, not on a repetition ratio, and
// high count means low difficulty.
//
// SET AGAINST THE MEASURED DISTRIBUTION rather than the 6-20 theoretical range, which is the lesson
// the previous rewrite of this file paid for -- an absolute threshold set against the range applied
// one constant nudge to practically the whole corpus and left a band empty by construction. Measured
// over 37 phrases that clear the floor: min 8, p25 9, median 11, p75 12, max 15. These four
// boundaries put the median at 3 and give every band a real share.
const UNIQUE_TO_DIFFICULTY = (unique: number): number =>
  unique >= 14 ? 1 : unique >= 12 ? 2 : unique >= 10 ? 3 : unique >= 8 ? 4 : 5

// Familiarity is the NUDGE now, where it used to be the whole dial, and the direction is the thing
// most easily got backwards: high familiarity makes a cryptogram EASIER, because recognizing the
// phrase from a fragment is most of the solve.
//
// DEMOTING IT FIXES A REAL FRAGILITY RATHER THAN JUST MAKING ROOM. familiarity is set by the
// reviewer, defaults to 3 when review does not run, and reviewPhrases catches its own errors and
// returns its input unchanged -- so on any night that call failed, a familiarity-driven dial derived
// the ENTIRE batch to one band and this type starved. That is the same argument
// phrazle/difficulty.ts makes for refusing familiarity outright. A dial computed from `text`
// survives a failed review pass; at the default familiarity of 3 neither nudge fires and the
// derivation is exactly UNIQUE_TO_DIFFICULTY.
const HIGH_FAMILIARITY = 4
const LOW_FAMILIARITY = 2

// THE CLAMP IS ON DIFFICULTY DIRECTLY NOW. The old pair clamped an "ease" and converted it with
// `6 - ease`, which was the shape a familiarity-primary dial wanted -- familiarity IS an ease. With
// distinct letters as the dial there is no ease to invert: UNIQUE_TO_DIFFICULTY returns a difficulty
// and the nudges move it, so the indirection would only be a second thing to keep straight.
const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

// `repeats` is GONE with the repetition ratio that read it. It was letters - unique, derivable by
// anyone who wants it, and a field nothing reads is a field the next reader has to check for callers.
interface LetterStats {
  letters: number
  unique: number
}

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
 * DISTINCT LETTERS DOMINATE and familiarity nudges one step either way. See UNIQUE_TO_DIFFICULTY
 * above for why the count runs in the direction it does, and why it is a count rather than the
 * repetition RATIO this function used to read.
 *
 * The two nudges cannot both fire -- HIGH_FAMILIARITY and LOW_FAMILIARITY do not overlap -- so a
 * phrase at the default familiarity of 3 derives to exactly its unique-letter band.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const { unique } = statsOf(phrase.text)
  const raw =
    UNIQUE_TO_DIFFICULTY(unique) -
    (phrase.familiarity >= HIGH_FAMILIARITY ? 1 : 0) +
    (phrase.familiarity <= LOW_FAMILIARITY ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
