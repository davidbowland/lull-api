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
// WHERE, which is why every rung names positions and nothing else.
//
// THE SIGNATURE IS THE ENFORCEMENT: this file never receives the theme, so a composer that cannot
// reach it cannot leak it. That is stronger than a rule someone has to remember.

export type ThemedAnagramsSpentRung = {
  entryIndex: number
  kind: 'bookends' | 'final' | 'initial' | 'inner2' | 'prefix3'
}

export interface AnagramHintEntry {
  answer: string
}

export interface ThemedAnagramsPlayerState {
  solved: boolean[]
}

const RUNG_COUNT = 3
const PREFIX_LENGTH = 3

// HOW MANY POSITIONS OF AN ENTRY A RUNG MUST LEAVE UNPINNED, counting the union of every rung
// already aimed at that entry. See chooseThemedAnagramsRung for why the invariant is stated over the
// union rather than argued per rung.
const MIN_FREE_POSITIONS = 2

// This type's own cap, derived. The longest rung is the inner pair -- "The 4th answer's 2nd and 3rd
// letters are P and A." -- at 49 characters, and no frame grows with the answer: every rung quotes at
// most three letters. MAX_WORD_LENGTH in generators/themedanagrams/words.ts is 9 and nothing here
// scales with it, so 80 is the shared hint cap with room to spare. Asserted in the test rather than
// enforced here.
export const MAX_ANAGRAM_RUNG_LENGTH = 80

const ORDINALS = ['1st', '2nd', '3rd', '4th']

/**
 * WHICH POSITIONS OF AN ANSWER EACH KIND NAMES, and the single source of truth for all of it.
 *
 * A kind IS a position set. That is the whole of this rewrite: `pinnedIndices` unions these to drive
 * the board's pinned display, the chooser intersects them to refuse a rung that would restate a
 * position an earlier rung already gave, and `themedAnagramsHintFor` composes a sentence that names
 * exactly this set and nothing else. Three readers, one table, so "which letters does this rung hand
 * over" cannot have two answers.
 *
 * Taken as a function of the LAST index rather than of the length, because two of the five are
 * anchored to the end and writing `answerLength - 1` five times is five chances to write it once as
 * `answerLength`.
 */
const POSITIONS: Record<ThemedAnagramsSpentRung['kind'], (last: number) => number[]> = {
  bookends: (last) => [0, last],
  final: (last) => [last],
  initial: () => [0],
  inner2: () => [1, 2],
  prefix3: () => [0, 1, 2],
}

/**
 * The positions one kind names on an answer of this length, clamped to the answer.
 *
 * CLAMPED RATHER THAN ASSUMED. A length-0 answer yields a last index of -1 and an empty set, which is
 * what makes every caller below total on a pack whose `answer` never arrived -- and an unclamped set
 * would inflate `pinnedIndices`, so the free-position count in `rungFor` would refuse rungs over
 * positions that are not there.
 */
const positionsOf = (kind: ThemedAnagramsSpentRung['kind'], answerLength: number): Set<number> =>
  new Set(POSITIONS[kind](answerLength - 1).filter((index) => index >= 0 && index < answerLength))

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
 * Which positions of one entry's answer the spent rungs have revealed.
 *
 * A UNION OVER RUNGS, because two rungs can land on the same entry when the others are solved. The
 * caller passes the answer's length rather than the answer, so this cannot be used to read letters.
 *
 * Declared above the chooser because the chooser's invariant is stated in terms of it: the union is
 * the thing being bounded, and a second implementation of "which positions does this ladder pin"
 * would be the drift this directory exists to prevent.
 */
export const pinnedIndices = (
  spent: ThemedAnagramsSpentRung[],
  entryIndex: number,
  answerLength: number,
): Set<number> => {
  const pinned = new Set<number>()
  for (const rung of spent) {
    if (rung.entryIndex !== entryIndex) continue
    for (const index of positionsOf(rung.kind, answerLength)) pinned.add(index)
  }
  return pinned
}

/**
 * WHICH KIND EACH LADDER STEP MAY USE, weakest form first.
 *
 * ONE TARGET PER STEP, SPELLED AS TWO KINDS. Step 1 aims at the first letter, step 2 at both ends,
 * step 3 at the first three -- and each of the last two is written twice: once for a FRESH entry,
 * where the whole target is new, and once for an entry the ladder has already pinned position 0 on,
 * where only the remainder is. `bookends` minus a pinned 0 is `final`; `prefix3` minus a pinned 0 is
 * `inner2`. The chooser takes the first form whose positions are entirely unpinned, so the two
 * spellings of one step can never both fire and the residual is decided by set membership rather
 * than by taste.
 *
 * THIS IS WHY THE STACKED LADDER STOPPED SAYING ONE THING THREE TIMES. Once three of four entries are
 * solved -- the routine endgame -- all three rungs land on the survivor, and under the old two-kind
 * table they read "starts with S", then "starts with S and ends with A", then "starts with SPA":
 * rung 2 restating rung 1 and rung 3 restating both, three hints to deliver two letters. The board
 * invariant below already stopped the giveaway; it did nothing about the COPY, because a rung whose
 * sentence is fixed by its kind cannot subtract what an earlier rung said unless the KINDS are
 * positionally disjoint in the first place. They are now, and the same endgame reads "starts with S",
 * "ends with A", "the 2nd and 3rd letters are P and A".
 *
 * FRESH ENTRIES KEEP THE OLD PAIR, which is why the table is not simply five singleton steps.
 * `bookends` and `prefix3` are the better rungs on an entry with nothing pinned: two facts in one
 * sentence beats one, and the ladder normally spreads across three of the four rows, where every
 * entry it touches IS fresh.
 */
const STEP_KINDS: ThemedAnagramsSpentRung['kind'][][] = [['initial'], ['bookends', 'final'], ['prefix3', 'inner2']]

/**
 * The rung this step would aim at one entry, or null when the entry has no room for it.
 *
 * TWO REFUSALS, AND THEY ARE DIFFERENT REFUSALS. The first is about the SENTENCE: a kind whose
 * positions overlap what this entry already has pinned would restate a letter the player was already
 * given, so it is skipped in favor of the step's residual form. The second is about the BOARD: a rung
 * that would leave fewer than MIN_FREE_POSITIONS of the answer unpinned spells it out in the
 * scramble display, so it is not emitted at all and the ladder shortens.
 *
 * Indexes `entries` without a guard, and that is safe rather than optimistic: every index this is
 * asked about came out of `ranked`, whose indices come from `entries.map`. A guard here would be a
 * branch no input can take.
 */
const rungFor = (
  entries: AnagramHintEntry[],
  spent: ThemedAnagramsSpentRung[],
  entryIndex: number,
  step: number,
): ThemedAnagramsSpentRung | null => {
  const length = entries[entryIndex].answer.length
  const pinned = pinnedIndices(spent, entryIndex, length)

  const kind = STEP_KINDS[step].find((candidate) => {
    const positions = positionsOf(candidate, length)
    // An empty set is a rung that says nothing -- `inner2` on a one-letter answer -- and it would
    // otherwise pass the disjointness test vacuously.
    return positions.size > 0 && [...positions].every((index) => !pinned.has(index))
  })
  if (kind === undefined) return null

  const free = length - new Set([...pinned, ...positionsOf(kind, length)]).size
  return free >= MIN_FREE_POSITIONS ? { entryIndex, kind } : null
}

/**
 * The next rung, or null when the ladder is spent, every entry is solved, or no entry has room left
 * for this step.
 *
 * WHICH STEP RUNS IS POSITIONAL: the first letter, then both ends, then a three-letter prefix. It
 * escalates in how much of one word it gives rather than in how many words it touches. WHICH KIND
 * that step spells out is decided per ENTRY, against what is already pinned there -- see STEP_KINDS.
 *
 * EACH RUNG PREFERS AN ENTRY THE LADDER HAS NOT USED, so three rungs normally light up three of the
 * four rows. When only one entry is left unsolved -- routine, once two of the four are in -- they
 * stack on it, and stacking is where both of this ladder's historical defects lived. The BOARD one is
 * fixed by the invariant in `rungFor`: the union of pinned indices used to reach {0, 1, 2, last}, so
 * on a five-letter answer -- MIN_WORD_LENGTH in generators/themedanagrams/words.ts -- exactly one
 * position stayed free and `pinnedDisplay` spelled the entry out. The COPY one is fixed by the kinds
 * being positionally disjoint, which is the whole of STEP_KINDS' comment.
 *
 * THE FIX IS AN INVARIANT, NOT AN ARITHMETIC CLAIM. The design document argued prefix3 could never
 * hand over a whole entry because three letters is at most three fifths of the shortest answer --
 * true of prefix3 ALONE, and irrelevant, because the rungs compose. So: a rung must leave at least
 * MIN_FREE_POSITIONS of its entry unpinned, counting every rung already aimed at it. A rung that
 * would not is not emitted and the ladder shortens, which is this repo's stated rule -- a rung you
 * do not have beats a bad one.
 *
 * RUNG 3 STILL PREFERS RUNG 1'S ENTRY over rung 2's, and the old reason for it was wrong: a prefix
 * adds positions 1 and 2 on EITHER entry, never "one the bookends rung already implied". The real
 * reason is the union. On rung 1's entry the union comes to {0, 1, 2}; on rung 2's it comes to
 * {0, 1, 2, last}. One more position stays free, which is exactly what decides whether the rung
 * clears the invariant above and can be emitted at all.
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
  const unused = available.filter((index) => !used.includes(index))
  // Rung 3 falls back to rung 1's entry before the rest of the ranking; rungs 1 and 2 have no such
  // second preference, and on rung 1 `unused` is the whole ranking anyway.
  const preferred = spent.length === 2 && available.includes(used[0]) ? [used[0]] : []

  return (
    [...new Set([...unused, ...preferred, ...available])]
      .map((entryIndex) => rungFor(entries, spent, entryIndex, spent.length))
      .find((rung): rung is ThemedAnagramsSpentRung => rung !== null) ?? null
  )
}

/**
 * The sentence for a frozen rung. Pure in `entries`, so a spent rung reads the same forever.
 *
 * THE KIND FULLY DETERMINES THE SENTENCE, and that is a hard requirement rather than a tidiness. A
 * bought rung replays from its stored record for the life of the board, long after the state that
 * chose it has moved, so a sentence that consulted the rungs beside it would say one thing at
 * purchase and another on the next load. Subtracting what an earlier rung already said therefore has
 * to happen in the CHOOSER, by giving it kinds that name disjoint positions -- which is what
 * STEP_KINDS does and why this function needs no knowledge of the ladder it sits in.
 */
export const themedAnagramsHintFor = (entries: AnagramHintEntry[], rung: ThemedAnagramsSpentRung): { text: string } => {
  const answer = entries[rung.entryIndex]?.answer ?? ''
  const ordinal = ORDINALS[rung.entryIndex] ?? `${rung.entryIndex + 1}th`
  const first = answer[0] ?? '?'
  const last = answer[answer.length - 1] ?? '?'

  if (rung.kind === 'initial') return { text: `The ${ordinal} answer starts with ${first}.` }
  if (rung.kind === 'final') return { text: `The ${ordinal} answer ends with ${last}.` }
  if (rung.kind === 'bookends') return { text: `The ${ordinal} answer starts with ${first} and ends with ${last}.` }
  // The two positions `prefix3` covers beyond `initial`, named by their ordinals rather than quoted
  // as a run: "starts with PA" would be false, and there is no shorter true way to say which two
  // letters these are.
  if (rung.kind === 'inner2') {
    return { text: `The ${ordinal} answer's 2nd and 3rd letters are ${answer[1] ?? '?'} and ${answer[2] ?? '?'}.` }
  }
  return { text: `The ${ordinal} answer starts with ${answer.slice(0, PREFIX_LENGTH)}.` }
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
