import { splitPhrase } from '../../rules/is-valid-guess'
import { Difficulty, Phrase } from '../../types'

// What a phrase IS, with the generator's appetite kept out of it -- the same split
// cryptogram/difficulty.ts makes, for the same reason: a floor folded into a band would be re-argued
// every time the band moved.

// EXPORTED because scripts/build-dictionary.ts reads both. The committed slice must CONTAIN this
// range -- a guess word must match one of the answer's per-word lengths, so a word outside it can
// never appear in a valid guess -- and the script asserts that containment rather than deriving the
// list from these two numbers directly. That is a change, and the reason is the direction of travel:
// narrowing the floor must never shrink a served asset. See the note on DICTIONARY_MAX_WORD_LETTERS
// there.
export const MIN_WORD_LETTERS = 2
// NINE, DOWN FROM ELEVEN, and it is a rule about what the PLAYER has to produce rather than about
// what the board can hold. A guess must supply a real English word at every one of the answer's word
// lengths, so the longest word is the binding cost of typing anything at all -- an eleven-letter row
// means inventing an eleven-letter word before the board will take a single tile, every day. Nine is
// where that stops being the puzzle. Measured over 52 shipped packs it costs almost nothing: two
// answers in 160 carried a word above nine (COMMERCIAL, MUSKETEERS) and none carried eleven, so the
// cap mostly forecloses a shape the corpus was going to keep offering rather than removing one it
// leans on.
export const MAX_WORD_LETTERS = 9

// PRIVATE. Nothing outside this module reads them.
const MIN_WORDS = 2
const MAX_WORDS = 6
// NINE TILES, AND THIS BOUND IS NEW. See the floor's docblock: below it a board is not an easy
// Phrazle, it is a bad one, and no difficulty makes it good.
const MIN_TOTAL_LETTERS = 9
const MAX_TOTAL_LETTERS = 30

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5

/**
 * THE ONE SPLITTER, re-exported under this module's name rather than reimplemented.
 *
 * difficulty.test.ts asserts `wordsOf === splitPhrase` BY IDENTITY, so the structural floor, the
 * derived difficulty, the dictionary clause and the board all count the same words. A behavioral
 * comparison would pass over two implementations that agree on the cases someone thought to write
 * down; identity makes a second splitter unrepresentable.
 *
 * THE HINT LADDER WAS ON THAT LIST AND HAS LEFT IT -- not because it stopped counting words, but
 * because it stopped being built here. It is composed on the device by lull-ui's
 * src/components/phrazle/rungs.ts, which imports splitPhrase from that repo's vendored copy of
 * rules/is-valid-guess: the same function this module re-exports, so the identity survives the move.
 * It survives the REPO boundary only as far as the vendored copy of is-valid-guess.ts does, and
 * nothing here or there checks that the two copies match -- the tests traveling with that rule are
 * what hold it.
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
 * FOUR BOUNDS, all conjunctive, all read off `phrase.text` and nothing else -- which is what lets
 * this run before anything expensive:
 *
 *   word count      2-6    The board is words, one row each.
 *   per-word length 2-9
 *   total letters   9-30
 *
 * THE NINE-TILE MINIMUM IS THE NEWEST OF THEM AND IT REPLACES A DIFFICULTY ARGUMENT WITH A FLOOR.
 * SEE RED, WING IT, HANG TEN, WIPE OUT, CASH COW -- six and seven tiles across two rows -- were
 * shipping as the day's EASY Phrazle, which is the one rating a six-tile board cannot carry: a guess
 * buys six tiles of feedback, there is no redundancy to read the phrase out of, and two three-letter
 * rows are nearly unconstrained. The first draft of this change graded them harder instead, and that
 * was wrong in a way worth recording -- it would have put a six-tile board in the day's HARD slot,
 * where it is not good either. A board that is bad at every difficulty is a floor, not a curve.
 * Measured over 52 shipped packs, eight answers in 160 fall under nine tiles.
 *
 * THESE WERE 2-3 WORDS, 3-7 LETTERS AND 18 TOTAL, and every one of those bounds was doing the same
 * damage. A 2-3 word floor with a 3-letter minimum admits ONLY 3+3, 3+4 and 4+3 at the easy end,
 * because 2 words of 3+ letters under 7 total has no other arrangement -- which is why every easy
 * Phrazle was TEA TIME, SEA LEGS or HOT SHOT, and why two of the three shipped daily were that one
 * shape. It also excluded the entire class of phrase this game is most fun on: KNOCK YOUR SOCKS OFF
 * is 17 letters of 3-to-5-letter words and was rejected for the single reason that it has four of
 * them, and PIECE OF THE ACTION for the single reason that OF is two letters.
 *
 * The 3-letter minimum was justified as "a two-letter word is a free tile". It is, and that is the
 * price: English idioms of four or more words are built on of/in/it/at/to/up/on, so the rule that
 * made each board marginally less free made the whole long-phrase class unreachable.
 *
 * A wider floor is a wider BOARD -- up to six rows, where it was three -- so lull-ui renders more
 * rows than it ever has. That is a real client-side consequence and it is named here rather than
 * discovered.
 *
 * IT ONCE COST DOWNLOAD AND THE PER-WORD CAP COMING BACK DOWN DOES NOT REFUND IT, which is the one
 * asymmetry to keep straight here. Widening 3-7 to 2-11 took the committed guess dictionary from
 * 51,852 words and 0.11 MB gzipped to 141,047 and 0.34 MB. Narrowing the cap to 9 leaves that file
 * BYTE-IDENTICAL on purpose: the served list is frozen and additive, a client cached on v1 must keep
 * working, and a slice that is larger than the floor needs is still provably lossless because a
 * guess is checked against the ANSWER's word lengths as well as against the list. So the dictionary
 * keeps its own bounds, asserted to contain these; see scripts/build-dictionary.ts.
 *
 * plus the CANONICALITY guard below, which is a contract clause rather than a fifth bound.
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
  const letters = words.join('').length
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    words.every((word) => word.length >= MIN_WORD_LETTERS && word.length <= MAX_WORD_LETTERS) &&
    letters >= MIN_TOTAL_LETTERS &&
    letters <= MAX_TOTAL_LETTERS
  )
}

// RECALIBRATED WITH THE FLOOR, because the old thresholds cannot grade the board that now exists.
// They ran 3/4/5 over a 6-to-18 range and saturated at 5 from eleven letters up -- so under a floor
// admitting thirty, every phrase past eleven letters graded identically and KNOCK YOUR SOCKS OFF
// would have been indistinguishable from TEA LEAF's big brother. The curve has to span the range it
// is given or the extra room buys nothing.
//
// Bands are set against what the player actually faces, which is TILES, and the boundaries sit where
// the measured corpus is thin rather than mid-cluster.
//
// RECUT AGAINST 52 SHIPPED PACKS, because the old cuts ran 1..5 over a range starting at 6 and the
// floor now starts at 9. Its first band was `letters <= 7`, which under a two-word phrase with a
// shared letter is the ONLY route to a derived 1 -- and derived 1 is the one cell band 2 has to
// itself, so bestFitIndex, which spends the narrowest phrase first, handed the day's EASY Phrazle
// the smallest board in the pool every single night. That is the mechanism behind "the easy ones are
// always 3+4 or 3+3": not a taste in the curve, an interaction between a cut and a selection rule.
// The floor now rejects those boards outright and these cuts put derived 1 at 9-12 tiles.
const widthOf = (letters: number): number =>
  letters <= 12 ? 1 : letters <= 15 ? 2 : letters <= 18 ? 3 : letters <= 22 ? 4 : 5

// THE LONGEST ROW, WHICH IS WHAT A GUESS COSTS TO TYPE. Board width says how much feedback a guess
// buys; this says what the player has to come up with before they can buy any of it, and the two are
// not the same board. Fourteen tiles as 4+2+4+4 is a phrase you can guess into with ordinary words;
// the same fourteen as 7+7 is two seven-letter words you must invent first, and KNUCKLE SANDWICH
// graded identically to FALL ON DEAF EARS without this term.
//
// ONE STEP AND ONE THRESHOLD, not a second curve. MAX_WORD_LETTERS caps the input at 9, so this
// spans 2..9 and there is not enough range in it to justify more; eight is where the corpus stops
// offering a word most players produce on demand.
const longestWordOf = (words: string[]): number => Math.max(...words.map((word) => word.length))

/**
 * How hard this phrase is as a Phrazle, 1-5. STRUCTURAL, and familiarity is deliberately not in it.
 *
 * Board width is most of what a Wordle-like's difficulty is: nine tiles and twenty-eight tiles are
 * different games. Word count adds a row of independent unknowns, and is the catalog's own second
 * dial. The longest row is the third and it is a different quantity from the first two -- what the
 * player must SUPPLY rather than what they get back.
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
 * ten-tile one and cannot see the difference. Accepted -- in a six-guess game with letter feedback
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
    // Rows of independent unknowns, and it is a COMPARISON rather than an equality now. It used to
    // read `words.length === MAX_WORDS`, which silently re-grades the whole catalog the moment
    // MAX_WORDS moves: at 6 that term would pay out only on six-word phrases and every three- and
    // four-word board would quietly lose the point it used to earn. Two steps, because the jump from
    // three rows to five is not the same jump as three to four.
    (words.length >= 5 ? 2 : words.length >= 4 ? 1 : 0) +
    // What the player must PRODUCE before a guess is even legal. See longestWordOf.
    (longestWordOf(words) >= 8 ? 1 : 0) -
    // Fewer DISTINCT letters to find.
    (sharedLetterCount(words) >= 2 ? 1 : 0)
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, raw)) as Difficulty
}
