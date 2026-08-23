import { invokeSlowGenerators } from '../services/lambda'
import { createPack, hasWorkRemaining } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, nextPackDate, todayPackDate } from '../utils/pack-date'

interface CreatePackEvent {
  date?: string
  retryToday?: boolean
}

// The nightly run always targets tomorrow. Without the separate retry rule an incomplete pack would
// stay incomplete all day, and clients following the spec's "refetch while incomplete" guidance
// would re-request forever.
// Both dates on a retry, not just today. Tomorrow's pack is the nightly's own target and so the
// one most likely to be short, and nothing else revisits it before it becomes today -- by which
// point the retry for that day has already run.
const targetDates = (event: CreatePackEvent): PackDate[] | undefined => {
  if (event.date === undefined) {
    return event.retryToday ? [todayPackDate(), nextPackDate()] : [nextPackDate()]
  }

  // Format only, not isValidPackDate: a manual retry target is legitimately in the past, so the
  // range check would reject it. An unvalidated event field reaching a DynamoDB key is still an
  // unbounded key, so the shape is checked either way.
  return isPackDateFormat(event.date) ? [event.date] : undefined
}

export const createPackHandler = async (event: ScheduledEvent | CreatePackEvent): Promise<void> => {
  log('Received event', { event })

  const packEvent = event as CreatePackEvent
  const dates = targetDates(packEvent)
  if (dates === undefined) {
    logError('Invalid pack date, refusing to generate', { date: packEvent.date })
    return
  }

  for (const date of dates) {
    try {
      // No pre-read for a `complete` flag. That flag is frozen at write time by isComplete(), which
      // reads THAT deploy's generator registry -- so the day a second type ships, an
      // already-written pack still claims to be complete and the retry would skip it, silently
      // shipping a short day. createPack recomputes what is missing from the live registry and
      // no-ops when there is genuinely nothing to do, which is the check that stays true.
      const pack = await createPack(date)
      log('Pack created', { complete: pack.complete, date, puzzles: pack.puzzles.length })
      // hasWorkRemaining, NEVER `pack.complete`. The flag is the client's refetch signal and skips a
      // best-effort contribution by design, so gating the hand-off on it means a pack short of only
      // a best-effort type never reaches a builder at all -- zero puzzles of that type, on every
      // date, with this retry unable to repair the very thing it exists for.
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
      // Per date, so one bad day does not cost the other.
      logError('Pack creation failed', { date, error })
    }
  }
}
