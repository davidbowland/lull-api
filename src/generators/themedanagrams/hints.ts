import { AnagramEntry, ThemedAnagramsHint, ThemedAnagramsHintLadder } from '../../types'

// THREE CODE-AUTHORED RUNGS, each about a DIFFERENT entry, escalating in kind.
//
// One ladder for the set, never per-entry ladders: three rungs per word is a hint budget nothing
// else in the catalog has, and it is a new wire shape for one type. And never escalation on one
// entry, which spends the whole ladder on a quarter of the puzzle.
//
// A RUNG MUST NOT SPEND ITSELF ON THE WORD'S LENGTH. The scramble is on screen, so its length and
// its letter multiset are already known to the player. The only thing a rung can add is POSITION --
// which letter goes where -- so the reveal axis is positional and nothing else.
//
//   rung 1  the SECOND-LONGEST answer  first letter
//   rung 2  the THIRD-LONGEST          first and last letter
//   rung 3  the LONGEST                the whole answer
//
// The strongest reveal lands on the longest answer because a player who has opened all three rungs
// is stuck, and the largest permutation space is the only "hardest" ranking code owns. The SHORTEST
// entry is never named: it is the one they most likely already have, so a rung spent on it is a rung
// spent on nothing.

// 0-based position in `entries`. Four members rather than goFigure's three, because goFigure's is
// closed at three by its bank size and this type ships four entries. The same shape, not a copy.
type EntrySlot = 0 | 1 | 2 | 3

const ORDINALS: Record<EntrySlot, string> = { 0: '1st', 1: '2nd', 2: '3rd', 3: '4th' }

// This type's own G2 cap, and deliberately not the 200 sized for model prose. The longest rung this
// composer can produce is an ordinal, a fixed template and a nine-letter answer -- under 50
// characters -- so the tighter cap is free, and it is what keeps the type inside its per-puzzle byte
// budget. It is asserted in hints.test.ts rather than enforced here: a composer that cannot reach
// anything unbounded has nothing to reject.
export const MAX_ANAGRAM_RUNG_LENGTH = 80

/**
 * Entry indices ranked by answer length descending, ties broken by entry index ascending.
 *
 * A pure function of the entries, so the ladder is deterministic and no test has to pin a random
 * source.
 */
const rankedIndices = (entries: AnagramEntry[]): number[] =>
  entries
    .map((entry, index) => ({ index, length: entry.answer.length }))
    .sort((left, right) => right.length - left.length || left.index - right.index)
    .map(({ index }) => index)

/**
 * The three-rung ladder for one Themed Anagrams puzzle.
 *
 * ONE ARGUMENT, and the theme is NOT it. A code-authored rung may interpolate only answer substrings
 * and integers, and the enforcement is the signature: a composer that cannot reach the theme cannot
 * leak it, which is stronger than a rule someone has to remember. hints.test.ts additionally asserts
 * the theme appears in no rung.
 */
export const buildHints = (entries: AnagramEntry[]): ThemedAnagramsHintLadder => {
  const [longest, secondLongest, thirdLongest] = rankedIndices(entries)

  const initial = (index: number): ThemedAnagramsHint => ({
    metadata: { entryIndex: index, kind: 'themedanagrams-entry', reveal: 'initial' },
    text: `The ${ORDINALS[index as EntrySlot]} answer starts with ${entries[index].answer[0]}.`,
  })

  const bookends = (index: number): ThemedAnagramsHint => {
    const { answer } = entries[index]
    return {
      metadata: { entryIndex: index, kind: 'themedanagrams-entry', reveal: 'bookends' },
      text: `The ${ORDINALS[index as EntrySlot]} answer starts with ${answer[0]} and ends with ${answer[answer.length - 1]}.`,
    }
  }

  const whole = (index: number): ThemedAnagramsHint => ({
    metadata: { entryIndex: index, kind: 'themedanagrams-entry', reveal: 'answer' },
    text: `The ${ORDINALS[index as EntrySlot]} answer is ${entries[index].answer}.`,
  })

  return [initial(secondLongest), bookends(thirdLongest), whole(longest)]
}
