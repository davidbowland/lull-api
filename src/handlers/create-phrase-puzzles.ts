import { phraseHistoryDays } from '../config'
import { phraseGenerators } from '../generators'
import { getRecentPacks } from '../services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '../services/packs'
import { generatePhrases } from '../services/phrases'
import { reviewPhrases } from '../services/review'
import { PackDate, ScheduledEvent } from '../types'
import { PHRASE_CORPUS_TYPES, recentAnswersOfTypes } from '../utils/exclusions'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, packDateWindow } from '../utils/pack-date'

interface CreatePhrasePuzzlesEvent {
  date?: string
}

// Ask for more than a full pack needs. The blocklist, the charset rule and the word-count bounds
// all reject after the fact, a phrase that cannot be respaced costs another, and Cryptogram adds a
// fourth and much stricter filter -- a twelve-letter floor, a six-distinct-letter floor, a
// twenty-distinct-letter ceiling and a +/-1 difficulty band. This comment already warned that
// asking for exactly `phrasesNeeded()` "reliably comes up short" when the only rejections were the
// first three. Phrazle adds a fifth and different one -- a structural floor of 2-3 words of 3-7
// letters, and a dictionary clause that rejects any phrase containing a word ENABLE lacks, which
// cuts titles harder than the shape tags suggest. So: 6 * 3 = 18 with three consumers of the shared
// pool, up from 4 * 3 = 12 with two, and still under the 21 this asked for before the pack-wide
// count table rebalanced. The extra tokens are trivial next to a second invocation.
//
// phrasesNeeded() DOES NOT READ availableFrom -- it sums countPerDay across the whole array -- so
// between a type registering and its availableFrom date the model is asked for 18 phrases to feed
// four puzzles' worth of consumers. Accepted rather than fixed here: the waste is a few hundred
// tokens a night for a handful of nights, the alternative is a date-aware phrasesNeeded that two
// call sites would have to pass a date into, and asking for too many phrases is the recoverable
// direction. It is stated because the 12 -> 18 change lands BEFORE Phrazle produces anything, which
// otherwise reads as a bug in the test that pins it.
const REQUEST_MULTIPLIER = 3
const MINIMUM_REQUEST = 10

/**
 * The first of exactly two functions in this stack that call a model, and it makes TWO calls:
 * generatePhrases and then reviewPhrases. create-model-puzzles.ts is the other, and it now makes
 * three -- one per model type plus reviewClues. Both hold a Bedrock grant; CreatePackFunction and
 * GetPackByDateFunction deliberately hold none.
 *
 * NEITHER REVIEWER CAN SEE THE OTHER'S OUTPUT, which is the fact that reads as a duplication and is
 * not. services/lambda.ts invokes the two builders CONCURRENTLY and forbids anything depending on an
 * order between them, so reviewPhrases runs over phrases this invocation generated seconds earlier
 * while cryptic clues are being written in a different one. A single reviewer over both was never
 * available.
 *
 * It said "the ONLY function in this stack that calls a model" until 2026-08-24, which had been false
 * since Cryptic Clue shipped and is the sentence that makes "there is already a review call over all
 * our model output" the natural and wrong assumption.
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
    // packDateWindow, NOT recentPackDates, and the difference is a shipped duplicate. That one looks
    // only BACKWARD from `date`, which is right for the nightly run and wrong for every backfill: a
    // pack generated for a past date cannot see the packs that already shipped AFTER it. 2026-08-24
    // was generated on 2026-08-30 and repeated a phrase from 2026-08-29 for exactly this reason.
    // The window also includes `date` itself, so a top-up run cannot re-issue an answer its own pack
    // already carries.
    const recent = await getRecentPacks(packDateWindow(date, phraseHistoryDays))
    // Type-narrowed, re-gated and bounded. The blind cast that used to live here asserted
    // PhrasePuzzleData of every puzzle of every type -- a shape most do not have -- and was safe
    // only while `answer` was the
    // single field read AND every type carrying one drew from the shared phrase corpus. The second
    // half of that stops holding the day a type with an ordinary-English-word answer ships.
    //
    // Shown to the model rather than enforced afterwards, for the reason connections-api gives:
    // rejecting a repeat the model was never told about kills a generation with no way for it to
    // have done better. This is the backstop random seeding cannot provide -- different seeds make
    // two packs unlikely to collide; this makes a collision the model can see and avoid.
    const excluded = recentAnswersOfTypes(recent, PHRASE_CORPUS_TYPES, date)

    const count = Math.max(phrasesNeeded() * REQUEST_MULTIPLIER, MINIMUM_REQUEST)
    const phrases = await generatePhrases(count, excluded)
    // A second model call from the one function in the stack that already has Bedrock. It catches
    // its own errors and returns its input unchanged, so a failed review ships the batch unreviewed
    // rather than costing the pack.
    const reviewed = await reviewPhrases(phrases)

    const pack = await addPhrasePuzzles(date, reviewed)
    log('Phrase puzzles added', { complete: pack.complete, date, puzzles: pack.puzzles.length })

    /*
     * NO ALARM ON `complete`, and its removal is a correctness fix rather than a quieting.
     *
     * `complete` is computed over the WHOLE registry -- packs.ts isComplete walks allContributions
     * -- so an ERROR here is THIS builder alarming about the OTHER builder's types. services/lambda.ts
     * invokes the two concurrently and states in capitals that "ORDER IS NOT A PROPERTY of this
     * function and nothing may start depending on one", so on every night the model builder finishes
     * second this raised an alarm about a pack that was about to be filled. An alarm that fires on
     * healthy nights is how the one alarm this stack has gets muted, and a muted alarm is worse than
     * none because it still looks like coverage.
     *
     * The reading is not lost, only the page: `Phrase puzzles added` above carries `complete` and the
     * count, and every type this handler actually owns is named below.
     */

    /*
     * PER TYPE, and SHORT is not EMPTY.
     *
     * A type that wanted two and got one is a thin night: the pack reads incomplete, the next GET
     * re-triggers the builder through hasWorkRemaining, and it often fills. That is a `log` with both
     * counts on it, because a week of those lines is a trend and a trend is how a supply problem is
     * caught before it reaches zero.
     *
     * A type that produced NOTHING is a pipeline that returned nothing, which is the shape every
     * incident in this handler's history actually had -- and no retry has been observed to fix one on
     * its own. That is the page, and it is the only thing here that is.
     *
     * bestEffort is checked even though no phrase type declares it today. It is one condition, the
     * flag's whole documented job is to suppress the ALARM and never the attempt (packs.ts), and the
     * day a phrase type declares it this loop would otherwise page nightly for a type that is short
     * by design.
     *
     * The count lives HERE rather than in generateFromPhrases because that function walks several
     * types inside one call: it already logs the per-band starvation it sees, but nothing there
     * counts a TYPE against its countPerDay.
     */
    for (const generator of phraseGenerators) {
      const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
      if (produced >= generator.countPerDay) {
        continue
      }
      if (produced === 0 && generator.bestEffort !== true) {
        logError('Phrase type produced nothing', { date, type: generator.type, wanted: generator.countPerDay })
      } else {
        log('Phrase type is short after its call', {
          date,
          produced,
          type: generator.type,
          wanted: generator.countPerDay,
        })
      }
    }
  } catch (error: unknown) {
    // Swallowed rather than rethrown. The self-contained puzzles are already written, so a failed
    // model call leaves a short pack rather than no pack -- and the next request for this date
    // tries again.
    logError('Could not add phrase puzzles', { date, error })
  }
}
