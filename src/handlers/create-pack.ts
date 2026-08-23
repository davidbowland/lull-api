import { invokeSlowGenerators } from '../services/lambda'
import { createPack, hasWorkRemaining } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, nextPackDate } from '../utils/pack-date'

interface CreatePackEvent {
  date?: string
}

// ONE date per invocation, always. This took a `retryToday: true` that meant "today AND tomorrow",
// set by a second 05:33 schedule; both are gone. Repair does not need a cron -- a GET for an
// incomplete date rebuilds the fast half in-request and hands the slow half off under
// claimPackGeneration -- while a second scheduled run re-paid full Bedrock cost to fail the same
// deterministic way twice a night. A manual top-up is `{"date": "YYYY-MM-DD"}`, which names the day
// it means instead of inferring two.
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
    // No pre-read for a `complete` flag. That flag is frozen at write time by isComplete(), which
    // reads THAT deploy's generator registry -- so the day a second type ships, an already-written
    // pack still claims to be complete and a top-up run would skip it, silently shipping a short
    // day. createPack recomputes what is missing from the live registry and no-ops when there is
    // genuinely nothing to do, which is the check that stays true.
    const pack = await createPack(date)
    log('Pack created', { complete: pack.complete, date, puzzles: pack.puzzles.length })
    // hasWorkRemaining, NEVER `pack.complete`. The flag is the client's refetch signal and skips a
    // best-effort contribution by design, so gating the hand-off on it means a pack short of only a
    // best-effort type never reaches a builder at all -- zero puzzles of that type, on every date.
    if (hasWorkRemaining(date, pack.puzzles)) {
      // The same hand-off the request path makes, and for the same reason: what is missing needs a
      // model call, which belongs in its own async function. This run does the self-contained half
      // and asks for the rest. THROUGH ONE FUNCTION, so the two callers cannot drift -- there are
      // two async builders now, and a third is added in invokeSlowGenerators and nowhere else.
      //
      // No ERROR here. An incomplete pack at this point is the EXPECTED intermediate state, not a
      // fault -- the async builders have not run yet. Each logs its own ERROR if its type is still
      // short after it finishes, which is the moment that actually warrants an alarm.
      log('Pack needs the slow generators, handing off', { date, puzzles: pack.puzzles.length })
      await invokeSlowGenerators(date)
    }
  } catch (error: unknown) {
    // Caught and logged rather than thrown. A throw here is a Lambda function error on a scheduled
    // invocation, and template.yaml sets MaximumRetryAttempts to 0, so it buys nothing and costs the
    // ERROR line the log subscription filters on.
    logError('Pack creation failed', { date, error })
  }
}
