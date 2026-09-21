import { packStartDate } from '../config'
import { PackDate } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const PACK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const toPackDate = (date: Date): PackDate => date.toISOString().split('T')[0]

export const todayPackDate = (now = Date.now): PackDate => toPackDate(new Date(now()))

// Tomorrow. The nightly schedule generates for the following UTC day, so this is also the upper
// bound of every date the API will ever serve.
export const nextPackDate = (now = Date.now): PackDate => toPackDate(new Date(now() + MS_PER_DAY))

// Shape and calendar validity, with no range check. The nightly retry path needs this on its own:
// its target is legitimately in the past, so isValidPackDate's range check would reject it, but an
// unvalidated event field reaching a DynamoDB key is still an unbounded key.
export const isPackDateFormat = (value: string): boolean => {
  if (!PACK_DATE_PATTERN.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return false
  }

  // The pattern alone accepts impossible dates: '2026-02-30' is not NaN, it rolls forward to March
  // 2nd. Only the round trip catches that.
  return toPackDate(parsed) === value
}

// Both bounds are YYYY-MM-DD, so a lexical comparison is a chronological one.
export const isValidPackDate = (value: string, now = Date.now): boolean =>
  isPackDateFormat(value) && value >= packStartDate && value <= nextPackDate(now)

// The `count` calendar dates ending the day before `date`, newest first. Computed rather than
// queried because Date is the packs table's partition key, so known dates are a bounded
// BatchGetItem instead of a Scan. Backward only: use packDateWindow for an exclusion list.
export const recentPackDates = (date: PackDate, count: number): PackDate[] => {
  const start = new Date(`${date}T00:00:00.000Z`)
  return Array.from({ length: Math.max(count, 0) }, (_, index) =>
    toPackDate(new Date(start.getTime() - (index + 1) * 24 * 60 * 60 * 1000)),
  )
}

/**
 * Every date within `count` days of `date`, including `date` itself, nearest first.
 *
 * Symmetric because a backfill targets a past date, and the packs that shipped after it are the
 * ones a player sees beside it. `date` itself is included because a short pack is topped up by a
 * later run over the same date, which must see the answers its own pack already carries. Nearest
 * first so a list truncated at its bound keeps the closest packs on both sides.
 *
 * 2 * count + 1 dates, 41 at the configured 20: one BatchGetItem, inside its 100-key and 16MB limits.
 */
export const packDateWindow = (date: PackDate, count: number): PackDate[] => {
  const origin = new Date(`${date}T00:00:00.000Z`).getTime()
  const bounded = Math.max(count, 0)
  const dates: PackDate[] = [date]
  for (let offset = 1; offset <= bounded; offset += 1) {
    dates.push(toPackDate(new Date(origin - offset * MS_PER_DAY)))
    dates.push(toPackDate(new Date(origin + offset * MS_PER_DAY)))
  }
  return dates
}

/**
 * Whole days between two pack dates, unsigned. The sort key for every exclusion list, because a
 * window reaching both ways has no newest-first order meaning "most likely seen beside this one".
 */
export const packDateDistance = (left: PackDate, right: PackDate): number =>
  Math.abs(new Date(`${left}T00:00:00.000Z`).getTime() - new Date(`${right}T00:00:00.000Z`).getTime()) / MS_PER_DAY
