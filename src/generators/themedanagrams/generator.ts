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
 * THE ONE THROW IN THIS TYPE, and it is an ASSERTION rather than a gate.
 *
 * A gate implies a recoverable rejection. A scramble whose letters do not match its answer means the
 * redraw loop is broken, not that the model's input was bad, and a gate would quietly drop the
 * evidence. The failure it catches is an UNSOLVABLE BOARD shipped to a device that adjudicates
 * offline, irrecoverable without a delete-and-rebuild runbook.
 *
 * The objection that it cannot fail -- code did the scrambling, from the answer's own letters --
 * stops being true the moment the scrambler gains a bug. One sort, four times per puzzle. It costs
 * ONE puzzle rather than three because addModelPuzzles catches around each build() call.
 */
const assertRoundTrip = (entry: AnagramEntry): void => {
  // EVERY MEMBER, not entry.scrambles[0]. Each one is a board the player can reach by pressing
  // reshuffle, so an assertion that guards only the arrangement they see first guards the one case
  // the feature exists to move away from.
  for (const scramble of entry.scrambles) {
    if (scramble.length !== entry.answer.length || sortedLetters(scramble) !== sortedLetters(entry.answer)) {
      throw new Error(`Scramble is not a permutation of ${entry.answer}`)
    }
  }
}

/**
 * The four entries this set can carry at this difficulty, or `undefined` when it cannot carry four.
 *
 * Words are scrambled in RETURNED ORDER until four succeed. A difficulty a set cannot fill is simply
 * absent from that candidate's `usableAt` -- a logged shortfall, never a throw. Under one
 * fetchCandidates call for the whole type a throw here would cost every difficulty rather than one.
 */
const entriesAt = (
  set: AnagramSet,
  difficulty: Difficulty,
  random: () => number,
): [AnagramEntry, AnagramEntry, AnagramEntry, AnagramEntry] | undefined => {
  const entries: AnagramEntry[] = []
  for (const answer of set.words) {
    const [first, ...rest] = drawScrambles(answer, difficulty, random)
    // An empty draw is the word saying it cannot be shown at this band -- an empty acceptable set, or
    // one every member of which is charged. Both arrive here as a missing `first` and both are
    // counted by scrambleExhausted below. A SHORT list is not this case and is never dropped.
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
 * A candidate together with the one reading fetchCandidates cannot recover from it.
 *
 * `scrambleCounts` is here rather than on `Candidate` because `Candidate` is the SHARED type every
 * generator returns, and it deliberately carries no shape information -- the same reason
 * packs-size.test.ts has to name each type's worst case by hand. Widening it so one type can log a
 * histogram would put a themedanagrams detail in front of six other generators. This wrapper is
 * local, dies at the end of fetchCandidates, and never reaches the selection loop.
 */
interface PooledSet {
  candidate: Candidate<ThemedAnagramsData>
  // One number per SHIPPED entry, across every band this set can fill: how many arrangements it got.
  scrambleCounts: number[]
}

// NO BACKFILL ACROSS SETS: a word from another theme is off-theme by definition, and mixing
// provenance is a content judgment code cannot make. ONE SET PRODUCES AT MOST ONE PUZZLE, which the
// selection loop enforces by marking a candidate spent -- so a pack can never show the same theme
// twice or the same word under two themes.
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
          // NO `hints`. The ladder that stood here ranked the four entries by ANSWER LENGTH, once,
          // at this moment -- so a player who had already solved the longest entry still had the
          // whole-answer reveal spent on it. Which entries are still unsolved is a fact about a
          // board four guesses have changed, and this function runs before any of them exist.
          //
          // The rungs are chosen on the device, by a builder that still takes only the entries. The
          // "a composer that cannot reach the theme cannot leak it" argument that lived here is that
          // builder's signature now, and it is stated there -- in lull-ui, at
          // src/components/themedanagrams/rungs.ts. This repo neither holds that file nor runs it;
          // it did both for a while, under src/rules/, and gave the arrangement up because nothing
          // in src/ imported it.
          //
          // DEPLOY lull-ui FIRST AND THIS API SECOND. Removing `hints` from a type that has been
          // live since PACK_START_DATE is endpoints.rest's clause (b), whose step 0 is shipping the
          // client's reader first; a new pack with no ladder reaching today's lull-ui gets
          // `hintsOf` returning null and no hint bar at all. The client can go first because its
          // adapter computes the ladder from `entries`, which already ships. The full argument,
          // including why the stale-pack direction needs no ordering, is in ./contribution.ts beside
          // the mirror-image rule it follows from.
          //
          // STEP 0 ALONE, AND STEP 1 MUST NOT BE RUN. Clause (b) lists seven steps and the rest of
          // them delete the pack archive and rebuild it. None applies here: a stored pack that still
          // carries `hints` is ignored rather than misread, so there is nothing to rebuild and
          // therefore nothing to delete first. endpoints.rest names the steps one at a time for this
          // change; read that list before running anything out of it.
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
 * One Bedrock call, gated per set and per word, then scrambled per difficulty in code.
 *
 * `recent` is THE RECENT PACKS, not a pre-flattened exclusion list: this type has TWO repeat units --
 * the theme and the words -- and flattening them into one list makes them indistinguishable to the
 * dedupe that consumes them. Each is read here by its own narrowed reader.
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

  // Modeled on usableByDifficulty, and it is the point rather than decoration. Every word-level gate
  // has a key and every set-level rejection has a reason, because a bare count reads identically for
  // a thin batch and for a batch every word of which failed uniqueness -- and those want opposite
  // fixes.
  const usableByDifficulty = Object.fromEntries(
    difficulties.map((difficulty) => [
      difficulty,
      candidates.filter((candidate) => candidate.usableAt.includes(difficulty)).length,
    ]),
  )
  // HOW MANY ARRANGEMENTS EACH SHIPPED ENTRY GOT, bucketed, and the reading that says whether the
  // reshuffle control is worth having. A DISTRIBUTION rather than a mean, for the same reason
  // usableByDifficulty is a breakdown rather than a count: a mean of 3.5 reads identically for a pack
  // where every entry got 3 or 4 and one where a quarter got 1 and the rest got 4, and those want
  // opposite fixes -- the second is maxSharedPositions set too tight, the first is nothing at all.
  //
  // SEEDED WITH EVERY BUCKET AT ZERO, because a histogram that omits its empty buckets reads as "no
  // entry got 1" and as "nobody looked" in exactly the same way. The day the 1 bucket starts filling
  // is the day this has to be legible without anyone re-deriving what a missing key meant.
  //
  // It counts SHIPPED entries only -- a word that drew nothing is not a bucket-0 entry, it is not an
  // entry, and scrambleExhausted below is where that shows up.
  const scramblesPerEntry: Record<number, number> = Object.fromEntries(
    Array.from({ length: SCRAMBLES_PER_ENTRY }, (_, index) => [index + 1, 0]),
  )
  for (const count of pooled.flatMap((entry) => entry.scrambleCounts)) {
    scramblesPerEntry[count] += 1
  }

  log('Anagram set pool spent', {
    droppedByGate: batch.droppedByGate,
    // The seeding rule's own instrument, and the only one there is. Seeds are what keep two nights
    // apart -- the model maps them to themes very nearly one-for-one -- so a batch that quietly
    // stopped using them looks exactly like a healthy batch in every other number on this line.
    // `named` short of setsUsable is the field being skipped, `fromPool` short of `named` is a seed
    // invented rather than drawn, and `distinct` short of `named` is two themes off one seed.
    seedUse: batch.seedUse,
    // Beside droppedByGate rather than inside it, because it is not a WORD-level gate: it counts
    // (set, difficulty) SLOTS that could not be filled with four scrambles. A word with an empty
    // acceptable set at the hardest band is a normal event -- ROBOT is one -- so this number is a
    // reading rather than an alarm, and it is what would rise first if the severity table moved.
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
