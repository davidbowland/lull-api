import { getPackByDate } from '../services/dynamodb'
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
const targetDate = (event: CreatePackEvent): PackDate | undefined => {
  if (event.date === undefined) {
    return event.retryToday ? todayPackDate() : nextPackDate()
  }

  // Format only, not isValidPackDate: the retry target is legitimately in the past, so the range
  // check would reject it. An unvalidated event field reaching a DynamoDB key is still an
  // unbounded key, so the shape is checked either way.
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
    // Inside the try on purpose: a read failure out here would escape as an unhandled Lambda
    // error, bypassing the logError discipline the comment below depends on.
    const existing = await getPackByDate(date)
    if (existing?.complete) {
      log('Pack is already complete, skipping generation', { date })
      return
    }

    const pack = await createPack(date)
    log('Pack created', { complete: pack.complete, date, puzzles: pack.puzzles.length })
    if (!pack.complete) {
      // logError, not log: the CloudWatch subscription filters on level="ERROR", and this handler
      // otherwise returns normally, so a half-generated pack would raise no alarm at all.
      logError('Pack is incomplete', { date, puzzles: pack.puzzles.length })
    }
  } catch (error: unknown) {
    logError('Pack creation failed', { date, error })
  }
}
