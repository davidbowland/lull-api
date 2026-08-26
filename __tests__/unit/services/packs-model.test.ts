import { addModelPuzzles, hasWorkRemaining } from '@services/packs'
import { Candidate, Difficulty, ModelGenerator, Pack, Puzzle, PuzzleType } from '@types'
import { log, logError } from '@utils/logging'

// 'themedanagrams' is named in the system design and unbuilt, so this fixture cannot collide with a
// real generator. It is cast because it is genuinely not a PuzzleType yet, and tests are not
// type-checked.
//
// availableFrom is at or BEFORE this suite's packDate. A fixture dated after the date under test
// applies to nothing: isComplete filters every contribution away and grades an empty list complete,
// and the suite goes green while asserting nothing.
//
// A BARE LITERAL, holding no jest.fn() and no cast. jest.mock is hoisted above every declaration in
// the file, and babel-plugin-jest-hoist only lets a hoisted factory reference an out-of-scope const
// whose initializer is PURE -- so a `fetchCandidates: jest.fn()` on this object makes the whole suite
// fail to transform with "not allowed to reference any out-of-scope variables". addModelPuzzles never
// calls fetchCandidates, so the field is simply absent and the cast happens below at the use site.
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

// Throws on its FIRST call and builds on every one after -- what a bad scramble draw does, and what
// the one retry exists to catch. A queue drained by shift rather than a counter and a branch, since
// tests here carry no `if`.
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
  // A named setup() called explicitly, never a beforeEach. Shared defaults live in beforeAll and the
  // one thing a test varies -- what the pack already holds -- is the argument.
  const setup = (existing: Puzzle[] = []): void => {
    mockGetPackByDate.mockResolvedValue({ complete: false, date: packDate, puzzles: existing })
  }

  beforeAll(() => {
    mockSetPackByDate.mockResolvedValue(true)
  })

  it('fills one puzzle per missing difficulty', async () => {
    setup()

    const pack = await addModelPuzzles(
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

  // A candidate is SPENT once. One draft filling two slots would ship the same puzzle twice in a
  // day, which is the failure the phrase allocator's one-phrase-per-puzzle rule exists to prevent,
  // one lane over.
  it('spends a candidate once and never twice', async () => {
    setup()

    const pack = await addModelPuzzles(packDate, generator, [2, 3], [candidateFor([2, 3])])

    expect(pack.puzzles).toHaveLength(1)
  })

  // First fit in the order the generator returned them. NOT most-constrained-first: bestFitIndex
  // exists to stop several generators competing over ONE exhaustible shared pool, and a
  // ModelGenerator allocates from a pool it asked for itself.
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

  // A candidate that cannot carry the difficulty is skipped rather than built at it -- usableAt is a
  // constraint, not a hint.
  it('skips a candidate that cannot carry the difficulty', async () => {
    setup()
    const wrongBand = jest.fn(async (_date: string, difficulty: Difficulty) => puzzleFor(difficulty))

    const pack = await addModelPuzzles(packDate, generator, [4], [{ build: wrongBand, usableAt: [2] }])

    expect(wrongBand).not.toHaveBeenCalled()
    expect(pack.puzzles).toStrictEqual([])
  })

  // A throwing build costs ONE puzzle, never the type's whole night. The catch is around each build
  // CALL -- the rule packs.ts already states for generateSelfContained, applied to a lane that never
  // reaches that code path.
  it('costs one puzzle when a build throws, not the type', async () => {
    setup()

    const pack = await addModelPuzzles(packDate, generator, [2, 3], [explodingCandidate([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([3])
    expect(log).toHaveBeenCalledWith(
      'Could not build a model puzzle',
      expect.objectContaining({ date: packDate, difficulty: 2, type: 'themedanagrams' }),
    )
  })

  // A `log`, and the absence of the ERROR is the assertion. Difficulty 3 still built, so this is a
  // RECOVERED failure, and this stack's only alarm channel is a level="ERROR" subscription -- an
  // ERROR here pages at the same volume for one lost puzzle as for a type that shipped none. The
  // per-type page belongs to create-model-puzzles.ts, which is where the count against countPerDay
  // is knowable.
  it('does not raise the alarm for a build that cost one puzzle', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [2, 3], [explodingCandidate([2]), candidateFor([3])])

    expect(logError).not.toHaveBeenCalled()
  })

  // The candidate is SPENT either way -- the retry rebuilds the same draft rather than reaching for
  // the next one, which would be the allocator's decision and not a retry's. Rebuilding is local
  // CPU: fetchCandidates ran once for the whole type and no retry here costs a model call.
  it('retries a failed build once and keeps the puzzle', async () => {
    setup()

    const pack = await addModelPuzzles(packDate, generator, [2, 3], [flakyCandidate([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 3])
  })

  // Every declared difficulty exploding still writes nothing rather than throwing, and every one of
  // them is attempted -- the catch cannot be hoisted out of the loop without this going red.
  it('attempts every difficulty even when the first two throw', async () => {
    setup()
    const attempted: Difficulty[] = []
    const exploding = (usableAt: Difficulty[]): Candidate =>
      candidateFor(usableAt, async (_date, difficulty) => {
        attempted.push(difficulty)
        throw new Error('the scrambler is broken')
      })

    await addModelPuzzles(packDate, generator, [2, 3, 4], [exploding([2]), exploding([3]), exploding([4])])

    // Each difficulty twice -- its build and one retry -- and written out rather than deduped, so
    // this stays red both for a catch hoisted out of the loop AND for a retry that quietly stopped
    // happening.
    expect(attempted).toStrictEqual([2, 2, 3, 3, 4, 4])
  })

  // The candidate is already spent, so the NEXT DIFFICULTY does not reach for the same failing
  // draft -- the same rule generateFromPhrases applies to a spent phrase. That rule is about the
  // allocator and is untouched by the retry, which rebuilds the draft in place for the difficulty
  // it was selected for; this used to assert a call COUNT of one, which conflated the two.
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

  // Exhaustion of a band is a normal property of a draw. Throwing on it names the wrong cause at
  // 3am; the per-type shortfall ERROR in the handler is what actually alarms.
  it('logs a shortfall rather than throwing when a difficulty has no usable candidate', async () => {
    setup()

    const pack = await addModelPuzzles(packDate, generator, [2, 4], [candidateFor([2])])

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

  // THE SEAM, one direction. The handler computed `missing` against a pack it read BEFORE the model
  // call and drew its candidate list against exactly that number, so the ASK stays authoritative: a
  // band the handler did not ask for is never filled, however buildPack's later read grades it.
  // Re-deriving inside the produce would generate more bands than there are candidates for and turn
  // a full draw into a shortfall the type did not have to have.
  it('honors the passed-in missing set, not what buildPack re-reads', async () => {
    setup()

    const pack = await addModelPuzzles(packDate, generator, [3], [candidateFor([2, 3, 4]), candidateFor([2, 3, 4])])

    // A re-derivation against buildPack's read -- an empty pack -- would have generated 2, 3 and 4.
    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([3])
  })

  // THE SEAM, the other direction, and the duplicate it used to write. `missing` is authoritative for
  // the ask; the FILL is filtered against what buildPack actually read, because NOTHING on this path
  // dedupes -- the merge is [...existing, ...generated] and no id is ever compared. A band that
  // filled between the handler's read and buildPack's was rebuilt on top of itself, so the pack
  // carried two puzzles under one id.
  it('does not refill a band that filled between the ask and the read', async () => {
    setup([puzzleFor(2)])

    const pack = await addModelPuzzles(
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
    // The only visible sign that two builders overlapped on one date.
    expect(log).toHaveBeenCalledWith('Some bands filled between the ask and the read, skipping them', {
      date: packDate,
      skipped: [2],
      type: 'themedanagrams',
    })
  })

  // GATED. A run that raced nobody -- every run, on a healthy night -- says nothing, rather than
  // carrying an empty payload on every build.
  it('says nothing about a race that did not happen', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [2, 3], [candidateFor([2]), candidateFor([3])])

    expect(log).not.toHaveBeenCalledWith(
      'Some bands filled between the ask and the read, skipping them',
      expect.anything(),
    )
  })

  // WHY the duplicate mattered, asserted rather than argued -- and neither flag was asserted by any
  // test in either suite. countOfType counts the duplicate, isSatisfied's `>=` then grades a
  // countPerDay-3 type satisfied on two distinct puzzles, the pack is written complete: true, and
  // hasWorkRemaining -- the only question allowed to gate a builder invocation -- reports false. The
  // genuinely missing band is never built and no builder is invoked for that date again, so the
  // client stops refetching a short day.
  it('grades the pack incomplete while a band is still unbuilt', async () => {
    setup([puzzleFor(2)])

    const pack = await addModelPuzzles(packDate, generator, [2, 3, 4], [candidateFor([2]), candidateFor([3])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 3])
    expect(pack.complete).toBe(false)
    expect(hasWorkRemaining(packDate, pack.puzzles)).toBe(true)
  })

  // The band that filled is dropped from the FILL, never from the candidate list. The candidate it
  // would have been spent on is still there for a band that genuinely needs one.
  it('leaves a candidate unspent for a later band rather than burning it on a filled one', async () => {
    setup([puzzleFor(2)])

    const pack = await addModelPuzzles(packDate, generator, [2, 4], [candidateFor([2, 4])])

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty)).toStrictEqual([2, 4])
  })

  // Merged onto what is stored, never replacing it. Ids are stable while content is not, so
  // regenerating wholesale would leave a player's lull:progress attached to a different puzzle.
  it('keeps the stored puzzles alongside the generated ones', async () => {
    const stored = puzzleFor(4)
    setup([stored])

    const pack = await addModelPuzzles(packDate, generator, [2], [candidateFor([2])])

    expect(pack.puzzles[0]).toBe(stored)
  })

  it('writes nothing when every difficulty is already filled', async () => {
    setup()

    await addModelPuzzles(packDate, generator, [], [candidateFor([2])])

    expect(mockSetPackByDate).not.toHaveBeenCalled()
  })
})
