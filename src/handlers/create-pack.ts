import { invokeSlowGenerators } from '../services/lambda'
import { createPack, hasWorkRemaining } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, nextPackDate } from '../utils/pack-date'

interface CreatePackEvent {
  date?: string
}

// One date per invocation, always. Repair does not need a cron -- a GET for an incomplete date
// rebuilds the fast half in-request and hands the slow half off under claimPackGeneration --
// while a second scheduled run re-pays full Bedrock cost to fail the same way twice a night. A
// manual top-up is `{"date": "YYYY-MM-DD"}`.
const targetDate = (event: CreatePackEvent): PackDate | undefined => {
  // The nightly run always targets tomorrow; it fires at 03:33 UTC and the date it builds first
  // begins at 10:00 UTC that same day for UTC+14.
  if (event.date === undefined) {
    return nextPackDate()
  }

  // Format only, not isValidPackDate: a manual target is legitimately in the past, so the range
  // check would reject it. An unvalidated event field reaching a DynamoDB key is still an unbounded
  // key, so the shape is checked either way.
  return isPackDateFormat(event.date) ? event.date : undefined
}

export const createPackHandler = async (event: ScheduledEvent | CreatePackEvent): Promise<void> => {
  log('Received event', { event })

  const packEvent = event as CreatePackEvent
  const date = targetDate(packEvent)
  if (date === undefined) {
    logError('Invalid pack date, refusing to generate', { date: packEvent.date })
    return
  }

  try {
    // No pre-read of the stored `complete` flag: it is frozen at write time against THAT deploy's
    // registry, so the day a new type ships an already-written pack still claims to be complete
    // and a top-up would skip it. createPack recomputes what is missing from the live registry.
    const pack = await createPack(date)
    log('Pack created', { complete: pack.complete, date, puzzles: pack.puzzles.length })
    // hasWorkRemaining, never `pack.complete`. The flag is the client's refetch signal and skips a
    // best-effort contribution by design, so gating the hand-off on it means a pack short of only a
    // best-effort type never reaches a builder at all -- zero puzzles of that type, on every date.
    if (hasWorkRemaining(date, pack.puzzles)) {
      // The same hand-off the request path makes, through one function so the two callers cannot
      // drift. No ERROR here: an incomplete pack at this point is the expected intermediate state,
      // and each builder raises its own ERROR if its type is still short when it finishes.
      log('Pack needs the slow generators, handing off', { date, puzzles: pack.puzzles.length })
      await invokeSlowGenerators(date)
    }
  } catch (error: unknown) {
    // Caught rather than thrown. A throw is a Lambda function error on a scheduled invocation, and
    // template.yaml sets MaximumRetryAttempts to 0, so it buys nothing and costs the ERROR line the
    // log subscription filters on.
    logError('Pack creation failed', { date, error })
  }
}
