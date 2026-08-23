import { createPack, hasWorkRemaining, missingDifficulties } from '@services/packs'
import { Difficulty, PackContribution, Puzzle } from '@types'
import { log } from '@utils/logging'

// One mock per contribution rather than one shared. A single mock cannot fail exactly one
// contribution, and every test below turns on which type is MISSING -- so a shared mock either
// produces everything (nothing is ever incomplete) or produces the wrong type for two of the three.
const mockShippedGenerate = jest.fn()
const mockNotYetShippedGenerate = jest.fn()
const mockProbationGenerate = jest.fn()

// Three contributions, chosen to separate the two flags. `shipped` is the ordinary case;
// `notYetShipped` is a type whose lull-ui reader lands later; `probation` is the bestEffort case.
// The dates are LITERALS. Nothing in this file derives "today" from a clock.
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
// modelContributions is exported by the real module and read by nothing here, but a mock that omits
// an export hands back `undefined` the day packs.ts imports it -- silently, since the mock factory
// is not type-checked against the module it replaces.
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
    // Each generator emits ITS OWN type. A fake that emitted one type for all three would satisfy
    // every countPerDay from a single call and no completeness assertion below could fail.
    mockShippedGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('gofigure', difficulty))
    mockNotYetShippedGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('cryptogram', difficulty))
    mockProbationGenerate.mockImplementation(async (_date, difficulty) => puzzleFor('missingvowels', difficulty))
  }

  describe('missingDifficulties', () => {
    // The boundary, the day before and the day after -- three literal dates, no arithmetic.
    it.each([
      ['the day before it applies', '2026-09-14', []],
      ['the day it applies', '2026-09-15', [2]],
      ['the day after it applies', '2026-09-16', [2]],
    ])('returns %s -> %p', (_description, date, expected) => {
      expect(missingDifficulties(notYetShipped as PackContribution, [], date)).toEqual(expected)
    })

    // bestEffort is filtered in isComplete and NOWHERE else. missingDifficulties still asks the
    // builder for what is missing, so a good night still fills the pack.
    it('still asks for a best-effort contribution', () => {
      expect(missingDifficulties(probation as PackContribution, [], '2026-08-20')).toEqual([3])
    })
  })

  describe('isComplete, through createPack', () => {
    it('ignores a contribution that had not shipped on that date', async () => {
      setup('2026-08-20')

      const pack = await createPack('2026-08-20')

      // The pack holds no cryptogram at all, and is complete regardless: notYetShipped is out of
      // range on this date, so isComplete never asks for it.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure', 'missingvowels'])
      expect(pack.complete).toEqual(true)
      // And the same filter reached the produce path. Without this the assertion above would still
      // pass with missingDifficulties left undated, which is the half of the change a `complete`
      // flag cannot see.
      expect(mockNotYetShippedGenerate).not.toHaveBeenCalled()
    })

    it('counts a contribution on the very day it ships', async () => {
      // The boundary itself, so appliesTo using `<` instead of `<=` fails here rather than passing
      // for a day. The type ships and immediately fails to produce, which is the only way its
      // absence can hold the flag down.
      setup('2026-09-15')
      mockNotYetShippedGenerate.mockRejectedValue(new Error('nothing to draw from yet'))

      const pack = await createPack('2026-09-15')

      expect(mockNotYetShippedGenerate).toHaveBeenCalledWith('2026-09-15', 2)
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure', 'missingvowels'])
      expect(pack.complete).toEqual(false)
    })

    it('ignores a best-effort contribution that produced nothing', async () => {
      // shipped is already satisfied by the stored puzzle, so probation's is the only call made --
      // and it fails, leaving the pack short of a missingvowels it is allowed to be short of.
      setup('2026-08-20', [puzzleFor('gofigure', 1)])
      mockProbationGenerate.mockRejectedValue(new Error('the model was having a day'))

      const pack = await createPack('2026-08-20')

      expect(mockProbationGenerate).toHaveBeenCalledWith('2026-08-20', 3)
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })
  })

  // THE BUILDER TRIGGER, which is a different question from the refetch signal and must not be
  // asked through it. isComplete SKIPS a best-effort contribution, so a date whose only gap is
  // best-effort reads complete: true -- and both invocation sites gate the async builder on that
  // flag. Wired that way, the moment a type declares bestEffort: true nothing ever invokes a builder
  // for a pack short of only that type: it ships zero puzzles of it, and the retry that exists to
  // repair a short day cannot reach it either. `complete` answers "should the client refetch";
  // hasWorkRemaining answers "is anything still worth attempting", and only the second may gate a
  // builder.
  describe('hasWorkRemaining', () => {
    it('sees a best-effort gap that the complete flag is allowed to ignore', async () => {
      setup('2026-08-20', [puzzleFor('gofigure', 1)])
      mockProbationGenerate.mockRejectedValue(new Error('the model was having a day'))

      const pack = await createPack('2026-08-20')

      // Both halves in one assertion pair, because the defect is the DISAGREEMENT between them: the
      // pack is complete for the client and still owes a puzzle to anything that can build one.
      expect(pack.complete).toEqual(true)
      expect(hasWorkRemaining('2026-08-20', pack.puzzles)).toEqual(true)
    })

    it('reports nothing left to attempt once every applicable contribution is satisfied', () => {
      const full = [puzzleFor('gofigure', 1), puzzleFor('missingvowels', 3)]

      expect(hasWorkRemaining('2026-08-20', full)).toEqual(false)
    })

    // Dated exactly like isComplete, and this is the half that bounds the blast radius: without it
    // the day a type ships, every pack ever written reports work remaining and the whole archive
    // becomes eligible for the model builder at once.
    it.each([
      ['the day before it applies', '2026-09-14', false],
      ['the day it applies', '2026-09-15', true],
    ])('with only the unshipped type missing, %s -> %p', (_description, date, expected) => {
      const present = [puzzleFor('gofigure', 1), puzzleFor('missingvowels', 3)]

      expect(hasWorkRemaining(date, present)).toEqual(expected)
    })

    // The empty-filter direction, stated as its own case because `some` and `every` disagree on it:
    // a date no type applies to owes nothing, so nothing may be invoked for it.
    it('reports nothing left to attempt on a date no contribution applies to', () => {
      expect(hasWorkRemaining('2026-07-31', [])).toEqual(false)
    })
  })

  // Both of these failure modes are SILENT by construction -- a contribution dated into the future
  // never runs and isComplete never asks for it; a best-effort type that produces nothing raises no
  // pack-level alarm, which is the point -- so each gets a line naming itself. Pinned to the message
  // AND the payload: deleting either line used to fail nothing at all.
  describe('what a pack build says about itself', () => {
    it('names the types that had not shipped on that date', async () => {
      setup('2026-08-20')

      await createPack('2026-08-20')

      expect(log).toHaveBeenCalledWith('Contributions not yet available for this date', {
        date: '2026-08-20',
        types: ['cryptogram'],
      })
    })

    // OUTCOME, never permission. A line reporting which types are ALLOWED to be short is
    // byte-identical on a perfect night and on one where the best-effort type produced nothing,
    // which is the only night worth logging -- so it names what actually came up short and by how
    // much.
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

    // Gated, because every one of these lines fires on every buildPack -- including every GET that
    // goes through fillPack, eight dates deep per cold client. An INFO line carrying an empty list
    // is the state the system is in today and would be the only state it ever logged.
    it('says nothing about availability once every type has shipped', async () => {
      setup('2026-09-20')

      await createPack('2026-09-20')

      expect(log).not.toHaveBeenCalledWith('Contributions not yet available for this date', expect.anything())
    })

    // `[].every()` is true, so a date no contribution applies to grades COMPLETE over zero puzzles.
    // That is deliberate rather than an oversight -- complete: false would put an archived date into
    // a permanent client refetch, and hasWorkRemaining above is what keeps the builder off it -- but
    // it is exactly the shape that loses an alarm, so the build says so out loud. Reachable today
    // through the MANUAL RETRY path, whose target is legitimately in the past and so is checked for
    // format rather than range: `{"date": "2026-05-01"}` builds nothing, writes nothing, and used to
    // report a complete pack while doing it. Not reachable through the route while PACK_START_DATE
    // equals the first type's availableFrom, which is what template.yaml sets today.
    it('names a date no contribution applies to rather than grading it complete in silence', async () => {
      setup('2026-07-31')

      const pack = await createPack('2026-07-31')

      expect(pack).toEqual({ complete: true, date: '2026-07-31', puzzles: [] })
      expect(log).toHaveBeenCalledWith('No contribution applies to this date, so an empty pack grades complete', {
        date: '2026-07-31',
      })
    })
  })

  // isComplete has THREE call sites and buildPack can return from any of them. Two are one-line
  // returns a diff reviewer reads past, and a date missed at either grades a pack served from a
  // fallback path against a different rule than one served from the happy path -- so the flag would
  // disagree with itself depending on which path produced the response.
  //
  // One stale pack, one date, three paths. '2026-08-20' predates notYetShipped, so every path must
  // say complete: true; any site still grading against the live undated registry says false,
  // because the pack holds no cryptogram.
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

      // The EXISTING PERSISTED puzzles, so the generated missingvowels is gone -- and the flag is
      // still the happy path's.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })

    it('grades the lost-race re-read against the date', async () => {
      setup('2026-08-20', stale)
      mockSetPackByDate.mockResolvedValue(false)

      const pack = await createPack('2026-08-20')

      // The stored pack says complete: false. It is recomputed, not read, and recomputed against
      // the date.
      expect(pack.puzzles.map((puzzle) => puzzle.type)).toEqual(['gofigure'])
      expect(pack.complete).toEqual(true)
    })
  })
})
