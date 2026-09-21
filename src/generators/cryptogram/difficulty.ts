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
// THE SHARE OF TILES A PLAYER CAN CARRY BETWEEN WORDS, and the floor that says a cryptogram is
// SOLVABLE rather than merely long enough to count.
//
// The three bounds above are all about the phrase as ONE letter stream. None of them can see where
// the letters sit, and a substitution cipher is not solved one word at a time -- it is solved by
// cracking a symbol somewhere and spending it everywhere. GRAVEYARD SHIFT shipped at band 3 with 14
// letters, 12 distinct and a perfectly ordinary repetition ratio, and its two words SHARE NOTHING:
// solve GRAVEYARD outright and SHIFT is still five tiles of five symbols you have never seen, with
// no constraint on any of them. That is not a hard puzzle, it is two puzzles, and the second one has
// no traction at all. TO ERR IS HUMAN is the same board at 12 letters. The lull-ui hint ladder makes
// this worse rather than better at exactly the wrong moment: its third and last rung reveals a whole
// WORD, so on a board like this a player spends the entire ladder and is handed the half they had
// already read.
//
// So: a third of the tiles must carry a letter that appears in more than one word. A THIRD, and it
// is set off the measured distribution rather than picked as a round number -- over 117 corpus
// phrases clearing the other three bounds, linkage runs min 0.00, p25 0.39, median 0.54, max 0.92,
// so this cuts the bottom fifth and nothing else. It costs almost nothing where it matters: band 2's
// usable supply goes 71 -> 70 and band 3's 76 -> 71, because low linkage clusters in derived 5, a
// band this type does not declare.
//
// A FLOOR AND NOT A TERM IN THE DIAL, deliberately. The repetition ratio already grades how much
// frequency traction a phrase gives and it grades it well; linkage is not a second opinion on that
// question, it is the separate question of whether the traction PROPAGATES. Folding it into the
// derivation would move phrases between bands that are correctly graded today in order to express a
// property every shipped cryptogram should have -- which is what a floor is for.
const MIN_LINKAGE = 1 / 3

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
 * The share of a phrase's TILES whose letter appears in two or more of its words.
 *
 * TILES AND NOT DISTINCT LETTERS, which is the choice that makes this a usable number. A count of
 * cross-word letters does not scale with the board -- three shared letters is most of a fourteen-
 * tile puzzle and a rounding error on a thirty-tile one -- so the same count means opposite things
 * at the two ends of the admitted range. A share means one thing everywhere: how much of what the
 * player is looking at can be carried from somewhere else.
 *
 * WITHIN-WORD REPEATS DO NOT COUNT, exactly as they do not in phrazle/difficulty.ts's
 * sharedLetterCount, and for a different reason: there, a repeat buys no second row; here, it buys
 * no second word to spend the crack in. HIGH NOON scores zero on both.
 *
 * Exported for the tests, which pin the metric itself rather than only the predicate that reads it.
 * Returns 0 rather than NaN on a letterless phrase, for the reason repetitionOf is guarded.
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
 * The four bounds a phrase must clear to be a cryptogram at ALL, independent of difficulty.
 *
 * Separate from the derived difficulty on purpose: a phrase can sit perfectly in a band and still be
 * unplayable, and a floor folded into the band would be re-argued every time the band moved. The
 * linkage clause is the clearest case this file has of that distinction -- see MIN_LINKAGE.
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
