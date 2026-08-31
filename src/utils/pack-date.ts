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
//
// BACKWARD ONLY, which is why packDateWindow below exists and why nothing should reach for this
// one to build an exclusion list. Kept because "the N days before D" is a genuine question with
// other askers; it is simply not the question an exclusion list asks.
export const recentPackDates = (date: PackDate, count: number): PackDate[] => {
  const start = new Date(`${date}T00:00:00.000Z`)
  return Array.from({ length: Math.max(count, 0) }, (_, index) =>
    toPackDate(new Date(start.getTime() - (index + 1) * 24 * 60 * 60 * 1000)),
  )
}

/**
 * Every date within `count` days of `date`, INCLUDING `date` itself, nearest first.
 *
 * SYMMETRIC, AND THE SYMMETRY IS THE WHOLE POINT. recentPackDates looks only backward, which is
 * correct for the nightly run -- it builds tomorrow, and nothing after tomorrow exists -- and wrong
 * for every other caller. A backfill targets a date in the PAST, so the packs that already shipped
 * after it are the ones a player will see beside it, and a backward-only window cannot see them.
 * That is not hypothetical: 2026-08-24 was generated on 2026-08-30 and repeated a phrase from
 * 2026-08-29, because 2026-08-29 is in that window's future and was never in the exclusion list.
 *
 * `date` ITSELF IS IN THE WINDOW, which closes the second half of the same hole. A pack that is
 * short is topped up by a later run over the SAME date, and generateFromPhrases fills only the
 * missing difficulties -- so without this the top-up is blind to the answers its own pack already
 * carries and can ship one twice on one day.
 *
 * NEAREST FIRST, so a list truncated at its bound keeps the packs a player is most likely to have
 * just played, on BOTH sides. Newest-first over a symmetric window would drop yesterday to keep a
 * pack twenty days in the future, which is the wrong end to lose.
 *
 * 2 * count + 1 dates, which at the configured 20 is 41 -- one BatchGetItem, under its 100-key and
 * 16MB limits at ~15KB a pack.
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
 * Whole days between two pack dates, unsigned.
 *
 * The sort key for every exclusion list: a window that reaches in both directions has no
 * newest-first order that means "most likely to be seen beside this one".
 */
export const packDateDistance = (left: PackDate, right: PackDate): number =>
  Math.abs(new Date(`${left}T00:00:00.000Z`).getTime() - new Date(`${right}T00:00:00.000Z`).getTime()) / MS_PER_DAY
