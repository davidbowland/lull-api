import { phraseHistoryDays } from '../config'
import { phraseGenerators } from '../generators'
import { getRecentPacks } from '../services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '../services/packs'
import { generatePhrases } from '../services/phrases'
import { reviewPhrases } from '../services/review'
import { PackDate, ScheduledEvent } from '../types'
import { PHRASE_CORPUS_TYPES, recentAnswersOfTypes } from '../utils/exclusions'
import { log, logError, logWarning } from '../utils/logging'
import { isPackDateFormat, packDateWindow } from '../utils/pack-date'

interface CreatePhrasePuzzlesEvent {
  date?: string
}

// Ask for more than a full pack needs, because three phrase types filter the shared pool hard
// after the fact. Measured over 52 shipped packs, Cryptogram's linkage floor and Phrazle's tile
// bounds cost 18% and 12% of their own pools, almost all of it outside the bands each type
// declares, so 3x carries ample slack; the extra tokens are trivial next to a second invocation.
//
// phrasesNeeded() does not read availableFrom, so a registered type asks for phrases before its
// availableFrom date. Accepted -- over-asking is the recoverable direction.
const REQUEST_MULTIPLIER = 3
const MINIMUM_REQUEST = 10

/**
 * The first of exactly two functions in this stack that call a model, and it makes two calls:
 * generatePhrases and then reviewPhrases. Both builders hold a Bedrock grant; CreatePackFunction
 * and GetPackByDateFunction deliberately hold none.
 *
 * Phrases are generated, turned into the puzzles that need them, and discarded -- generating per
 * pack from a fresh seed is what stops many dates repeating each other, so there is no shared
 * list to keep. Invoked fire-and-forget by the request path and by the nightly pack run, both of
 * which build the self-contained puzzles first and hand off whatever still needs a phrase.
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
    // packDateWindow, not recentPackDates: that one looks only BACKWARD from `date`, so a backfill
    // cannot see the packs that already shipped after it and repeats their phrases. The window
    // includes `date` itself, so a top-up run cannot re-issue an answer its own pack already holds.
    const recent = await getRecentPacks(packDateWindow(date, phraseHistoryDays))
    // Shown to the model rather than enforced afterwards: rejecting a repeat the model was never
    // told about kills a generation with no way for it to have done better. This is the backstop
    // random seeding cannot provide -- a collision the model can see and avoid.
    const excluded = recentAnswersOfTypes(recent, PHRASE_CORPUS_TYPES, date)

    const count = Math.max(phrasesNeeded() * REQUEST_MULTIPLIER, MINIMUM_REQUEST)
    const { phrases, upstreamUnavailable } = await generatePhrases(count, excluded)
    // A second model call from the one function in the stack that already has Bedrock. It catches
    // its own errors and returns its input unchanged, so a failed review ships the batch unreviewed
    // rather than costing the pack.
    const reviewed = await reviewPhrases(phrases)

    const pack = await addPhrasePuzzles(date, reviewed)
    log('Phrase puzzles added', { complete: pack.complete, date, puzzles: pack.puzzles.length })

    /*
     * No alarm on `complete`: it is computed over the WHOLE registry, so an ERROR here would be
     * this builder alarming about the other builder's types, which run concurrently with no
     * ordering. `Phrase puzzles added` above still carries the reading.
     *
     * Per type below, and short is not empty: a type one short is a thin night the next GET often
     * fills, so it is a `log`, while a type that produced NOTHING is the page. The count lives
     * here rather than in generateFromPhrases, which walks several types inside one call and
     * never counts a TYPE against its countPerDay.
     */
    for (const generator of phraseGenerators) {
      const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
      if (produced >= generator.countPerDay) {
        continue
      }
      if (produced === 0 && generator.bestEffort !== true) {
        // One page per outage, not one per type: every phrase type draws from one shared pool, so
        // a Bedrock outage empties all three at once and requestPhraseBatch already logged the
        // cause. The FLAG and never `phrases.length === 0` -- an empty pool whose calls came back
        // is a prompt that is not being followed, which is the page this line exists for.
        const write = upstreamUnavailable ? logWarning : logError
        write('Phrase type produced nothing', {
          date,
          type: generator.type,
          upstreamUnavailable,
          wanted: generator.countPerDay,
        })
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
