import { addModelPuzzles, hasWorkRemaining } from '@services/packs'
import { Candidate, Difficulty, ModelGenerator, Pack, Puzzle, PuzzleType } from '@types'
import { log, logError } from '@utils/logging'

// availableFrom is at or BEFORE packDate, or nothing applies and the suite goes green asserting
// nothing. A bare literal with no jest.fn() and no cast: babel-plugin-jest-hoist only lets a
// hoisted jest.mock factory reference an out-of-scope const whose initializer is pure, so a
// `fetchCandidates: jest.fn()` here fails the whole transform.
const themedAnagrams = {
  availableFrom: '2026-08-01',
  baseSeconds: 60,
  countPerDay: 3,
  difficulties: [2, 3, 4],
  secondsPerDifficulty: 15,
  type: 'themedanagrams',
}

jest.mock('@generators/index', () => ({
  allContributions: [themedAnagrams],
  modelContributions: [themedAnagrams],
  phraseGenerators: [],
  selfContainedGenerators: [],
}))

const generator = themedAnagrams as unknown as ModelGenerator

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const packDate = '2026-08-20'

const puzzleFor = (difficulty: Difficulty): Puzzle => ({
  data: {},
  difficulty,
  estimatedSeconds: 60,
  id: `${packDate}:themedanagrams:d${difficulty}`,
  type: 'themedanagrams' as unknown as PuzzleType,
})

const candidateFor = (
  usableAt: Difficulty[],
  build: Candidate['build'] = async (_date, difficulty) => puzzleFor(difficulty),
): Candidate => ({ build, usableAt })

const explodingCandidate = (usableAt: Difficulty[]): Candidate =>
  candidateFor(usableAt, async () => {
    throw new Error('the scrambler is broken')
  })

const buildsFine: Candidate['build'] = async (_date, difficulty) => puzzleFor(difficulty)

// Throws on its first call and builds after -- what a bad scramble draw does. Drained by shift
// rather than a counter and a branch, since tests here carry no `if`.
const flakyCandidate = (usableAt: Difficulty[]): Candidate => {
  const queued: Candidate['build'][] = [
    async () => {
      throw new Error('the scrambler drew badly')
    },
  ]
  return candidateFor(usableAt, (date, difficulty) => (queued.shift() ?? buildsFine)(date, difficulty))
}

const writtenPack = (): Pack => mockSetPackByDate.mock.calls[0][1]

describe('addModelPuzzles', () => {
  // A named setup() called explicitly, never a beforeEach; what the pack holds is the argument.
  const setup = (existing: Puzzle[] = []): void => {
    mockGetPackByDate.mockResolvedValue({ complete: false, date: packDate, puzzles: existing })
  }

  beforeAll(() => {
    mockSetPackByDate.mockResolvedValue(true)
  })

  it('fills one puzzle per missing difficulty', async () => {
    setup()

    const { pack } = await addModelPuzzles(
      packDate,
      generator,
      [2, 3, 4],
      [candidateFor([2, 3, 4]), candidateFor([2, 3, 4]), candidateFor([2, 3, 4])],
    )

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 3, 4])
  })

  it('builds each puzzle at the date and difficulty it was asked for', async () => {
    setup()
    const build = jest.fn(async (_date: string, difficulty: Difficulty) => puzzleFor(difficulty))

    await addModelPuzzles(packDate, generator, [3], [{ build, usableAt: [3] }])

    expect(build).toHaveBeenCalledWith(packDate, 3)
  })

  // One draft filling two slots would ship the same puzzle twice in a day.
  it('spends a candidate once and never twice', async () => {
    setup()

    const { pack } = await addModelPuzzles(packDate, generator, [2, 3], [candidateFor([2, 3])])

    expect(pack.puzzles).toHaveLength(1)
  })

  // First fit, not most-constrained-first: bestFitIndex exists to stop several generators sharing
  // one pool, and a ModelGenerator allocates from a pool it asked for itself.
  it('takes candidates in the order the generator returned them', async () => {
    setup()
    const first = jest.fn(async (_date: string, difficulty: Difficulty) => puzzleFor(difficulty))
    const second = jest.fn(async (_date: string, difficulty: Difficulty) => puzzleFor(difficulty))

    await addModelPuzzles(
      packDate,
      generator,
      [2],
      [
        { build: first, usableAt: [2, 3, 4] },
        { build: second, usableAt: [2] },
      ],
    )

    expect(first).toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  // usableAt is a constraint, not a hint.
  it('skips a candidate that cannot carry the difficulty', async () => {
    setup()
    const wrongBand = jest.fn(async (_date: string, difficulty: Difficulty) => puzzleFor(difficulty))

    const { pack } = await addModelPuzzles(packDate, generator, [4], [{ build: wrongBand, usableAt: [2] }])

    expect(wrongBand).not.toHaveBeenCalled()
    expect(pack.puzzles).toStrictEqual([])
  })

  // The catch is around each build CALL, so one throw costs one puzzle and not the type's night.
  it('costs one puzzle when a build throws, not the type', async () => {
    setup()

    const { pack } = await addModelPuzzles(packDate, generator, [2, 3], [explodingCandidate([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([3])
    expect(log).toHaveBeenCalledWith(
      'Could not build a model puzzle',
      expect.objectContaining({ date: packDate, difficulty: 2, type: 'themedanagrams' }),
    )
  })

  // The absence of the ERROR is the assertion: an ERROR here pages at the same volume for one
  // lost puzzle as for a type that shipped none. The per-type page belongs to
  // create-model-puzzles.ts, where the count against countPerDay is knowable.
  it('does not raise the alarm for a build that cost one puzzle', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [2, 3], [explodingCandidate([2]), candidateFor([3])])

    expect(logError).not.toHaveBeenCalled()
  })

  // The retry rebuilds the same draft rather than reaching for the next, which would be the
  // allocator's decision. Rebuilding is local CPU: fetchCandidates ran once for the whole type.
  it('retries a failed build once and keeps the puzzle', async () => {
    setup()

    const { pack } = await addModelPuzzles(packDate, generator, [2, 3], [flakyCandidate([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 3])
  })

  // The catch cannot be hoisted out of the loop without this going red.
  it('attempts every difficulty even when the first two throw', async () => {
    setup()
    const attempted: Difficulty[] = []
    const exploding = (usableAt: Difficulty[]): Candidate =>
      candidateFor(usableAt, async (_date, difficulty) => {
        attempted.push(difficulty)
        throw new Error('the scrambler is broken')
      })

    await addModelPuzzles(packDate, generator, [2, 3, 4], [exploding([2]), exploding([3]), exploding([4])])

    // Each difficulty twice -- build and retry -- written out rather than deduped, so this stays
    // red both for a hoisted catch and for a retry that quietly stopped happening.
    expect(attempted).toStrictEqual([2, 2, 3, 3, 4, 4])
  })

  // The candidate is already spent, so the next difficulty does not reach for the same failing
  // draft. The retry is separate -- it rebuilds in place for the difficulty the draft was selected
  // for -- which is why this asserts the difficulties rather than a call count.
  it('does not spend a used candidate on the next difficulty when its build threw', async () => {
    setup()
    const build = jest.fn(async () => {
      throw new Error('the scrambler is broken')
    })

    await addModelPuzzles(packDate, generator, [2, 3], [{ build, usableAt: [2, 3] }])

    expect(build.mock.calls.map((call) => call[1])).toStrictEqual([2, 2])
  })

  it('does not propagate a throwing build', async () => {
    setup()

    await expect(addModelPuzzles(packDate, generator, [2], [explodingCandidate([2])])).resolves.toBeDefined()
  })

  // Exhaustion of a band is normal; the handler's per-type shortfall ERROR is what alarms.
  it('logs a shortfall rather than throwing when a difficulty has no usable candidate', async () => {
    setup()

    const { pack } = await addModelPuzzles(packDate, generator, [2, 4], [candidateFor([2])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2])
    expect(logError).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('No usable candidate for this difficulty', {
      date: packDate,
      difficulty: 4,
      type: 'themedanagrams',
    })
  })

  it('writes once for the whole type', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [2, 3, 4], [candidateFor([2]), candidateFor([3]), candidateFor([4])])

    expect(mockSetPackByDate).toHaveBeenCalledTimes(1)
    expect(writtenPack().puzzles).toHaveLength(3)
  })

  // The seam, one direction: the handler drew its candidate list against a `missing` computed
  // before the model call, so the ASK stays authoritative. Re-deriving inside the produce would
  // generate more bands than there are candidates for.
  it('honors the passed-in missing set, not what buildPack re-reads', async () => {
    setup()

    const { pack } = await addModelPuzzles(packDate, generator, [3], [candidateFor([2, 3, 4]), candidateFor([2, 3, 4])])

    // A re-derivation against buildPack's read -- an empty pack -- would have generated 2, 3 and 4.
    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([3])
  })

  // The seam, the other direction: the FILL is filtered against what buildPack actually read,
  // because nothing here dedupes -- the merge is [...existing, ...generated] and no id compared.
  it('does not refill a band that filled between the ask and the read', async () => {
    setup([puzzleFor(2)])

    const { pack } = await addModelPuzzles(
      packDate,
      generator,
      [2, 3, 4],
      [candidateFor([2, 3, 4]), candidateFor([2, 3, 4])],
    )

    expect(pack.puzzles.map((puzzle) => puzzle.id)).toStrictEqual([
      `${packDate}:themedanagrams:d2`,
      `${packDate}:themedanagrams:d3`,
      `${packDate}:themedanagrams:d4`,
    ])
    expect(log).toHaveBeenCalledWith('Some bands filled between the ask and the read, skipping them', {
      date: packDate,
      skipped: [2],
      type: 'themedanagrams',
    })
  })

  // Gated: a run that raced nobody, which is every run on a healthy night, says nothing.
  it('says nothing about a race that did not happen', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [2, 3], [candidateFor([2]), candidateFor([3])])

    expect(log).not.toHaveBeenCalledWith(
      'Some bands filled between the ask and the read, skipping them',
      expect.anything(),
    )
  })

  // Why the duplicate matters: countOfType counts it, isSatisfied's `>=` grades a countPerDay-3
  // type satisfied on two distinct puzzles, and hasWorkRemaining -- the only question allowed to
  // gate a builder -- says false, so the missing band is never built.
  it('grades the pack incomplete while a band is still unbuilt', async () => {
    setup([puzzleFor(2)])

    const { pack } = await addModelPuzzles(packDate, generator, [2, 3, 4], [candidateFor([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 3])
    expect(pack.complete).toBe(false)
    expect(hasWorkRemaining(packDate, pack.puzzles)).toBe(true)
  })

  // Dropped from the FILL, never from the candidate list, so the candidate is left for a real gap.
  it('leaves a candidate unspent for a later band rather than burning it on a filled one', async () => {
    setup([puzzleFor(2)])

    const { pack } = await addModelPuzzles(packDate, generator, [2, 4], [candidateFor([2, 4])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 4])
  })

  // Merged onto what is stored: regenerating wholesale would leave a player's lull:progress
  // attached to a different puzzle under the same id.
  it('keeps the stored puzzles alongside the generated ones', async () => {
    const stored = puzzleFor(4)
    setup([stored])

    const { pack } = await addModelPuzzles(packDate, generator, [2], [candidateFor([2])])

    expect(pack.puzzles[0]).toBe(stored)
  })

  it('writes nothing when every difficulty is already filled', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [], [candidateFor([2])])

    expect(mockSetPackByDate).not.toHaveBeenCalled()
  })
})
