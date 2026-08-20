import { createPack } from '@services/packs'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'
import { logError } from '@utils/logging'

const mockGenerate = jest.fn()
const mockSlowGenerate = jest.fn()
const mockPhraseGenerate = jest.fn()
// Two types with different inRequest grades, mirroring packs-fill.test.ts. The second entry is not
// decoration: with a single inRequest: true generator, mutating createPack to run
// `generators.filter((generator) => generator.inRequest)` -- which would silently halve the nightly
// pack the day a slow type ships -- left the entire suite green. The nightly run ignores the grade
// and runs every generator, and this is what witnesses it. PuzzleType is currently the single
// literal 'gofigure', so the second type is cast; tests are not type-checked.
//
// The two difficulty sets are disjoint on purpose ([1, 2, 3] against [4]). While the slow type
// declared [1] the union of every present difficulty happened to equal each type's own set in every
// case here, so missingDifficulties' `puzzle.type === generator.type` filter was a no-op across the
// whole suite and deleting it kept every test green.
const selfContained = [
  {
    countPerDay: 3,
    difficulties: [1, 2, 3],
    generate: (...args: unknown[]) => mockGenerate(...args),
    inRequest: true,
    type: 'gofigure',
  },
  {
    countPerDay: 1,
    difficulties: [4],
    generate: (...args: unknown[]) => mockSlowGenerate(...args),
    inRequest: false,
    type: 'cryptogram',
  },
]
const phraseBacked = [
  {
    countPerDay: 1,
    difficulties: [5],
    generate: (...args: unknown[]) => mockPhraseGenerate(...args),
    type: 'missingvowels',
  },
]
jest.mock('@generators/index', () => ({
  allGenerators: [...selfContained, ...phraseBacked],
  phraseGenerators: phraseBacked,
  selfContainedGenerators: selfContained,
}))

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const packDate = '2026-06-15'

const puzzleFor = (difficulty: number): Puzzle => ({
  data: { goal: difficulty * 10 },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 60,
  id: `${packDate}:gofigure:short${difficulty}`,
  type: 'gofigure',
})

const slowPuzzleFor = (difficulty: number): Puzzle => ({
  data: { ciphertext: 'KVDX BZVXH' },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 180,
  id: `${packDate}:cryptogram:short${difficulty}`,
  type: 'cryptogram' as unknown as PuzzleType,
})

const phrasePuzzleFor = (difficulty: number): Puzzle => ({
  data: { answer: 'The Empire Strikes Back' },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 90,
  id: `${packDate}:missingvowels:short${difficulty}`,
  type: 'missingvowels' as unknown as PuzzleType,
})

const writtenPack = (): Pack => mockSetPackByDate.mock.calls[0][1]

describe('packs', () => {
  beforeAll(() => {
    mockGenerate.mockImplementation((_date, difficulty) => Promise.resolve(puzzleFor(difficulty)))
    mockPhraseGenerate.mockImplementation((_date, difficulty) => Promise.resolve(phrasePuzzleFor(difficulty)))
    mockSlowGenerate.mockImplementation((_date, difficulty) => Promise.resolve(slowPuzzleFor(difficulty)))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue({})
  })

  describe('createPack', () => {
    it('generates one puzzle per declared difficulty when no pack exists', async () => {
      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(3)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 1)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 2)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 3)
      // complete is FALSE, and that is the architecture rather than a gap. createPack runs only the
      // self-contained generators; the phrase-backed type is added afterwards by the async builder,
      // so a pack is never complete until that has run.
      expect(result).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
      })
    })

    // The nightly run ignores the inRequest grade -- that grade exists to bound a REQUEST, and a
    // nightly pack that skipped the slow types would be short every single day. Without this,
    // narrowing createPack to `generators.filter((generator) => generator.inRequest)` passes.
    it('runs the generators graded out of the request as well', async () => {
      const result = await createPack(packDate)

      expect(mockSlowGenerate).toHaveBeenCalledTimes(1)
      expect(mockSlowGenerate).toHaveBeenCalledWith(packDate, 4)
      expect(result.puzzles).toContainEqual(slowPuzzleFor(4))
    })

    it('writes the pack it built', async () => {
      await createPack(packDate)

      expect(mockSetPackByDate).toHaveBeenCalledWith(
        packDate,
        {
          complete: false,
          date: packDate,
          puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
        },
        0,
      )
    })

    it('tops up only the missing difficulty and leaves the existing puzzles byte-identical', async () => {
      const existing: Pack = {
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(3), slowPuzzleFor(4), phrasePuzzleFor(5)],
      }
      mockGetPackByDate.mockResolvedValueOnce(existing)

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(1)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 2)
      expect(mockSlowGenerate).not.toHaveBeenCalled()
      expect(JSON.stringify(result.puzzles.filter((puzzle) => puzzle.difficulty !== 2))).toBe(
        JSON.stringify(existing.puzzles),
      )
      expect(result.complete).toBe(true)
    })

    // The set of difficulties already present is per TYPE. Drop missingDifficulties'
    // `puzzle.type === generator.type` filter and a stored cryptogram at difficulty 2 counts as
    // goFigure's difficulty 2: goFigure is never generated for it, the pack ships one puzzle short,
    // and nothing in the system can notice. A cryptogram at 2 is only reachable across types here
    // because the declared sets are disjoint -- the slow generator asks for 4.
    it('generates a difficulty another type already occupies', async () => {
      const existing: Pack = {
        complete: false,
        date: packDate,
        puzzles: [slowPuzzleFor(2)],
      }
      mockGetPackByDate.mockResolvedValueOnce(existing)

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(3)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 2)
      expect(mockSlowGenerate).toHaveBeenCalledWith(packDate, 4)
      expect(result.puzzles).toEqual([slowPuzzleFor(2), puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
    })

    it('writes nothing when the pack is already complete', async () => {
      const existing: Pack = {
        complete: true,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4), phrasePuzzleFor(5)],
      }
      mockGetPackByDate.mockResolvedValueOnce(existing)

      const result = await createPack(packDate)

      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockSlowGenerate).not.toHaveBeenCalled()
      expect(mockSetPackByDate).not.toHaveBeenCalled()
      expect(result).toEqual(existing)
    })

    it('loses only the failed puzzle when a generate call throws', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(3)
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
      expect(result.complete).toBe(false)
    })

    it('writes the surviving puzzles of an incomplete pack', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      await createPack(packDate)

      expect(writtenPack()).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
      })
    })

    it('keeps generating after a failure rather than losing the whole type', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))

      const result = await createPack(packDate)

      expect(result.puzzles).toEqual([puzzleFor(3), slowPuzzleFor(4)])
      expect(result.complete).toBe(false)
    })

    // Per generate CALL, not per generator: a type whose every draw fails must not take the other
    // type down with it. The registry loop is where that distinction lives.
    it('keeps the other type when one generator fails every call', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))
      mockGenerate.mockRejectedValueOnce(new Error('third'))

      const result = await createPack(packDate)

      expect(mockSlowGenerate).toHaveBeenCalledTimes(1)
      expect(result.puzzles).toEqual([slowPuzzleFor(4)])
    })

    // An ordinary draw failure keeps its ERROR and keeps going, which is the behavior the
    // unavailable path must not have quietly replaced.
    it('still logs an error and continues for an ordinary failed draw', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('bad draw'))

      const result = await createPack(packDate)

      expect(logError).toHaveBeenCalledWith('Puzzle generation failed', expect.objectContaining({ difficulty: 1 }))
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
    })

    // The blocking defect this replaced: with exact equality an over-full pack is permanently
    // incomplete -- nothing is missing so nothing is generated, so nothing is written, so the flag
    // can never clear, while the handler logs an ERROR every day forever. Reachable the moment
    // countPerDay shrinks, which the system design plans for as later types land.
    it('treats an over-full pack as complete rather than stranding it', async () => {
      const overFull: Pack = {
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4), phrasePuzzleFor(5)],
      }
      mockGetPackByDate.mockResolvedValueOnce(overFull)

      const result = await createPack(packDate)

      expect(result.complete).toEqual(true)
      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockSlowGenerate).not.toHaveBeenCalled()
    })

    // The local copy holds puzzle ids that were never persisted. A client caching them would key
    // lull:progress against ids the next refetch cannot contain.
    it('returns the stored pack rather than its own discarded copy when another run wrote first', async () => {
      // Distinct ids from the ones this run generated -- that difference is the whole point, and a
      // winner built from puzzleFor() would be deep-equal to the discarded copy and prove nothing.
      const winnerPuzzle = (difficulty: number): Puzzle => ({
        ...puzzleFor(difficulty),
        id: `${packDate}:gofigure:winner${difficulty}`,
      })
      const winner: Pack = {
        complete: true,
        date: packDate,
        puzzles: [
          winnerPuzzle(1),
          winnerPuzzle(2),
          winnerPuzzle(3),
          { ...slowPuzzleFor(4), id: `${packDate}:cryptogram:winner4` },
          { ...phrasePuzzleFor(5), id: `${packDate}:missingvowels:winner5` },
        ],
      }
      mockGetPackByDate.mockResolvedValueOnce(undefined)
      mockSetPackByDate.mockResolvedValueOnce(false)
      mockGetPackByDate.mockResolvedValueOnce(winner)

      const result = await createPack(packDate)

      expect(mockSetPackByDate).toHaveBeenCalled()
      expect(result).toEqual(winner)
    })

    // The stored flag was frozen at write time by whichever deploy's registry wrote it. An old
    // deploy stores complete: true for a full run of the only type it knew; a new deploy whose
    // registry wants more loses the race, re-reads that pack, and would hand back complete: true --
    // suppressing create-pack.ts's ERROR alarm and serving a short day the client stops refetching.
    // This is the only return path where the flag is not computed from the live registry.
    it('recomputes complete against the live registry rather than trusting the stored flag', async () => {
      const stale: Pack = {
        complete: true,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2)],
      }
      mockGetPackByDate.mockResolvedValueOnce(undefined)
      mockSetPackByDate.mockResolvedValueOnce(false)
      mockGetPackByDate.mockResolvedValueOnce(stale)

      const result = await createPack(packDate)

      expect(result.complete).toEqual(false)
      expect(result.puzzles).toEqual(stale.puzzles)
    })

    // Total-return-type insurance, and the only thing that exercises it. The consistent read makes
    // this unreachable in practice, but v8 counts the line as covered either way, so without this
    // the 90% branch gate would stay green over a fallback nobody ever ran.
    it('falls back to its own copy when the re-read comes back empty', async () => {
      mockGetPackByDate.mockResolvedValueOnce(undefined)
      mockSetPackByDate.mockResolvedValueOnce(false)
      mockGetPackByDate.mockResolvedValueOnce(undefined)

      const result = await createPack(packDate)

      // complete is FALSE, and that is the architecture rather than a gap. createPack runs only the
      // self-contained generators; the phrase-backed type is added afterwards by the async builder,
      // so a pack is never complete until that has run.
      expect(result).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
      })
    })

    it('passes the count it read so the write is conditional on it', async () => {
      mockGetPackByDate.mockResolvedValueOnce({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2)],
      })

      await createPack(packDate)

      expect(mockSetPackByDate).toHaveBeenCalledWith(packDate, expect.anything(), 2)
    })
  })
})
