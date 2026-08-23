import { splitPhrase } from '../../rules/is-valid-guess'
import { Difficulty, Phrase } from '../../types'

// What a phrase IS, with the generator's appetite kept out of it -- the same split
// cryptogram/difficulty.ts makes, for the same reason: a floor folded into a band would be re-argued
// every time the band moved.

// EXPORTED because scripts/build-dictionary.ts imports both. That import is the whole of the
// "provably lossless" claim the committed slice makes -- a guess word must match one of the answer's
// per-word lengths, and no answer word can be outside this range -- and a bare `const` here would
// leave the derivation free to drift from the predicate.
export const MIN_WORD_LETTERS = 3
export const MAX_WORD_LETTERS = 7

// PRIVATE. Nothing outside this module reads them.
const MIN_WORDS = 2
const MAX_WORDS = 3
const MAX_TOTAL_LETTERS = 18

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

/**
 * THE ONE SPLITTER, re-exported under this module's name rather than reimplemented.
 *
 * difficulty.test.ts asserts `wordsOf === splitPhrase` BY IDENTITY, so the structural floor, the
 * derived difficulty, the dictionary clause, the hint ladder and the board all count the same words.
 * A behavioural comparison would pass over two implementations that agree on the cases someone
 * thought to write down; identity makes a second splitter unrepresentable.
 */
export const wordsOf = splitPhrase

/**
 * How many DISTINCT letters appear in two or more of the words.
 *
 * Cross-word only: a letter repeated inside one word is not sharing, which is why HIGH NOON scores
 * zero despite 1.60 tiles per distinct letter. Read by derivedDifficulty and by nothing else -- it is
 * a nudge, never a gate.
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
 * THREE BOUNDS, all conjunctive, all read off `phrase.text` and nothing else -- which is what lets
 * this run before anything expensive:
 *
 *   word count      2-3    The board is words. Four is a paragraph on a phone.
 *   per-word length 3-7    A two-letter word is a free tile; eight or more will not fit beside a
 *                          second word on a 320 viewport.
 *   total letters   <= 18  Six guesses over more than eighteen tiles is not a 3-5 minute puzzle.
 *
 * plus the CANONICALITY guard below, which is a contract clause rather than a fourth bound.
 *
 * THERE IS NO CROSS-WORD-SHARING CLAUSE, and its absence is a decision rather than an omission. An
 * earlier draft required one letter in two words on the ground that "below this no purple tile can
 * ever appear". That is false -- purple depends on the GUESS, and mark-guess.test.ts ships GRAB HUE
 * against BEAR HUG producing two purples on an answer whose words share nothing. The fallback
 * "sharing raises the purple rate" is also false, and measurably backwards: 59.8% mean purple rate
 * for answers sharing a letter against 67.4% for answers sharing none, because a shared letter is
 * more likely to be spent as a green or a yellow before pass 3 reaches it. The clause was rejecting
 * a fifth of the compact supply, two thirds of it band-5 material, on a premise that does not hold.
 * difficulty.test.ts pins BEAR HUG PASSING, which is the headstone.
 *
 * `phrase.shape` IS NEVER READ. The tag is model-authored, so gating on it is a gate the model
 * controls, and a mis-tag would become a silently starved band on top of a loud one. Accepting a
 * structurally compact `title` is a FEATURE -- measured, band-5 supply comes as much from short
 * three-word titles as from tagged compacts.
 */
export const meetsStructuralFloor = (phrase: Phrase): boolean => {
  const words = wordsOf(phrase.text)
  // THE CANONICALITY GUARD, and it is a content-safety control as much as a shape one. `answer`
  // ships splitPhrase(text).join(' '), so a phrase whose text is not already canonical up to spacing
  // and case would have a player-visible string COMPOSED IN CODE out of characters the upstream
  // content gates saw differently -- IT'S A WRAP would ship as ITS A WRAP, and CATCH-22 as CATCH22,
  // each a token no blocklist ran over. Rejecting rather than stripping means the shipped answer is
  // always the gated text, uppercased and single-spaced, and nothing more.
  //
  // A belt on top of an existing brace: ALLOWED_CHARACTERS in services/phrases.ts already keeps
  // digits and punctuation out of `phrase.text`. It is still written, because normalizeAnswer KEEPS
  // digits and would happily return ['CATCH', '22'] the day that upstream rule moves.
  if (words.join(' ') !== phrase.text.trim().toUpperCase().replace(/\s+/g, ' ')) {
    return false
  }
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    words.every((word) => word.length >= MIN_WORD_LETTERS && word.length <= MAX_WORD_LETTERS) &&
    words.join('').length <= MAX_TOTAL_LETTERS
  )
}

// The floor admits 6 to 18 letters, but the phrases the prompt actually returns cluster at 7 to 14.
// Thresholds are set against the MEASURED distribution rather than the theoretical range, which is
// the lesson cryptogram/difficulty.ts paid for: an absolute threshold set against the range applied
// one constant nudge to practically the whole corpus and left a band empty by construction.
const widthOf = (letters: number): number => (letters <= 7 ? 3 : letters <= 10 ? 4 : 5)

/**
 * How hard this phrase is as a Phrazle, 1-5. STRUCTURAL, and familiarity is deliberately not in it.
 *
 * Board width is what a Wordle-like's difficulty actually is: seven tiles and eighteen tiles are
 * different games. Word count adds a row of independent unknowns, and is the catalog's own second
 * dial.
 *
 * THE SHARED-LETTER TERM IS LETTER ECONOMY, NOT PURPLE. An earlier draft justified it as "more
 * purple signal is more information per guess", which is measurably backwards (see the floor above).
 * What sharing actually buys the player is a SMALLER ALPHABET: a letter in two words is one
 * discovery that constrains two rows, so the board has fewer distinct unknowns per tile. Measured,
 * every phrase with sharedLetterCount >= 2 has at least 1.27 tiles per distinct letter against 1.00
 * for BEAR HUG and BLIND SPOT. It is a proxy and it is stated as one.
 *
 * FAMILIARITY IS REJECTED on two grounds, and both are about supply rather than taste. An obscurity
 * dial would make band 5 require compact AND challenging -- two independent unenforced prompt
 * instructions at roughly 1/3 x 1/3, which is the empty-by-construction failure
 * cryptogram/difficulty.ts documents at length. And familiarity defaults to 3 when review does not
 * run, while reviewPhrases catches its own errors and returns its input unchanged -- so on any night
 * the review call fails, an obscurity-driven dial derives every phrase to one band and one of this
 * type's two puzzles starves. A dial computed from `text` survives a failed review pass intact.
 *
 * The honest cost: this rates an instantly recognizable eighteen-tile phrase harder than an obscure
 * seven-tile one and cannot see the difference. Accepted -- in a six-guess game with letter feedback
 * obscurity matters far less than in Cryptogram, which gives a player nothing but frequency until
 * recognition fires. The familiarity signal is not discarded; it is spent where it works.
 *
 * GUESS COUNT AS THE DIAL IS ALSO REJECTED: it contradicts the catalog's flat "six attempts" and
 * makes the game shorter rather than harder, which is not the same thing.
 */
export const derivedDifficulty = (phrase: Phrase): Difficulty => {
  const words = wordsOf(phrase.text)
  const raw =
    widthOf(words.join('').length) +
    // A third row is a row of independent unknowns.
    (words.length === MAX_WORDS ? 1 : 0) -
    // Fewer DISTINCT letters to find.
    (sharedLetterCount(words) >= 2 ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
