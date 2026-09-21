import { randomBytes } from 'node:crypto'

import { AnagramSet, fetchAnagramSets } from '../../services/anagram-sets'
import { AnagramEntry, Candidate, Difficulty, ModelGenerator, PackDate, Puzzle, ThemedAnagramsData } from '../../types'
import { recentAnagramWords, recentThemes } from '../../utils/exclusions'
import { log } from '../../utils/logging'
import { themedAnagramsContribution } from './contribution'
import { sortedLetters } from './letters'
import { SCRAMBLES_PER_ENTRY, drawScrambles } from './scramble'
import { WORDS_PER_PUZZLE } from './words'

const PUZZLE_TYPE = 'themedanagrams'

const defaultShortId = (): string => randomBytes(4).toString('hex')

/**
 * An assertion rather than a gate: a scramble whose letters do not match its answer means the redraw
 * loop is broken, and the failure it catches is an unsolvable board on a device that adjudicates
 * offline. It costs one puzzle rather than three because addModelPuzzles catches around build().
 */
const assertRoundTrip = (entry: AnagramEntry): void => {
  // Every member, not entry.scrambles[0]: each one is a board the player can reach by reshuffling.
  for (const scramble of entry.scrambles) {
    if (scramble.length !== entry.answer.length || sortedLetters(scramble) !== sortedLetters(entry.answer)) {
      throw new Error(`Scramble is not a permutation of ${entry.answer}`)
    }
  }
}

/**
 * The four entries this set can carry at this difficulty, or `undefined` when it cannot carry four.
 * A difficulty a set cannot fill is simply absent from that candidate's `usableAt` -- a logged
 * shortfall, never a throw, since one fetchCandidates call covers every difficulty of this type.
 */
const entriesAt = (
  set: AnagramSet,
  difficulty: Difficulty,
  random: () => number,
): [AnagramEntry, AnagramEntry, AnagramEntry, AnagramEntry] | undefined => {
  const entries: AnagramEntry[] = []
  for (const answer of set.words) {
    const [first, ...rest] = drawScrambles(answer, difficulty, random)
    // An empty draw is the word saying it cannot be shown at this band. A short list is not this
    // case and is never dropped.
    if (first === undefined) {
      continue
    }
    entries.push({ answer, scrambles: [first, ...rest] })
    if (entries.length === WORDS_PER_PUZZLE) {
      return [entries[0], entries[1], entries[2], entries[3]]
    }
  }
  return undefined
}

/**
 * A candidate plus the one reading fetchCandidates cannot recover from it. `scrambleCounts` is not
 * on `Candidate` because widening the shared type so one generator can log a histogram puts a
 * themedanagrams detail in front of six others.
 */
interface PooledSet {
  candidate: Candidate<ThemedAnagramsData>
  // One number per shipped entry, across every band this set can fill: how many arrangements it got.
  scrambleCounts: number[]
}

// No backfill across sets: a word from another theme is off-theme by definition. One set produces at
// most one puzzle, which the selection loop enforces by marking a candidate spent.
const toCandidate = (set: AnagramSet, difficulties: Difficulty[], random: () => number): PooledSet | undefined => {
  const byDifficulty = new Map<Difficulty, [AnagramEntry, AnagramEntry, AnagramEntry, AnagramEntry]>()
  for (const difficulty of difficulties) {
    const entries = entriesAt(set, difficulty, random)
    if (entries === undefined) {
      continue
    }
    byDifficulty.set(difficulty, entries)
  }
  if (byDifficulty.size === 0) {
    return undefined
  }

  const candidate: Candidate<ThemedAnagramsData> = {
    build: async (
      date: PackDate,
      difficulty: Difficulty,
      createShortId: () => string = defaultShortId,
    ): Promise<Puzzle<ThemedAnagramsData>> => {
      // Non-null because the selection loop only ever asks for a difficulty this candidate listed.
      const entries = byDifficulty.get(difficulty)!
      entries.forEach(assertRoundTrip)

      log('Generated themed anagrams puzzle', { date, difficulty, theme: set.theme })

      return {
        data: {
          entries,
          // No `hints`: which entries are still unsolved is a fact about a board four guesses have
          // changed, and this runs before any of them exist, so the rungs are built on the device
          // from `entries`, in lull-ui at src/components/themedanagrams/rungs.ts. DEPLOY lull-ui
          // FIRST AND THIS API SECOND, or new packs reach a client that calls hintsOf, gets null and
          // hides the hint bar. Full ordering in ./contribution.ts.
          theme: set.theme,
        },
        difficulty,
        estimatedSeconds:
          themedAnagramsContribution.baseSeconds + themedAnagramsContribution.secondsPerDifficulty * (difficulty - 1),
        id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
        type: PUZZLE_TYPE,
      }
    },
    usableAt: [...byDifficulty.keys()],
  }

  return {
    candidate,
    scrambleCounts: [...byDifficulty.values()].flatMap((entries) => entries.map((entry) => entry.scrambles.length)),
  }
}

/**
 * One Bedrock call, gated per set and per word, then scrambled per difficulty in code. `recent` is
 * the recent packs, not a pre-flattened exclusion list: this type has two repeat units, theme and
 * words, and flattening them makes them indistinguishable to the dedupe.
 */
const fetchCandidates = async (
  count: number,
  recent: { puzzles: Puzzle[] }[],
  origin: PackDate,
  random: () => number = Math.random,
): Promise<Candidate<ThemedAnagramsData>[]> => {
  const themes = recentThemes(recent, origin)
  const words = recentAnagramWords(recent, origin)
  const batch = await fetchAnagramSets(count, themes, words, random)

  const difficulties = themedAnagramsContribution.difficulties
  const pooled = batch.sets
    .map((set) => toCandidate(set, difficulties, random))
    .filter((entry): entry is PooledSet => entry !== undefined)
  const candidates = pooled.map((entry) => entry.candidate)

  // A bare count reads identically for a thin batch and one whose every word failed uniqueness, and
  // those want opposite fixes -- hence a key per gate and a reason per rejection.
  const usableByDifficulty = Object.fromEntries(
    difficulties.map((difficulty) => [
      difficulty,
      candidates.filter((candidate) => candidate.usableAt.includes(difficulty)).length,
    ]),
  )
  // A distribution rather than a mean: 3.5 reads identically for a pack where every entry got 3 or 4
  // and one where a quarter got 1, and only the second says maxSharedPositions is too tight. Buckets
  // are seeded at zero, because an omitted bucket reads as "no entry got 1" and as "nobody looked"
  // alike. Shipped entries only -- a word that drew nothing is not an entry.
  const scramblesPerEntry: Record<number, number> = Object.fromEntries(
    Array.from({ length: SCRAMBLES_PER_ENTRY }, (_, index) => [index + 1, 0]),
  )
  for (const count of pooled.flatMap((entry) => entry.scrambleCounts)) {
    scramblesPerEntry[count] += 1
  }

  log('Anagram set pool spent', {
    droppedByGate: batch.droppedByGate,
    // The seeding rule's only instrument: a batch that quietly stopped using seeds looks healthy in
    // every other number here. `named` short of setsUsable is the field being skipped, `fromPool`
    // short of `named` is an invented seed, `distinct` short of `named` is two themes off one seed.
    seedUse: batch.seedUse,
    // Outside droppedByGate because it is not a word-level gate: it counts (set, difficulty) slots
    // that could not be filled with four scrambles. An empty acceptable set at the hardest band is
    // normal, so this is a reading rather than an alarm.
    scrambleExhausted:
      batch.sets.length * difficulties.length -
      candidates.reduce((total, candidate) => total + candidate.usableAt.length, 0),
    scramblesPerEntry,
    setsDiscarded: batch.setsReturned - batch.sets.length,
    setsDiscardedByReason: batch.setsDiscardedByReason,
    setsReturned: batch.setsReturned,
    setsUsable: candidates.length,
    usableByDifficulty,
  })

  return candidates
}

export const themedAnagramsGenerator: ModelGenerator<ThemedAnagramsData> = {
  ...themedAnagramsContribution,
  fetchCandidates,
}
