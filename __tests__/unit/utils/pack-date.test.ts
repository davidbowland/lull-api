import { isValidPackDate, nextPackDate, todayPackDate, toPackDate } from '@utils/pack-date'

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
})
