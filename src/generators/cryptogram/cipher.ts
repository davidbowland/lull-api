const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Rejection sampling, and the arithmetic says it is cheap: a uniform permutation of n letters has
// no fixed point with probability approaching 1/e, so P(reject) is about 63% and the expected
// number of shuffles is e, about 2.72. The cap is not a tuning knob -- it is the bound CLAUDE.md
// requires on any redraw loop, set far enough above the expectation that a legitimate run reaching
// it is a broken random source rather than bad luck.
const MAX_ATTEMPTS = 100

/**
 * A permutation of A-Z with no fixed point: no letter enciphers to itself.
 *
 * Returned plain-letter-keyed, so `cipher[letter]` is what the player SEES. The board is handed the
 * result of applying it and never learns it is a derangement -- a player may legitimately assign
 * C to C, and a board that knew better would be refusing a move on information it should not have.
 */
export const derange = (random: () => number = Math.random): Record<string, string> => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const shuffled = [...ALPHABET]
    // Fisher-Yates, downward, drawing from the untouched prefix only.
    for (let index = shuffled.length - 1; index > 0; index--) {
      // Clamped, because `random` is injectable and an out-of-range or NaN draw is silent
      // corruption rather than a crash: an unclamped `pick` of index + 1 reads past the end, and the
      // write-back then EXTENDS the array, so the derangement check still passes and `encipher` puts
      // the literal string "undefined" in the ciphertext. NaN needs its own arm -- Math.min/max
      // propagate it.
      const drawn = Math.floor(random() * (index + 1))
      const pick = Number.isFinite(drawn) ? Math.min(Math.max(drawn, 0), index) : 0
      const held = shuffled[index]
      shuffled[index] = shuffled[pick]
      shuffled[pick] = held
    }
    if (shuffled.every((letter, index) => letter !== ALPHABET[index])) {
      return Object.fromEntries(ALPHABET.map((letter, index) => [letter, shuffled[index]]))
    }
  }
  throw new Error('Could not build a derangement of the alphabet')
}
