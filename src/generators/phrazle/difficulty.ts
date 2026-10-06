import { splitPhrase } from '../../rules/is-valid-guess'
import { Difficulty, Phrase } from '../../types'

// What a phrase IS. The generator's appetite (difficulty tolerance) lives in generator.ts.

// Exported because scripts/build-dictionary.ts asserts the committed dictionary slice CONTAINS this
// range. Narrowing the floor must never shrink a served asset.
export const MIN_WORD_LETTERS = 2
// A bound on what the PLAYER must produce, not on what the board can hold: a guess needs a real
// word at every one of the answer's word lengths, so the longest word is the cost of typing at all.
// Cheap -- two answers in 160 across 52 shipped packs carried a word above nine.
export const MAX_WORD_LETTERS = 9

// The longest word a player can comfortably invent a guess for. Eight and nine stay legal and lose
// every tie in the allocator; see reluctanceOf.
export const COMFORTABLE_WORD_LETTERS = 7

const MIN_WORDS = 2
const MAX_WORDS = 6
// Below nine tiles a board is not an easy Phrazle, it is a bad one, and no difficulty makes it good.
const MIN_TOTAL_LETTERS = 9
const MAX_TOTAL_LETTERS = 30

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

/**
 * The one splitter, re-exported rather than reimplemented. difficulty.test.ts asserts
 * `wordsOf === splitPhrase` by identity, so the floor, the difficulty and the dictionary clause all
 * count the same words. lull-ui's board counts them with its own vendored copy of
 * rules/is-valid-guess.ts, and nothing checks that the two copies match.
 */
export const wordsOf = splitPhrase

/**
 * How many DISTINCT letters appear in two or more of the words.
 *
 * Cross-word only: a letter repeated inside one word is not sharing, so HIGH NOON scores zero. Read
 * by derivedDifficulty and nothing else -- a nudge, never a gate.
 */
export const sharedLetterCount = (words: string[]): number => {
  const wordsPerLetter: Record<string, number> = {}
  for (const word of words) {
    for (const letter of new Set(word)) {
      wordsPerLetter[letter] = (wordsPerLetter[letter] ?? 0) + 1
    }
  }
  return Object.values(wordsPerLetter).filter((count) => count >= 2).length
}

/**
 * Whether this phrase can be a Phrazle at ALL, independent of difficulty.
 *
 * Word count 2-6 (one board row each), per-word length 2-9, total letters 9-30, plus the
 * canonicality guard below. All read off `phrase.text`, so this runs before anything expensive.
 *
 * The nine-tile minimum is a floor rather than a difficulty term: under it a guess buys too few
 * tiles of feedback, and no rating makes such a board good.
 *
 * `phrase.shape` is never read: the tag is model-authored, so gating on it is a gate the model
 * controls, and a mis-tag would silently starve a band.
 */
export const meetsStructuralFloor = (phrase: Phrase): boolean => {
  const words = wordsOf(phrase.text)
  // Canonicality guard, a content-safety control as much as a shape one: `answer` ships
  // splitPhrase(text).join(' '), so a non-canonical text puts a code-composed player-visible string
  // past the upstream content gates -- IT'S A WRAP as ITS A WRAP, CATCH-22 as CATCH22, tokens no
  // blocklist ran over. Rejecting rather than stripping keeps the shipped answer equal to the
  // gated text.
  if (words.join(' ') !== phrase.text.trim().toUpperCase().replace(/\s+/g, ' ')) {
    return false
  }
  const letters = words.join('').length
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    words.every((word) => word.length >= MIN_WORD_LETTERS && word.length <= MAX_WORD_LETTERS) &&
    letters >= MIN_TOTAL_LETTERS &&
    letters <= MAX_TOTAL_LETTERS
  )
}

// Board width in TILES, which is what the player actually faces. The cuts span the floor's whole
// 9-to-30 range and sit where the measured corpus (52 shipped packs) is thin rather than
// mid-cluster; derived 1 starts at 9-12 tiles.
const widthOf = (letters: number): number =>
  letters <= 12 ? 1 : letters <= 15 ? 2 : letters <= 18 ? 3 : letters <= 22 ? 4 : 5

const longestWordOf = (words: string[]): number => Math.max(...words.map((word) => word.length))

/**
 * How reluctantly to spend this phrase: 0 within COMFORTABLE_WORD_LETTERS, then one per letter
 * over, so a nine ships only where an eight would not fit either. Every guess needs a real word at
 * the longest row's length, which makes that row the cost of typing anything at all.
 */
export const reluctanceOf = (phrase: Phrase): number =>
  Math.max(0, longestWordOf(wordsOf(phrase.text)) - COMFORTABLE_WORD_LETTERS)

/**
 * How hard this phrase is as a Phrazle, 1-5, from the board's structure alone.
 *
 * Board width dominates; word count adds a row of independent unknowns. The shared-letter term is
 * letter economy -- a letter in two words is one discovery constraining two rows. A long word is
 * NOT a term: it would grade long words into the hard band, where reluctanceOf exists to keep them
 * rare.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const words = wordsOf(phrase.text)
  const raw =
    widthOf(words.join('').length) +
    // Rows of independent unknowns. Comparisons rather than `=== MAX_WORDS`, which would re-grade
    // the whole catalog the moment MAX_WORDS moved.
    (words.length >= 5 ? 2 : words.length >= 4 ? 1 : 0) -
    // Fewer DISTINCT letters to find.
    (sharedLetterCount(words) >= 2 ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
