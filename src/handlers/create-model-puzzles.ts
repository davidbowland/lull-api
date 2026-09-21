import { phraseHistoryDays } from '../config'
import { modelGenerators } from '../generators/model'
import { getPackByDate, getRecentPacks } from '../services/dynamodb'
import { addModelPuzzles, createPack, missingDifficulties } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError, logWarning } from '../utils/logging'
import { isTransientModelFailure } from '../utils/model-errors'
import { isPackDateFormat, packDateWindow } from '../utils/pack-date'

interface CreateModelPuzzlesEvent {
  date?: string
}

// When the last WRITE may START, against the 900-second Lambda timeout: 900 minus ~10s of reserve
// for the write in flight (the two writes here cost ~4s together), for the whole loop. Raising
// the reserve is destructive, not safe -- the fetches run concurrently, so every reading this
// guard takes happens after every model call has been paid for, and firing discards finished
// candidates. Any increase needs a MEASURED write cost behind it.
//
// It bounds writes, never fetches: bedrock.ts's maxAttempts of 4 re-runs a generation rather than
// resuming it, so one retried 32000-token call is ~820s of fetch on its own, past this bound
// before a write is reached. Exported so __tests__/unit/generators/index.test.ts can assert it
// against template.yaml's createModelPuzzlesTimeout of 900; at 98.9% of the ceiling a timeout
// drop makes it unreachable.
export const GENERATOR_BUDGET_MS = 890_000

/**
 * The second of exactly two functions in this stack that call a model.
 *
 * One fetchCandidates call per type per pack, and one write per generator: buildPack is
 * read-merge-conditional-write, so a shared write would be one condition a racing GET can
 * invalidate, discarding every type's model output. Kept out of create-phrase-puzzles.ts, which
 * already makes two serial Opus calls inside the same 900-second ceiling.
 *
 * Accepted residual: a fetchCandidates that HANGS, as distinct from throwing, is unbounded, and
 * allSettled waits on it, so a hang costs every type's candidates and ends the night. Only a
 * client-side timeout could bound it.
 */
export const createModelPuzzles = async (date: PackDate, now: () => number = Date.now): Promise<void> => {
  const start = now()

  // Repairs the non-inRequest self-contained lane, which nothing else reaches: fillPack filters
  // on inRequest and createPack otherwise runs only from the nightly. Idempotent; before the
  // loop, so a budget-exhausted night still repairs the cheap lane; caught, so a broken cheap
  // lane cannot cost the model lane its night.
  try {
    await createPack(date)
  } catch (error: unknown) {
    logError('Could not repair the self-contained lane', { date, error })
  }

  try {
    // Read AFTER the repair, so what the repair wrote counts.
    const existing = (await getPackByDate(date))?.puzzles ?? []
    // packDateWindow, not recentPackDates: that one looks only BACKWARD, so a backfill cannot see
    // the packs that already shipped after its target date.
    const recent = await getRecentPacks(packDateWindow(date, phraseHistoryDays))

    // Fetch concurrently, write one at a time. The generators are independent, so fetch wall
    // clock is max() rather than sum() and a slow type cannot starve a sibling. Throughput is not
    // the constraint: the Bedrock quota (AWS Service Quotas, 2026-09-07, Claude Opus 5: 20M input
    // and 2M output tokens/minute) is far above the 5 concurrent calls this stack peaks at, and
    // throttling is invisible here because a 429 is transient and never reaches the ERROR alarm.
    //
    // Each arm catches its own failure, and allSettled rather than all makes that structural:
    // `all` abandons the rest on the first rejection, so the guarantee would hold only while
    // every line inside the arm's catch was throw-free, which a logger meeting a circular AWS SDK
    // error is not. The `try` encloses the WHOLE mapped body, missingDifficulties included.
    const settledArms = await Promise.allSettled(
      modelGenerators.map(async (generator) => {
        try {
          // Before the model call, inside the mapped function so no arrangement of the fetches
          // can move it after one. With two builders behind one flag, an incomplete pack no longer
          // means this type is missing, so fetching first burns Opus tokens to add nothing.
          const missing = missingDifficulties(generator, existing, date)
          if (missing.length === 0) {
            log('Nothing missing for this type, skipping the model call', { date, type: generator.type })
            return undefined
          }

          return { candidates: await generator.fetchCandidates(missing.length, recent, date), generator, missing }
        } catch (error: unknown) {
          // Deliberately the same message the write arm below uses, so splitting one arm in two
          // does not split the log query that reads it. Level by cause: a 503 leaves the type
          // short and the next GET re-reads what is missing, so there is nothing for a person to
          // do, while anything else is a defect and pages.
          const write = isTransientModelFailure(error) ? logWarning : logError
          write('Could not add puzzles for this type', { date, error, type: generator.type })
          return undefined
        }
      }),
    )

    // `String(reason)` and not the error object: whatever reached here got past a catch whose own
    // logger call is the leading suspect, and Error.prototype.toString walks no properties.
    const fetched = settledArms.map((arm, index) => {
      if (arm.status === 'fulfilled') {
        return arm.value
      }

      logError('A generator arm failed outside its own catch', {
        date,
        reason: String(arm.reason),
        type: modelGenerators[index].type,
      })

      return undefined
    })

    // Serial, and the concurrency above must not reach here: addModelPuzzles is
    // read-merge-conditional-write, so two concurrent writes race one condition and the loser's
    // puzzles are discarded quietly. Writing is the cheap half.
    for (const [index, settled] of fetched.entries()) {
      // Nothing missing, or a fetch that failed and already logged why. Before the clock reading,
      // so a full pack never raises the budget ERROR below over types that had no work.
      if (settled === undefined) {
        continue
      }

      // After the skip above, because this line is the only alarm in the stack. An uncaught
      // 900-second timeout is a function error and NOTHING RUNS AGAIN -- template.yaml sets
      // MaximumRetryAttempts to 0 and the invoke is 'Event' -- so returning under budget with a
      // short pack beats being killed: it leaves a record the next GET can repair from. `skipped`
      // is read off `fetched` so it names only the types that had a write to lose.
      if (now() - start >= GENERATOR_BUDGET_MS) {
        logError('Model budget spent, skipping the remaining types', {
          date,
          skipped: fetched
            .slice(index)
            .flatMap((remaining) => (remaining === undefined ? [] : [remaining.generator.type])),
        })
        break
      }

      const { candidates, generator, missing } = settled

      // Swallowed per type and never rethrown: a Lambda retry would re-run every type including
      // the ones that succeeded. The right-grained retry is the next GET for this date.
      try {
        // `missing` is passed through rather than re-derived -- see addModelPuzzles.
        const { outcome, pack } = await addModelPuzzles(date, generator, missing, candidates)
        // Short and empty are different pages. A type one short leaves the pack incomplete and
        // the next GET often fills it, so paging for that is how the level="ERROR" subscription
        // becomes a filter people mute; a required type at ZERO is the page, and a best-effort
        // type is counted and never alarmed. Same rule as create-phrase-puzzles.ts.
        const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
        if (produced < generator.countPerDay) {
          if (produced === 0 && generator.bestEffort !== true) {
            // Which zero it was, because three failures reach this line and packs.ts logs two of
            // them below ERROR. `candidates` at zero is a supply failure; `outcome` separates
            // 'nothing-generated' from 'lost-race', which is not a failure at all. The per-type
            // pool counters stay out -- they are one type's shape.
            logError('Model type produced nothing', {
              candidates: candidates.length,
              date,
              outcome,
              type: generator.type,
              wanted: generator.countPerDay,
            })
          } else {
            log('Model type is short after its call', {
              date,
              produced,
              type: generator.type,
              wanted: generator.countPerDay,
            })
          }
        }
      } catch (error: unknown) {
        // Level by cause, same selector and same message as the fetch arm. isTransientModelFailure
        // stays rather than collapsing to logError because candidate.build runs inside
        // addModelPuzzles, so a type whose build calls a model can raise a 503 on this side.
        const write = isTransientModelFailure(error) ? logWarning : logError
        write('Could not add puzzles for this type', { date, error, type: generator.type })
      }
    }
  } catch (error: unknown) {
    // The reads above, which are outside the per-type arms. Swallowed for the same reason.
    logError('Could not add model puzzles', { date, error })
  }
}

/**
 * The Lambda entry point and nothing else: validate the event, then delegate.
 *
 * An exported Lambda handler takes the event and only the event: the runtime calls it as
 * `handler(event, context, callback)`, so an injectable clock in any positional slot is bound to
 * the context object in production and the first `now()` throws. Anything needing one is a
 * function below the handler, which is what tests drive.
 */
export const createModelPuzzlesHandler = async (event: ScheduledEvent | CreateModelPuzzlesEvent): Promise<void> => {
  log('Received event', { event })

  const puzzleEvent = event as CreateModelPuzzlesEvent
  // An unvalidated event field reaching a DynamoDB key is an unbounded key. Format only, not
  // isValidPackDate: a manual replay legitimately targets a date in the past.
  if (puzzleEvent.date === undefined || !isPackDateFormat(puzzleEvent.date)) {
    logError('Invalid date, refusing to generate', { date: puzzleEvent.date })
    return
  }

  await createModelPuzzles(puzzleEvent.date)
}
