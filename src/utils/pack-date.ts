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

// The `count` calendar dates ending the day BEFORE `date`, newest first.
//
// Used to read recent packs for the "already used" phrase list. Computed rather than queried
// because Date is the packs table's partition key, so known dates are a bounded BatchGetItem
// instead of a Scan whose cost grows with the archive.
export const recentPackDates = (date: PackDate, count: number): PackDate[] => {
  const start = new Date(`${date}T00:00:00.000Z`)
  return Array.from({ length: Math.max(count, 0) }, (_, index) =>
    toPackDate(new Date(start.getTime() - (index + 1) * 24 * 60 * 60 * 1000)),
  )
}
