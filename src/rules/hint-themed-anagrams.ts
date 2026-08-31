// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. The tests travel with the rule so the copy is proved to BEHAVE
// rather than merely to match a diff.
//
// It lives here rather than shipping as data on the puzzle because it runs over which of the four
// answers the player has already got, which no generator can enumerate in advance. lull-api ships no
// themed anagram hints at all; it executes this file only in the fixture sweep.
//
// THE REVEAL AXIS IS POSITION AND NOTHING ELSE. The scramble is on screen, so its length and its
// letter multiset are already known to the player -- a rung that named either would spend a hint on
// something they can read off their own board. The only thing left to give is WHICH LETTER GOES
// WHERE, which is why all three rungs are prefixes and ends.
//
// THE SIGNATURE IS THE ENFORCEMENT: this file never receives the theme, so a composer that cannot
// reach it cannot leak it. That is stronger than a rule someone has to remember.

export type ThemedAnagramsSpentRung = { entryIndex: number; kind: 'bookends' | 'initial' | 'prefix3' }

export interface AnagramHintEntry {
  answer: string
}

export interface ThemedAnagramsPlayerState {
  solved: boolean[]
}

const RUNG_COUNT = 3
const PREFIX_LENGTH = 3

// This type's own cap. The longest rung is the bookends sentence over a nine-letter answer, well
// inside 80. Asserted in the test rather than enforced here.
export const MAX_ANAGRAM_RUNG_LENGTH = 80

const ORDINALS = ['1st', '2nd', '3rd', '4th']

/**
 * Unsolved entry indices, longest answer first, ties broken by position.
 *
 * LONGEST FIRST because the largest permutation space is the only "hardest" ranking code owns, and a
 * player opening a rung is stuck. Applied to the UNSOLVED set rather than to all four, which is the
 * whole difference from the ladder this replaced: a rung spent on a word already on the board is a
 * rung spent on nothing.
 */
const ranked = (entries: AnagramHintEntry[], state: ThemedAnagramsPlayerState): number[] =>
  entries
    .map((entry, index) => ({ index, length: entry.answer.length }))
    .filter(({ index }) => !state.solved[index])
    .sort((left, right) => right.length - left.length || left.index - right.index)
    .map(({ index }) => index)

/**
 * The next rung, or null when the ladder is spent or every entry is solved.
 *
 * WHICH RULE RUNS IS POSITIONAL: initial, then bookends, then a three-letter prefix. It escalates in
 * how much of one word it gives rather than in how many words it touches.
 *
 * EACH RUNG PREFERS AN ENTRY THE LADDER HAS NOT USED, so three rungs normally light up three of the
 * four rows. When only one entry is left unsolved they stack on it, and rung 3 prefers RUNG 1's
 * entry over rung 2's -- rung 1 gave only an initial, so a prefix there adds two letters where a
 * prefix on rung 2's entry would add one the bookends rung already implied.
 */
export const chooseThemedAnagramsRung = (
  entries: AnagramHintEntry[],
  state: ThemedAnagramsPlayerState,
  spent: ThemedAnagramsSpentRung[],
): ThemedAnagramsSpentRung | null => {
  if (spent.length >= RUNG_COUNT) return null

  const available = ranked(entries, state)
  if (available.length === 0) return null

  const used = spent.map((rung) => rung.entryIndex)
  const unused = available.find((index) => !used.includes(index))

  if (spent.length === 0) return { entryIndex: available[0], kind: 'initial' }
  if (spent.length === 1) return { entryIndex: unused ?? available[0], kind: 'bookends' }

  // Rung 3. A fresh entry if there is one; otherwise rung 1's if it is still unsolved; otherwise
  // whatever is left.
  const preferred = available.includes(used[0]) ? used[0] : available[0]
  return { entryIndex: unused ?? preferred, kind: 'prefix3' }
}

/** The sentence for a frozen rung. Pure in `entries`, so a spent rung reads the same forever. */
export const themedAnagramsHintFor = (entries: AnagramHintEntry[], rung: ThemedAnagramsSpentRung): { text: string } => {
  const answer = entries[rung.entryIndex]?.answer ?? ''
  const ordinal = ORDINALS[rung.entryIndex] ?? `${rung.entryIndex + 1}th`

  if (rung.kind === 'initial') return { text: `The ${ordinal} answer starts with ${answer[0] ?? '?'}.` }
  if (rung.kind === 'bookends') {
    return {
      text: `The ${ordinal} answer starts with ${answer[0] ?? '?'} and ends with ${answer[answer.length - 1] ?? '?'}.`,
    }
  }
  return { text: `The ${ordinal} answer starts with ${answer.slice(0, PREFIX_LENGTH)}.` }
}

/**
 * Which positions of one entry's answer the spent rungs have revealed.
 *
 * A UNION OVER RUNGS, because two rungs can land on the same entry when the others are solved. The
 * caller passes the answer's length rather than the answer, so this cannot be used to read letters.
 */
export const pinnedIndices = (
  spent: ThemedAnagramsSpentRung[],
  entryIndex: number,
  answerLength: number,
): Set<number> => {
  const pinned = new Set<number>()
  for (const rung of spent) {
    if (rung.entryIndex !== entryIndex) continue
    if (rung.kind === 'initial' && answerLength > 0) pinned.add(0)
    if (rung.kind === 'bookends' && answerLength > 0) {
      pinned.add(0)
      pinned.add(answerLength - 1)
    }
    if (rung.kind === 'prefix3') {
      for (let index = 0; index < Math.min(PREFIX_LENGTH, answerLength); index += 1) pinned.add(index)
    }
  }
  return pinned
}

/**
 * The scramble to draw, with revealed letters standing in their true positions.
 *
 * Revealed letters are PINNED at their real indices; every other position is filled from the current
 * scramble in its own order, skipping ONE occurrence per pinned letter. So the tiles the player was
 * already reading stay in the order they were reading them, and the hint moves only what it bought.
 *
 * ONE OCCURRENCE, NOT EVERY OCCURRENCE, and that is what keeps the letter multiset right on a word
 * like KETTLE: pinning one E must not remove the other from the pool.
 *
 * THE POOL IS TAKEN FROM THE SCRAMBLE rather than re-shuffled, which was the alternative. A fresh
 * shuffle churns letters the player is actively reading, so the board would change more than the
 * hint justifies. Choosing a different pre-gated scramble was also rejected: the generator's severity
 * dial MINIMIZES positional agreement, so usually no member of `scrambles` has the letter in place.
 */
export const pinnedDisplay = (answer: string, scramble: string, pinned: ReadonlySet<number>): string => {
  const pool = [...scramble]
  for (const index of pinned) {
    const at = pool.indexOf(answer[index])
    if (at >= 0) pool.splice(at, 1)
  }

  let next = 0
  return [...answer].map((letter, index) => (pinned.has(index) ? letter : (pool[next++] ?? letter))).join('')
}
