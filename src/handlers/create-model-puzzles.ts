import { phraseHistoryDays } from '../config'
import { modelGenerators } from '../generators/model'
import { getPackByDate, getRecentPacks } from '../services/dynamodb'
import { addModelPuzzles, createPack, missingDifficulties } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, recentPackDates } from '../utils/pack-date'

// Declared HERE and not in src/types.ts, matching create-pack.ts's own CreatePackEvent. One field,
// the same isPackDateFormat validation, the same reason.
interface CreateModelPuzzlesEvent {
  date?: string
}

// Stop STARTING a generator past ten minutes, leaving 300s of the 900 for the slowest single call
// plus its write. The same distinction ON_DEMAND_BUDGET_MS draws: this bounds when the last call may
// START, not when the invocation ends, and it cannot interrupt a call already in flight.
//
// A budget for the WHOLE LOOP, not 600 seconds per type. It is checked once per iteration against a
// single `start`, two model types share it, and Phase 2's types arrive into the same handler and the
// same number.
const GENERATOR_BUDGET_MS = 600_000

/**
 * The second of exactly two functions in this stack that call a model.
 *
 * One fetchCandidates call per type per pack, never one per puzzle, and a WRITE PER GENERATOR --
 * buildPack is read-merge-conditional-write and its put is conditional on the puzzle count it read,
 * so one write after 800 seconds is a single condition a racing GET can invalidate, discarding every
 * type's model output. Three conditional writes a night on a PAY_PER_REQUEST table is nothing.
 *
 * NOT folded into create-phrase-puzzles.ts. That function already makes two serial Opus calls inside
 * the same 900-second ceiling, and a TIMEOUT is the one failure mode a per-call catch cannot contain:
 * the phrase handler catches everything the code can throw, and nothing catches the runtime killing
 * the invocation. Sharing one would put an experimental puzzle in front of the six phrases the pack
 * depends on.
 *
 * NO SCHEDULE OF ITS OWN, for the reason CreatePhrasePuzzlesFunction already carries: a separate
 * cron would fire before the pack it is filling exists. It is invoked only by whoever built the
 * self-contained half and found work outstanding.
 *
 * THE ACCEPTED RESIDUAL, stated rather than discovered later: one handler for several types means a
 * fetchCandidates that HANGS -- as distinct from throwing -- can still eat the budget of everything
 * after it, and the per-generator catch does not help against a hang. The budget guard turns that
 * into a short pack rather than a killed invocation, which is the outcome that matters.
 */
export const createModelPuzzlesHandler = async (
  event: ScheduledEvent | CreateModelPuzzlesEvent,
  now: () => number = Date.now,
): Promise<void> => {
  log('Received event', { event })

  const puzzleEvent = event as CreateModelPuzzlesEvent
  // An unvalidated event field reaching a DynamoDB key is an unbounded key. Format only, not
  // isValidPackDate: a manual replay legitimately targets a date in the past.
  if (puzzleEvent.date === undefined || !isPackDateFormat(puzzleEvent.date)) {
    logError('Invalid date, refusing to generate', { date: puzzleEvent.date })
    return
  }
  const date: PackDate = puzzleEvent.date

  const start = now()

  // The non-inRequest self-contained lane, which nothing else repairs. fillPack filters on
  // inRequest; createPack runs every self-contained generator but is invoked only by the 03:33
  // nightly, the 05:33 retry and a manual invoke; and the async builders never touched
  // selfContainedGenerators at all. So a pack more than a day past the nightly window that is short
  // of an inRequest: false self-contained type was short PERMANENTLY -- nothing ran the generator
  // again, isComplete recomputed false on every response, and the client refetched forever.
  //
  // Phase 1 ships no such generator, which is stated rather than dressed up: the reason the hole is
  // empty right now is that the one self-contained generator happens to be graded true, nothing
  // asserts that as an invariant, and no test could. It is one line, it is idempotent, and on the
  // nightly path create-pack.ts has just run createPack itself, so this is the no-op it is designed
  // to be.
  //
  // It goes BEFORE the loop so a budget-exhausted night still repairs the cheap lane, and it is
  // caught for the same reason every arm below is: createPack walks generators that can throw, and a
  // broken cheap lane must not cost the model lane its night. Its own per-type failures are already
  // logged inside generateSelfContained; this catches only what escapes that.
  //
  // It is in THIS builder and not in both. Two builders each calling createPack is two racers added
  // to a conditional write that already has several, for one repair -- and the fan-out invokes both,
  // so the model handler running it covers every hand-off the request path makes.
  try {
    await createPack(date)
  } catch (error: unknown) {
    logError('Could not repair the self-contained lane', { date, error })
  }

  try {
    // Read AFTER the repair, so what the repair wrote counts. One strongly-consistent read of one
    // item, which dynamodb.ts already argues is worth paying for a smaller reason.
    const existing = (await getPackByDate(date))?.puzzles ?? []
    const recent = await getRecentPacks(recentPackDates(date, phraseHistoryDays))

    for (const generator of modelGenerators) {
      // BEFORE the model call. With two builders behind one flag, "the pack is incomplete" no longer
      // means "your type is missing", so an invocation that fetches first burns Opus tokens to add
      // nothing. bestEffort makes this load-bearing rather than merely thrifty: a best-effort type is
      // skipped by isComplete, so its absence never re-triggers the builder, and the only thing
      // deciding whether it runs tonight is missingDifficulties reading the pack it already has.
      const missing = missingDifficulties(generator, existing, date)
      if (missing.length === 0) {
        log('Nothing missing for this type, skipping the model call', { date, type: generator.type })
        continue
      }

      // AFTER the skip above, and the order is the difference between an alarm and a page nobody
      // owes an answer to. The level="ERROR" subscription filter is the only alarm in this stack, so
      // this line wakes somebody up; ahead of the skip it fired on a slow night over types whose
      // work was already done, which is an alarm about a pack that was full. Reading the clock only
      // for a type that has work also stops a full pack consuming budget readings it never spent.
      //
      // An uncaught 900-second timeout is a FUNCTION ERROR, and an async invocation retries -- so
      // returning under budget with a short pack is strictly better than being killed. ERROR rather
      // than log, because a night that ran out of budget is a night somebody should see.
      //
      // `>=`, not `>`. This bounds when the last call may START, leaving 300s of the 900 for it plus
      // its write; a call starting exactly AT the bound has none of that reserve.
      if (now() - start >= GENERATOR_BUDGET_MS) {
        logError('Model budget spent, skipping the remaining types', {
          date,
          skipped: modelGenerators.slice(modelGenerators.indexOf(generator)).map((skipped) => skipped.type),
        })
        break
      }

      // Swallowed PER TYPE and never rethrown out of the handler, for the same reason
      // create-phrase-puzzles.ts swallows: a Lambda retry re-runs every type including the ones that
      // succeeded. The 05:33 retryToday run is the retry, at the right granularity, because it
      // re-reads what is missing.
      try {
        const candidates = await generator.fetchCandidates(missing.length, recent)
        // `missing` is passed through rather than re-derived -- see addModelPuzzles.
        const pack = await addModelPuzzles(date, generator, missing, candidates)
        const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
        if (produced < generator.countPerDay) {
          // With several types in one invocation, "pack is still incomplete" no longer says which one
          // failed, and the level="ERROR" subscription is the only thing that alarms. A BEST-EFFORT
          // type logs this line too: being short by design is still worth counting, and it is the
          // input to the kill criteria that type's spec declares.
          logError('Model type is still short after its call', { date, type: generator.type })
        }
      } catch (error: unknown) {
        logError('Could not add puzzles for this type', { date, error, type: generator.type })
      }
    }
  } catch (error: unknown) {
    // The reads above, which are outside the per-type arms. Swallowed for the same reason.
    logError('Could not add model puzzles', { date, error })
  }
}
