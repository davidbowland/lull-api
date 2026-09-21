import { createPack, hasWorkRemaining, missingDifficulties } from '@services/packs'
import { Difficulty, PackContribution, Puzzle } from '@types'
import { log } from '@utils/logging'

// One mock per contribution: every test turns on which type is MISSING, and a shared mock either
// produces everything or produces the wrong type for two of the three.
const mockShippedGenerate = jest.fn()
const mockNotYetShippedGenerate = jest.fn()
const mockProbationGenerate = jest.fn()

// Three contributions separating the two flags: `shipped` is ordinary, `notYetShipped` lands
// later, `probation` is bestEffort. The dates are literals; nothing derives "today" from a clock.
const shipped = {
  availableFrom: '2026-08-01',
  countPerDay: 1,
  difficulties: [1],
  generate: (...args: unknown[]) => mockShippedGenerate(...args),
  inRequest: true,
  type: 'gofigure',
}
const notYetShipped = {
  availableFrom: '2026-09-15',
  countPerDay: 1,
  difficulties: [2],
  generate: (...args: unknown[]) => mockNotYetShippedGenerate(...args),
  inRequest: true,
  type: 'cryptogram',
}
const probation = {
  availableFrom: '2026-08-01',
  bestEffort: true,
  countPerDay: 1,
  difficulties: [3],
  generate: (...args: unknown[]) => mockProbationGenerate(...args),
  inRequest: true,
  type: 'missingvowels',
}
// modelContributions is read by nothing here, but a mock that omits an export hands back
// `undefined` the day packs.ts imports it, and the factory is not type-checked.
jest.mock('@generators/index', () => ({
  allContributions: [shipped, notYetShipped, probation],
  modelContributions: [],
  phraseGenerators: [],
  selfContainedGenerators: [shipped, notYetShipped, probation],
}))

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const puzzleFor = (type: string, difficulty: number): Puzzle => ({
  data: {},
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 60,
  id: `${type}:short${difficulty}`,
  type: type as never,
})

describe('date-aware completeness', () => {
  const setup = (date: string, existing: Puzzle[] = []): void => {
    mockGetPackByDate.mockResolvedValue({ complete: false, date, puzzles: existing })
    mockSetPackByDate.mockResolvedValue(true)
    // Each generator emits ITS OWN type: one type for all three would satisfy every countPerDay
    // from a single call and no completeness assertion below could fail.
    mockShippedGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('gofigure', difficulty))
    mockNotYetShippedGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('cryptogram', difficulty))
    mockProbationGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('missingvowels', difficulty))
  }

  describe('missingDifficulties', () => {
    // The boundary, the day before and the day after -- literal dates, no arithmetic.
    it.each([
      ['the day before it applies', '2026-09-14', []],
      ['the day it applies', '2026-09-15', [2]],
      ['the day after it applies', '2026-09-16', [2]],
    ])('returns %s -> %p', (_description, date, expected) => {
      expect(missingDifficulties(notYetShipped as PackContribution, [], date)).toEqual(expected)
    })

    // bestEffort is filtered in isComplete and nowhere else, so a good night still fills the pack.
    it('still asks for a best-effort contribution', () => {
      expect(missingDifficulties(probation as PackContribution, [], '2026-08-20')).toEqual([3])
    })
  })

  describe('isComplete, through createPack', () => {
    it('ignores a contribution that had not shipped on that date', async () => {
      setup('2026-08-20')

      const pack = await createPack('2026-08-20')

      // Complete with no cryptogram: notYetShipped is out of range, so isComplete never asks.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure', 'missingvowels'])
      expect(pack.complete).toEqual(true)
      // The same filter reached the produce path -- the half a `complete` flag cannot see.
      expect(mockNotYetShippedGenerate).not.toHaveBeenCalled()
    })

    it('counts a contribution on the very day it ships', async () => {
      // The boundary itself, so appliesTo using `<` fails here. The type ships and immediately
      // fails to produce, which is the only way its absence can hold the flag down.
      setup('2026-09-15')
      mockNotYetShippedGenerate.mockRejectedValue(new Error('nothing to draw from yet'))

      const pack = await createPack('2026-09-15')

      expect(mockNotYetShippedGenerate).toHaveBeenCalledWith('2026-09-15', 2)
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure', 'missingvowels'])
      expect(pack.complete).toEqual(false)
    })

    it('ignores a best-effort contribution that produced nothing', async () => {
      // shipped is satisfied by the stored puzzle, so probation's failing call is the only one.
      setup('2026-08-20', [puzzleFor('gofigure', 1)])
      mockProbationGenerate.mockRejectedValue(new Error('the model was having a day'))

      const pack = await createPack('2026-08-20')

      expect(mockProbationGenerate).toHaveBeenCalledWith('2026-08-20', 3)
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })
  })

  // The builder trigger, a different question from the refetch signal. isComplete SKIPS a
  // best-effort contribution, so gating the async builder on `complete` means nothing ever builds
  // a pack short of only that type. Only hasWorkRemaining may gate a builder.
  describe('hasWorkRemaining', () => {
    it('sees a best-effort gap that the complete flag is allowed to ignore', async () => {
      setup('2026-08-20', [puzzleFor('gofigure', 1)])
      mockProbationGenerate.mockRejectedValue(new Error('the model was having a day'))

      const pack = await createPack('2026-08-20')

      // Both halves in one pair, because the point is the disagreement between them.
      expect(pack.complete).toEqual(true)
      expect(hasWorkRemaining('2026-08-20', pack.puzzles)).toEqual(true)
    })

    it('reports nothing left to attempt once every applicable contribution is satisfied', () => {
      const full = [puzzleFor('gofigure', 1), puzzleFor('missingvowels', 3)]

      expect(hasWorkRemaining('2026-08-20', full)).toEqual(false)
    })

    // Dated exactly like isComplete, or the day a type ships the whole archive becomes eligible
    // for the model builder at once.
    it.each([
      ['the day before it applies', '2026-09-14', false],
      ['the day it applies', '2026-09-15', true],
    ])('with only the unshipped type missing, %s -> %p', (_description, date, expected) => {
      const present = [puzzleFor('gofigure', 1), puzzleFor('missingvowels', 3)]

      expect(hasWorkRemaining(date, present)).toEqual(expected)
    })

    // The empty-filter direction, its own case because `some` and `every` disagree.
    it('reports nothing left to attempt on a date no contribution applies to', () => {
      expect(hasWorkRemaining('2026-07-31', [])).toEqual(false)
    })
  })

  // Both failure modes are silent by construction -- a future-dated contribution never runs, and
  // a best-effort shortfall raises no alarm -- so each gets a line, pinned to message AND payload.
  describe('what a pack build says about itself', () => {
    it('names the types that had not shipped on that date', async () => {
      setup('2026-08-20')

      await createPack('2026-08-20')

      expect(log).toHaveBeenCalledWith('Contributions not yet available for this date', {
        date: '2026-08-20',
        types: ['cryptogram'],
      })
    })

    // Outcome, never permission: a line naming which types are ALLOWED to be short reads the same
    // on a perfect night as on the only night worth logging.
    it('names the best-effort type that came up short, with what it owed', async () => {
      setup('2026-08-20', [puzzleFor('gofigure', 1)])
      mockProbationGenerate.mockRejectedValue(new Error('the model was having a day'))

      await createPack('2026-08-20')

      expect(log).toHaveBeenCalledWith('Best-effort contributions came up short', {
        date: '2026-08-20',
        short: [{ present: 0, type: 'missingvowels', wanted: 1 }],
      })
    })

    it('says nothing about best effort on a night the best-effort type delivered', async () => {
      setup('2026-08-20')

      await createPack('2026-08-20')

      expect(log).not.toHaveBeenCalledWith('Best-effort contributions came up short', expect.anything())
    })

    // Gated: these lines fire on every buildPack, including every GET through fillPack.
    it('says nothing about availability once every type has shipped', async () => {
      setup('2026-09-20')

      await createPack('2026-09-20')

      expect(log).not.toHaveBeenCalledWith('Contributions not yet available for this date', expect.anything())
    })

    // `[].every()` is true, so a date no contribution applies to grades complete over zero
    // puzzles. Deliberate -- complete: false would put an archived date into a permanent client
    // refetch -- but it is the shape that loses an alarm, so the build says so out loud. Reachable
    // through the manual retry path, checked for format rather than range.
    it('names a date no contribution applies to rather than grading it complete in silence', async () => {
      setup('2026-07-31')

      const pack = await createPack('2026-07-31')

      expect(pack).toEqual({ complete: true, date: '2026-07-31', puzzles: [] })
      expect(log).toHaveBeenCalledWith('No contribution applies to this date, so an empty pack grades complete', {
        date: '2026-07-31',
      })
    })
  })

  // isComplete has three call sites and buildPack can return from any, so a date missed at one
  // makes the flag disagree with itself by path. '2026-08-20' predates notYetShipped, so every
  // path must say complete: true; any site grading against the undated registry says false.
  describe('every path buildPack can return from', () => {
    const stale = [puzzleFor('gofigure', 1)]

    it('grades the happy path against the date', async () => {
      setup('2026-08-20', stale)

      const pack = await createPack('2026-08-20')

      expect(mockSetPackByDate).toHaveBeenCalled()
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure', 'missingvowels'])
      expect(pack.complete).toEqual(true)
    })

    it('grades the write-failed fallback against the date', async () => {
      setup('2026-08-20', stale)
      mockSetPackByDate.mockRejectedValue(new Error('table on fire'))

      const pack = await createPack('2026-08-20')

      // The existing persisted puzzles, so the generated missingvowels is gone.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })

    it('grades the lost-race re-read against the date', async () => {
      setup('2026-08-20', stale)
      mockSetPackByDate.mockResolvedValue(false)

      const pack = await createPack('2026-08-20')

      // The stored pack says complete: false. It is recomputed against the date, not read.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })
  })
})
