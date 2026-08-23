import { phraseHistoryDays } from '../config'
import { phraseGenerators } from '../generators'
import { getRecentPacks } from '../services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '../services/packs'
import { generatePhrases } from '../services/phrases'
import { reviewPhrases } from '../services/review'
import { PackDate, ScheduledEvent } from '../types'
import { PHRASE_CORPUS_TYPES, recentAnswersOfTypes } from '../utils/exclusions'
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
// first three. So: 4 * 3 = 12 today, and 6 * 3 = 18 once a third consumer of the shared pool lands
// -- still under the 21 this asked for before the pack-wide count table rebalanced the two existing
// types. The extra tokens are trivial next to a second invocation.
const REQUEST_MULTIPLIER = 3
const MINIMUM_REQUEST = 10

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
    const excluded = recentAnswersOfTypes(recent, PHRASE_CORPUS_TYPES)

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
    // PER TYPE, beside the pack-level line and not instead of it. With two builders and several
    // types, "pack incomplete" no longer says which one failed -- and a bestEffort type is filtered
    // out of isComplete's list (services/packs.ts:92), so the pack-level line is not merely vague
    // about it but silent by construction.
    //
    // The count lives HERE rather than in generateFromPhrases because that function walks several
    // types inside one call: it already logs the per-band starvation it sees, but nothing there
    // counts a TYPE against its countPerDay. The model handler's equivalent arm holds one generator
    // at a time and can count off the returned pack directly.
    for (const generator of phraseGenerators) {
      const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
      if (produced < generator.countPerDay) {
        logError('Phrase type is still short after its call', { date, type: generator.type })
      }
    }
  } catch (error: unknown) {
    // Swallowed rather than rethrown. The self-contained puzzles are already written, so a failed
    // model call leaves a short pack rather than no pack -- and the 05:33 retry and the next
    // request both try again.
    logError('Could not add phrase puzzles', { date, error })
  }
}
