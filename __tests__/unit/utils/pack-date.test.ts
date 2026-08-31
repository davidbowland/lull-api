import {
  isPackDateFormat,
  isValidPackDate,
  nextPackDate,
  packDateDistance,
  packDateWindow,
  recentPackDates,
  todayPackDate,
  toPackDate,
} from '@utils/pack-date'

describe('pack-date', () => {
  // Noon UTC so a shifted local zone would visibly move the answer if anything used local time
  const now = () => Date.UTC(2026, 5, 15, 12, 0, 0)

  describe('toPackDate', () => {
    it('returns the UTC calendar date', () => {
      expect(toPackDate(new Date('2026-06-15T12:00:00.000Z'))).toBe('2026-06-15')
    })

    it('keeps the UTC date at the last millisecond of the day', () => {
      expect(toPackDate(new Date('2026-06-15T23:59:59.999Z'))).toBe('2026-06-15')
    })

    it('keeps the UTC date at the first millisecond of the day', () => {
      expect(toPackDate(new Date('2026-06-15T00:00:00.000Z'))).toBe('2026-06-15')
    })
  })

  describe('todayPackDate', () => {
    it('returns the current UTC calendar date', () => {
      expect(todayPackDate(now)).toBe('2026-06-15')
    })

    it('defaults to Date.now', () => {
      expect(todayPackDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('nextPackDate', () => {
    it('returns tomorrow in UTC', () => {
      expect(nextPackDate(now)).toBe('2026-06-16')
    })

    it('rolls over the end of a year', () => {
      expect(nextPackDate(() => Date.UTC(2026, 11, 31, 23, 59, 59))).toBe('2027-01-01')
    })

    it('rolls over the end of a month', () => {
      expect(nextPackDate(() => Date.UTC(2026, 0, 31, 0, 0, 0))).toBe('2026-02-01')
    })

    it('defaults to Date.now', () => {
      expect(nextPackDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('isPackDateFormat', () => {
    it.each(['2026-01-01', '2026-06-15', '2028-12-31'])('accepts %s', (value) => {
      expect(isPackDateFormat(value)).toBe(true)
    })

    it('accepts a date outside the servable range, which the retry path needs', () => {
      expect(isPackDateFormat('1999-01-01')).toBe(true)
      expect(isValidPackDate('1999-01-01', now)).toBe(false)
    })

    it.each([
      ['a non-date string', 'fnord'],
      ['an unparseable month', '2026-13-01'],
      ['a day that rolls into the next month', '2026-02-30'],
      ['a date with no zero padding', '2026-6-15'],
    ])('rejects %s', (_description, value) => {
      expect(isPackDateFormat(value)).toBe(false)
    })
  })

  describe('isValidPackDate', () => {
    // PACK_START_DATE is 2026-01-01 in jest.setup-test-env.js
    it.each(['2026-01-01', '2026-03-09', '2026-06-15', '2026-06-16'])('accepts %s', (value) => {
      expect(isValidPackDate(value, now)).toBe(true)
    })

    it.each([
      ['a date before the start date', '2025-12-31'],
      ['a date past tomorrow', '2026-06-17'],
      ['a non-date string', 'fnord'],
      ['a date with the wrong separator', '2026/06/15'],
      ['a date with no zero padding', '2026-6-15'],
      ['a timestamp', '2026-06-15T00:00:00.000Z'],
      ['an unparseable month', '2026-13-01'],
      ['a day that rolls into the next month', '2026-02-30'],
    ])('rejects %s', (_description, value) => {
      expect(isValidPackDate(value, now)).toBe(false)
    })

    it('defaults to Date.now', () => {
      expect(isValidPackDate('1999-01-01')).toBe(false)
    })
  })

  describe('recentPackDates', () => {
    // The days BEFORE the target, newest first. The target itself is the pack being filled, so its
    // own answers are not exclusions.
    it('returns the preceding dates newest first', () => {
      expect(recentPackDates('2026-06-15', 3)).toEqual(['2026-06-14', '2026-06-13', '2026-06-12'])
    })

    it('rolls back over the start of a month', () => {
      expect(recentPackDates('2026-03-01', 2)).toEqual(['2026-02-28', '2026-02-27'])
    })

    it('rolls back over the start of a year', () => {
      expect(recentPackDates('2027-01-01', 1)).toEqual(['2026-12-31'])
    })

    it.each([0, -1])('returns nothing for a window of %s', (count) => {
      expect(recentPackDates('2026-06-15', count)).toEqual([])
    })
  })

  describe('packDateWindow', () => {
    // NEAREST FIRST AND BOTH DIRECTIONS. This is the whole difference from recentPackDates, and the
    // reason it exists: a backfill targets a date in the past, so packs that already shipped AFTER
    // it are packs a player sees beside it. A backward-only window cannot see them, which is how
    // 2026-08-24 -- generated on 2026-08-30 -- repeated a phrase from 2026-08-29.
    it('returns the target, then each neighbour outward, nearest first', () => {
      expect(packDateWindow('2026-06-15', 2)).toEqual([
        '2026-06-15',
        '2026-06-14',
        '2026-06-16',
        '2026-06-13',
        '2026-06-17',
      ])
    })

    // The target is IN the window, which closes the top-up half of the same hole: a re-run over a
    // short pack fills only its missing difficulties and would otherwise be blind to the answers
    // that pack already carries.
    it('includes the target date itself', () => {
      expect(packDateWindow('2026-06-15', 3)).toContain('2026-06-15')
    })

    it('returns 2n + 1 dates', () => {
      expect(packDateWindow('2026-06-15', 20)).toHaveLength(41)
    })

    it('holds no duplicates', () => {
      const dates = packDateWindow('2026-06-15', 20)

      expect(new Set(dates).size).toEqual(dates.length)
    })

    it('rolls over the start of a month in both directions', () => {
      expect(packDateWindow('2026-03-01', 1)).toEqual(['2026-03-01', '2026-02-28', '2026-03-02'])
    })

    it('rolls over the start of a year in both directions', () => {
      expect(packDateWindow('2027-01-01', 1)).toEqual(['2027-01-01', '2026-12-31', '2027-01-02'])
    })

    it.each([0, -1])('returns the target alone for a window of %s', (count) => {
      expect(packDateWindow('2026-06-15', count)).toEqual(['2026-06-15'])
    })
  })

  describe('packDateDistance', () => {
    it('is zero for the same date', () => {
      expect(packDateDistance('2026-06-15', '2026-06-15')).toEqual(0)
    })

    // UNSIGNED, which is the whole point: over a two-directional window the pack one day before and
    // the pack one day after are equally likely to be seen beside the target, and a signed distance
    // would sort one of them to the far end of the list.
    it.each([
      ['2026-06-14', '2026-06-15', 1],
      ['2026-06-16', '2026-06-15', 1],
      ['2026-05-26', '2026-06-15', 20],
      ['2026-07-05', '2026-06-15', 20],
    ])('is %s to %s = %i days, unsigned', (left, right, expected) => {
      expect(packDateDistance(left, right)).toEqual(expected)
    })

    // A DST boundary in the developer's local zone must not produce 0.958 or 1.042 days. The dates
    // are parsed as UTC midnight, so the difference is always a whole number of days.
    it('counts whole days across a local DST boundary', () => {
      expect(packDateDistance('2026-03-08', '2026-03-09')).toEqual(1)
    })
  })
})
