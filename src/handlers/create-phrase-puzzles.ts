import { phraseHistoryDays } from '../config'
import { getRecentPacks } from '../services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '../services/packs'
import { generatePhrases } from '../services/phrases'
import { reviewPhrases } from '../services/review'
import { PackDate, PhrasePuzzleData, Puzzle, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, recentPackDates } from '../utils/pack-date'

interface CreatePhrasePuzzlesEvent {
  date?: string
}

// Ask for more than a full pack needs. The blocklist, the charset rule and the word-count bounds
// all reject after the fact, a phrase that cannot be respaced costs another, and Cryptogram adds a
// fourth and much stricter filter -- a twelve-letter floor, a six-distinct-letter floor, a
// twenty-distinct-letter ceiling and a +/-1 difficulty band. This comment already warned that
// asking for exactly `phrasesNeeded()` "reliably comes up short" when the only rejections were the
// first three. So: 7 * 3 = 21. The extra tokens are trivial next to a second invocation.
const REQUEST_MULTIPLIER = 3
const MINIMUM_REQUEST = 10

// The answers recent packs already used, handed to the model as phrases not to repeat.
//
// Every puzzle, of every type, with no type literal anywhere: `answer` is on PhrasePuzzleData, so a
// new phrase type joins this list by existing. goFigure's data simply has no `answer` and drops out
// of the filter, as does a type this deploy has never heard of.
//
// This is the backstop the random seeding cannot provide. Different seeds make two packs unlikely
// to collide; this makes a collision the model can actually see and avoid. Shown rather than
// enforced afterwards, for the reason connections-api gives: rejecting a repeat the model was never
// told about kills a generation with no way for it to have done better.
// The cast is applied to EVERY puzzle's data, including types that are not phrase-derived, so it
// asserts a shape most of them do not have. Safe only because `answer` is the single field read and
// the filter below discards anything that is not a string.
//
// Worth knowing what now flows through it: goFigure's `hints` is three OBJECTS while
// PhrasePuzzleData's is three strings, so a goFigure puzzle typed as Partial<PhrasePuzzleData> is
// actively lying about that field. Nothing reads it here. Anything added to this function that
// touches a field other than `answer` must narrow on `puzzle.type` first.
const usedPhrases = (packs: { puzzles: Puzzle[] }[]): string[] =>
  packs.flatMap((pack) =>
    pack.puzzles
      .map((puzzle) => (puzzle.data as Partial<PhrasePuzzleData> | null)?.answer)
      .filter((answer): answer is string => typeof answer === 'string'),
  )

/**
 * The ONLY function in this stack that calls a model.
 *
 * It generates phrases, immediately turns them into the puzzles that need them, and discards them.
 * Nothing is stored between the call and the puzzles: an earlier design kept a nightly corpus in
 * its own table with a used-id set, a TTL lock and a fallback, all of which existed to stop many
 * dates repeating each other out of one shared list. Generating per pack from a fresh random seed
 * removes the shared list and therefore the problem.
 *
 * Invoked fire-and-forget by the request path and by the nightly pack run, both of which build the
 * self-contained puzzles first and hand off whatever still needs a phrase.
 */
export const createPhrasePuzzlesHandler = async (event: ScheduledEvent | CreatePhrasePuzzlesEvent): Promise<void> => {
  log('Received event', { event })

  const puzzleEvent = event as CreatePhrasePuzzlesEvent
  // An unvalidated event field reaching a DynamoDB key is an unbounded key. Format only, not
  // isValidPackDate: a manual replay legitimately targets a date in the past.
  if (puzzleEvent.date === undefined || !isPackDateFormat(puzzleEvent.date)) {
    logError('Invalid date, refusing to generate', { date: puzzleEvent.date })
    return
  }
  const date: PackDate = puzzleEvent.date

  try {
    const recent = await getRecentPacks(recentPackDates(date, phraseHistoryDays))
    const excluded = usedPhrases(recent)

    const count = Math.max(phrasesNeeded() * REQUEST_MULTIPLIER, MINIMUM_REQUEST)
    const phrases = await generatePhrases(count, excluded)
    // A second model call from the one function in the stack that already has Bedrock. It catches
    // its own errors and returns its input unchanged, so a failed review ships the batch unreviewed
    // rather than costing the pack.
    const reviewed = await reviewPhrases(phrases)

    const pack = await addPhrasePuzzles(date, reviewed)
    log('Phrase puzzles added', { complete: pack.complete, date, puzzles: pack.puzzles.length })
    if (!pack.complete) {
      // logError, not log: the CloudWatch subscription filters on level="ERROR", and this handler
      // otherwise returns normally, so a day left short would raise no alarm at all.
      logError('Pack is still incomplete after adding phrase puzzles', { date, puzzles: pack.puzzles.length })
    }
  } catch (error: unknown) {
    // Swallowed rather than rethrown. The self-contained puzzles are already written, so a failed
    // model call leaves a short pack rather than no pack -- and the 05:33 retry and the next
    // request both try again.
    logError('Could not add phrase puzzles', { date, error })
  }
}
