import { ensureCorpus } from '../services/corpus'
import { createPack } from '../services/packs'
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
      // Before the generators, because the corpus is their input. This is what lets a pack the
      // request path could not finish actually get finished: on a cold stack there is no corpus at
      // all, and the fast fill has no way to make one -- a Bedrock call cannot happen inside a
      // request. Here it can, under a 900-second timeout and off the response path.
      //
      // It is a no-op once any corpus is stored, so the nightly run pays for it exactly once.
      // Failure is logged and swallowed: goFigure needs no corpus, so a pack that is short is
      // better than a pack that is missing.
      try {
        await ensureCorpus(date)
      } catch (error: unknown) {
        logError('Could not ensure a corpus, generating what does not need one', { date, error })
      }
      // No pre-read for a `complete` flag. That flag is frozen at write time by isComplete(), which
      // reads THAT deploy's generator registry -- so the day a second type ships, an
      // already-written pack still claims to be complete and the retry would skip it, silently
      // shipping a short day. createPack recomputes what is missing from the live registry and
      // no-ops when there is genuinely nothing to do, which is the check that stays true.
      const pack = await createPack(date)
      log('Pack created', { complete: pack.complete, date, puzzles: pack.puzzles.length })
      if (!pack.complete) {
        // logError, not log: the CloudWatch subscription filters on level="ERROR", and this handler
        // otherwise returns normally, so a half-generated pack would raise no alarm at all.
        logError('Pack is incomplete', { date, puzzles: pack.puzzles.length })
      }
    } catch (error: unknown) {
      // Per date, so one bad day does not cost the other.
      logError('Pack creation failed', { date, error })
    }
  }
}
