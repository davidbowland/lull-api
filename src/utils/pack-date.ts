import { packStartDate } from '../config'
import { PackDate } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const PACK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const toPackDate = (date: Date): PackDate => date.toISOString().split('T')[0]

export const todayPackDate = (now = Date.now): PackDate => toPackDate(new Date(now()))

// Tomorrow. The nightly schedule generates for the following UTC day, so this is also the upper
// bound of every date the API will ever serve.
export const nextPackDate = (now = Date.now): PackDate => toPackDate(new Date(now() + MS_PER_DAY))

export const isValidPackDate = (value: string, now = Date.now): boolean => {
  if (!PACK_DATE_PATTERN.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return false
  }

  // The format check alone accepts impossible dates: '2026-02-30' is not NaN, it rolls forward to
  // March 2nd. Only the round trip catches that.
  if (toPackDate(parsed) !== value) {
    return false
  }

  // Both bounds are YYYY-MM-DD, so a lexical comparison is a chronological one.
  return value >= packStartDate && value <= nextPackDate(now)
}
