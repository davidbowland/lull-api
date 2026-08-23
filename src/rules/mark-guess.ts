// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. The tests travel with the rule so the copy is proved to BEHAVE
// rather than merely to match a diff.
//
// It lives here rather than shipping as data on the puzzle because it runs over a guess the player
// invents at play time, which no generator can enumerate in advance -- the same criterion
// normalize-answer.ts names. Adding a file to this directory is a decision, not a convenience, and
// the condition it was granted on is that lull-api itself executes it: generators/phrazle
// round-trips every shipped answer through both files before the puzzle is allowed to exist.

export type TileState = 'gray' | 'green' | 'purple' | 'yellow'

const countLetters = (word: string): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const letter of word) {
    counts[letter] = (counts[letter] ?? 0) + 1
  }
  return counts
}

/**
 * One TileState per guess letter, grouped by word.
 *
 * `guess` and `answer` are already uppercase A-Z words of matching count and matching per-word
 * lengths -- shape is isValidGuess's job, not this function's. Reaching here with the wrong shape
 * is a programming error and throws rather than silently producing a board.
 *
 * ONE LEDGER. `remaining` starts as the answer's letter counts per word, and EVERY color debits
 * it, so no letter of the answer is ever counted twice. The mandated invariant is
 *
 *   for every letter c:  green(c) + yellow(c) + purple(c) <= occurrences of c in the answer
 *
 * phrase-wide. A board showing FEWER colored tiles than the phrase justifies is conservative and
 * internally consistent -- every colored tile still corresponds to a real, distinct letter. A
 * board showing MORE is a lie the player can prove by counting. Given a choice between
 * under-informing and lying the adjudicator under-informs, which is the same reasoning that makes
 * gray the surplus state in Wordle.
 *
 * THE PASSES RUN GLOBALLY BY COLOR, and strictly left-to-right within each pass -- words
 * ascending, then positions ascending, which is reading order.
 *
 * Word-major traversal (all three passes for word 0, then all three for word 1) is REJECTED, and
 * the reason is narrower than it looks. Green-and-yellow word-major is not wrong; it is provably
 * IDENTICAL, because yellow reads and debits remaining[w] and nothing else, so a word-0 yellow
 * cannot take a letter word 1 needs for a green. What is actually wrong is PURPLE BEFORE A LATER
 * WORD'S GREEN: purple reads the phrase-wide sum, so it can spend a copy a later word's green is
 * entitled to. On answer TOE HOLD, guess HOT HAND, word-major prints a purple H in HOT and then a
 * green H in HAND -- two colored tiles for the phrase's one H, which is the board the catalog
 * published, and is the invariant broken rather than a precedence table inverted. That is why
 * every purple runs after every green, and mark-guess.test.ts pins it as a count.
 *
 * LEFT-TO-RIGHT IS ARBITRARY AND IS STILL WRITTEN DOWN. Greens are order-independent -- each claims
 * its own position, so total greens for a letter can never exceed its count in the answer. Yellows
 * and purples are not, because they contend for a shared budget. Two hand-copies drift on exactly
 * this kind of unpinned tie-break, so the order is specified rather than proved irrelevant.
 *
 * A CORRECT GUESS IS ALL GREEN BY CONSTRUCTION: pass 1 consumes every letter of every answer word,
 * so the ledger is empty by the time passes 2 and 3 run. Phrazle needs no separate answer-comparison
 * rule, and deliberately has none -- a solve is this function returning nothing but green.
 */
export const markGuess = (guess: string[], answer: string[]): TileState[][] => {
  if (guess.length !== answer.length || guess.some((word, index) => word.length !== answer[index].length)) {
    throw new Error('Guess and answer do not have the same shape')
  }

  const remaining = answer.map(countLetters)
  // Array.from rather than `new Array(n)`, and it is not a style choice: `new Array(n)` is SPARSE,
  // and Array.prototype.map skips holes, so the final gray fill below would leave `undefined` in
  // every uncolored cell instead of 'gray'. Caught by toStrictEqual on the fixture boards.
  const tiles: (TileState | undefined)[][] = guess.map((word) =>
    Array.from<TileState | undefined>({ length: word.length }),
  )

  // Pass 1 -- green. Words ascending, positions ascending.
  for (let word = 0; word < guess.length; word++) {
    for (let position = 0; position < guess[word].length; position++) {
      const letter = guess[word][position]
      if (letter === answer[word][position]) {
        tiles[word][position] = 'green'
        remaining[word][letter]--
      }
    }
  }

  // Pass 2 -- yellow. Unmarked tiles only, drawing from THIS WORD's remaining pool and no other.
  // That is the precedence table made mechanical: a tile is never yellow when the letter's only
  // remaining copy is in another word.
  for (let word = 0; word < guess.length; word++) {
    for (let position = 0; position < guess[word].length; position++) {
      const letter = guess[word][position]
      if (tiles[word][position] === undefined && (remaining[word][letter] ?? 0) > 0) {
        tiles[word][position] = 'yellow'
        remaining[word][letter]--
      }
    }
  }

  // Pass 3 -- purple. Unmarked tiles only, drawing from the PHRASE-WIDE leftovers, debiting the
  // lowest-index donor.
  //
  // THE LEMMA THAT MAKES THIS SAFE, and it is why there is no exclusion term in the code: any tile
  // left unmarked after pass 2 has remaining[its own word][letter] === 0 -- either it never had a
  // copy, or an earlier tile of the same word took the last one. So the sum a purple reads contains
  // only copies OUTSIDE its own word. The donor's identity cannot change any other tile's color;
  // only the count can, and the count is donor-independent.
  //
  // THE IMPLICATION RUNS ONE WAY. Purple implies "an unspent copy remains elsewhere in the phrase
  // and none in this word". It is not implied by it: the fixture table's first row ships a GRAY H
  // whose letter IS in the phrase, because the phrase's only H was already spent by a green. A
  // definition of Purple or Gray written as a MEMBERSHIP test -- "the letter is/is not in the
  // phrase" -- describes an assignment outcome by the wrong quantity and is false on that board.
  for (let word = 0; word < guess.length; word++) {
    for (let position = 0; position < guess[word].length; position++) {
      const letter = guess[word][position]
      if (tiles[word][position] === undefined) {
        const donor = remaining.findIndex((counts) => (counts[letter] ?? 0) > 0)
        if (donor !== -1) {
          tiles[word][position] = 'purple'
          remaining[donor][letter]--
        }
      }
    }
  }

  // Every tile still unmarked is gray.
  return tiles.map((word) => word.map((tile) => tile ?? 'gray'))
}
