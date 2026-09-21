import { Difficulty, Phrase } from '../../types'

// Below this there is no frequency traction: a nine-letter phrase gives a solver nothing to count.
const MIN_LETTERS = 12
// Fewer than six distinct letters is a degenerate puzzle, not an easy one.
const MIN_UNIQUE = 6
// Bounds the artificial rather than the hard: twenty distinct letters at this length is a
// constructed pangram, not an idiom. The corpus tops out at 15 distinct in practice.
const MAX_UNIQUE = 20
// The share of tiles a player can carry between words. The bounds above read the phrase as one
// letter stream, but a substitution cipher is solved by cracking a symbol somewhere and spending
// it everywhere: GRAVEYARD SHIFT is ordinary on all three and its words share nothing, so solving
// GRAVEYARD leaves five unconstrained symbols. A third comes off the measured distribution -- over
// 117 corpus phrases clearing the other bounds, linkage runs min 0.00, p25 0.39, median 0.54, max
// 0.92 -- so it cuts the bottom fifth. A floor and not a dial term: the ratio grades how much
// traction a phrase gives, linkage whether that traction propagates.
const MIN_LINKAGE = 1 / 3

// The dial: (letters - unique) / letters, where more repetition is EASIER -- many tiles per symbol
// means every crack pays out across the board. The RATIO rather than the distinct-letter count,
// because a count drops length out of the model: eleven distinct letters is brutal across twelve
// tiles and gentle across twenty-seven. The cuts sit on the measured distribution rather than the
// 0-1 theoretical range -- over 37 phrases clearing the floor, min 0.08, p20 0.29, median 0.37,
// p80 0.42, max 0.59.
const RATIO_TO_DIFFICULTY = (ratio: number): number =>
  ratio >= 0.5 ? 1 : ratio >= 0.42 ? 2 : ratio >= 0.33 ? 3 : ratio >= 0.25 ? 4 : 5

// A nudge, not the dial, and the direction is easily got backwards: high familiarity makes a
// cryptogram EASIER. It stays a nudge because it defaults to 3 when review does not run and
// reviewPhrases swallows its own errors, so a dial on it would derive a whole batch to one band.
const HIGH_FAMILIARITY = 4
const LOW_FAMILIARITY = 2

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

interface LetterStats {
  letters: number
  unique: number
}

// Guarded rather than assumed: a 0/0 division gives NaN, which compares false against every
// threshold and falls silently through to the hardest band. Asserted in the tests.
const repetitionOf = ({ letters, unique }: LetterStats): number => (letters === 0 ? 0 : (letters - unique) / letters)

const statsOf = (text: string): LetterStats => {
  const letters = text.toUpperCase().match(/[A-Z]/g) ?? []
  return { letters: letters.length, unique: new Set(letters).size }
}

/**
 * The share of a phrase's TILES whose letter appears in two or more of its words.
 *
 * Tiles and not distinct letters: a count does not scale with the board -- three shared letters is
 * most of a fourteen-tile puzzle and a rounding error on a thirty-tile one. Within-word repeats do
 * not count, since a repeat buys no second word to spend the crack in, so HIGH NOON scores zero.
 *
 * Exported so the tests pin the metric itself, not just the predicate. Returns 0 rather than NaN on
 * a letterless phrase, for the reason repetitionOf is guarded.
 */
export const crossWordLinkage = (text: string): number => {
  const words = text.toUpperCase().match(/[A-Z]+/g) ?? []
  const letters = words.join('')
  if (letters.length === 0) {
    return 0
  }
  const wordsPerLetter: Record<string, number> = {}
  for (const word of words) {
    for (const letter of new Set(word)) {
      wordsPerLetter[letter] = (wordsPerLetter[letter] ?? 0) + 1
    }
  }
  return [...letters].filter((letter) => wordsPerLetter[letter] >= 2).length / letters.length
}

/**
 * The four bounds a phrase must clear to be a cryptogram at ALL, independent of difficulty. A
 * phrase can sit perfectly in a band and still be unplayable, and a floor folded into a band would
 * be re-argued every time the band moved.
 */
export const meetsStructuralFloor = (phrase: Phrase): boolean => {
  const { letters, unique } = statsOf(phrase.text)
  return (
    letters >= MIN_LETTERS &&
    unique >= MIN_UNIQUE &&
    unique <= MAX_UNIQUE &&
    crossWordLinkage(phrase.text) >= MIN_LINKAGE
  )
}

/**
 * How hard this phrase is as a cryptogram, 1-5. The repetition ratio dominates and familiarity
 * nudges one step either way; the nudges cannot both fire, so a phrase at the default familiarity
 * of 3 derives to exactly its ratio band.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const raw =
    RATIO_TO_DIFFICULTY(repetitionOf(statsOf(phrase.text))) -
    (phrase.familiarity >= HIGH_FAMILIARITY ? 1 : 0) +
    (phrase.familiarity <= LOW_FAMILIARITY ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
