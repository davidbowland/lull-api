import { randomBytes } from 'node:crypto'

import { AnagramSet, fetchAnagramSets } from '../../services/anagram-sets'
import { AnagramEntry, Candidate, Difficulty, ModelGenerator, PackDate, Puzzle, ThemedAnagramsData } from '../../types'
import { recentAnagramWords, recentThemes } from '../../utils/exclusions'
import { log } from '../../utils/logging'
import { themedAnagramsContribution } from './contribution'
import { buildHints } from './hints'
import { sortedLetters } from './letters'
import { scrambleWord } from './scramble'
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
  if (entry.scramble.length !== entry.answer.length || sortedLetters(entry.scramble) !== sortedLetters(entry.answer)) {
    throw new Error(`Scramble is not a permutation of ${entry.answer}`)
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
    const scramble = scrambleWord(answer, difficulty, random)
    if (scramble === undefined) {
      continue
    }
    entries.push({ answer, scramble })
    if (entries.length === WORDS_PER_PUZZLE) {
      return [entries[0], entries[1], entries[2], entries[3]]
    }
  }
  return undefined
}

// NO BACKFILL ACROSS SETS: a word from another theme is off-theme by definition, and mixing
// provenance is a content judgement code cannot make. ONE SET PRODUCES AT MOST ONE PUZZLE, which the
// selection loop enforces by marking a candidate spent -- so a pack can never show the same theme
// twice or the same word under two themes.
const toCandidate = (
  set: AnagramSet,
  difficulties: Difficulty[],
  random: () => number,
): Candidate<ThemedAnagramsData> | undefined => {
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

  return {
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
          // The theme is NOT handed to buildHints, and that is the enforcement rather than a
          // convention: a composer that cannot reach a string cannot leak it.
          hints: buildHints(entries),
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
  random: () => number = Math.random,
): Promise<Candidate<ThemedAnagramsData>[]> => {
  const themes = recentThemes(recent)
  const words = recentAnagramWords(recent)
  const batch = await fetchAnagramSets(count, themes, words, random)

  const difficulties = themedAnagramsContribution.difficulties
  const candidates = batch.sets
    .map((set) => toCandidate(set, difficulties, random))
    .filter((candidate): candidate is Candidate<ThemedAnagramsData> => candidate !== undefined)

  // Modelled on usableByDifficulty, and it is the point rather than decoration. Every word-level gate
  // has a key and every set-level rejection has a reason, because a bare count reads identically for
  // a thin batch and for a batch every word of which failed uniqueness -- and those want opposite
  // fixes.
  const usableByDifficulty = Object.fromEntries(
    difficulties.map((difficulty) => [
      difficulty,
      candidates.filter((candidate) => candidate.usableAt.includes(difficulty)).length,
    ]),
  )
  log('Anagram set pool spent', {
    droppedByGate: batch.droppedByGate,
    // Beside droppedByGate rather than inside it, because it is not a WORD-level gate: it counts
    // (set, difficulty) SLOTS that could not be filled with four scrambles. A word with an empty
    // acceptable set at the hardest band is a normal event -- ROBOT is one -- so this number is a
    // reading rather than an alarm, and it is what would rise first if the severity table moved.
    scrambleExhausted:
      batch.sets.length * difficulties.length -
      candidates.reduce((total, candidate) => total + candidate.usableAt.length, 0),
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
