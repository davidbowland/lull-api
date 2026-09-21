// HAZARD: this file is hand-copied into the sibling lull-ui repo and nothing verifies the copies
// match. Keep it dependency-free -- no Node built-ins, no SDK, no imports -- so it compiles in both
// a Lambda and a Next.js bundle, and copy it and its tests over in the same sitting as any change.
//
// It lives here rather than shipping as data on the puzzle because it runs over a guess the player
// invents at play time, which no generator can enumerate in advance.

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
 * `guess` and `answer` are already uppercase A-Z words of matching count and per-word lengths --
 * shape is isValidGuess's job. Reaching here otherwise is a programming error and throws.
 *
 * One ledger: `remaining` starts as the answer's letter counts per word and every color debits it,
 * enforcing, phrase-wide,
 *
 *   for every letter c:  green(c) + yellow(c) + purple(c) <= occurrences of c in the answer
 *
 * Passes run globally by color, left-to-right within each. Word-major traversal breaks the
 * invariant, because purple reads the phrase-wide sum and can spend a copy a later word's green is
 * entitled to: on answer TOE HOLD, guess HOT HAND, it prints two colored tiles for the one H.
 * Left-to-right is arbitrary but specified, since yellows and purples contend for a shared budget
 * and two hand-copies drift on an unpinned tie-break.
 *
 * A correct guess is all green by construction, so Phrazle needs no separate answer comparison.
 */
export const markGuess = (guess: string[], answer: string[]): TileState[][] => {
  if (guess.length !== answer.length || guess.some((word, index) => word.length !== answer[index].length)) {
    throw new Error('Guess and answer do not have the same shape')
  }

  const remaining = answer.map(countLetters)
  // Array.from, never `new Array(n)`: that is sparse, and map skips holes, so the gray fill below
  // would leave `undefined` in every uncolored cell.
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

  // Pass 2 -- yellow. Unmarked tiles only, drawing from this word's remaining pool and no other, so
  // a tile is never yellow when the letter's only remaining copy is in another word.
  for (let word = 0; word < guess.length; word++) {
    for (let position = 0; position < guess[word].length; position++) {
      const letter = guess[word][position]
      if (tiles[word][position] === undefined && (remaining[word][letter] ?? 0) > 0) {
        tiles[word][position] = 'yellow'
        remaining[word][letter]--
      }
    }
  }

  // Pass 3 -- purple. Unmarked tiles only, drawing from the phrase-wide leftovers, debiting the
  // lowest-index donor. No exclusion term is needed: any tile still unmarked after pass 2 has
  // remaining[its own word][letter] === 0, so the sum it reads holds only copies outside its word.
  // Purple implies an unspent copy elsewhere but not the converse -- a gray tile's letter may be in
  // the phrase, already spent by a green -- so neither color is a membership test.
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
