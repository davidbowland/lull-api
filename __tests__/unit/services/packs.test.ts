import { createPack, missingDifficulties } from '@services/packs'
import { Difficulty, Pack, PackContribution, Puzzle, PuzzleType } from '@types'
import { log, logError } from '@utils/logging'

const mockGenerate = jest.fn()
const mockSlowGenerate = jest.fn()
const mockPhraseGenerate = jest.fn()
// Two types with different inRequest grades, so a createPack narrowed to `filter(inRequest)` goes
// red here. Their difficulty sets are disjoint ([1, 2, 3] against [4]) so missingDifficulties'
// `puzzle.type === generator.type` filter is exercised. availableFrom must be at or BEFORE
// packDate, or nothing applies and the whole suite goes green asserting nothing.
const selfContained = [
  {
    availableFrom: '2026-06-01',
    countPerDay: 3,
    difficulties: [1, 2, 3],
    generate: (...args: unknown[]) => mockGenerate(...args),
    inRequest: true,
    type: 'gofigure',
  },
  {
    availableFrom: '2026-06-01',
    countPerDay: 1,
    difficulties: [4],
    generate: (...args: unknown[]) => mockSlowGenerate(...args),
    inRequest: false,
    type: 'phrazle',
  },
]
const phraseBacked = [
  {
    availableFrom: '2026-06-01',
    countPerDay: 1,
    difficulties: [5],
    generate: (...args: unknown[]) => mockPhraseGenerate(...args),
    // Required on PhraseGenerator: without it packs.ts throws a TypeError rather than failing tsc.
    isUsablePhrase: () => true,
    type: 'missingvowels',
  },
]
jest.mock('@generators/index', () => ({
  allContributions: [...selfContained, ...phraseBacked],
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
  data: { goal: difficulty * 100 },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 180,
  id: `${packDate}:phrazle:short${difficulty}`,
  type: 'phrazle' as unknown as PuzzleType,
})

const phrasePuzzleFor = (difficulty: number): Puzzle => ({
  data: { answer: 'The Empire Strikes Back' },
  difficulty: difficulty as Difficulty,
  estimatedSeconds: 90,
  id: `${packDate}:missingvowels:short${difficulty}`,
  type: 'missingvowels',
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
      // complete is false by design: the phrase-backed type is added later by the async builder.
      expect(result).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
      })
    })

    // inRequest bounds a REQUEST; the nightly run ignores it, or the pack is short every day.
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

    // Difficulties already present are counted per TYPE: without that filter a stored phrazle at
    // difficulty 2 counts as goFigure's and the pack ships one short with nothing to notice it.
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

    // Two rejections for one lost band: the draw and its retry must both fail.
    it('loses only the failed puzzle when a generate call throws', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(4)
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
      expect(result.complete).toBe(false)
    })

    it('writes the surviving puzzles of an incomplete pack', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      await createPack(packDate)

      expect(writtenPack()).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)],
      })
    })

    // Four rejections, two bands: difficulties 1 and 2 each burn a draw and its retry.
    it('keeps generating after a failure rather than losing the whole type', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('first retry'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))
      mockGenerate.mockRejectedValueOnce(new Error('second retry'))

      const result = await createPack(packDate)

      expect(result.puzzles).toEqual([puzzleFor(3), slowPuzzleFor(4)])
      expect(result.complete).toBe(false)
    })

    // Per generate CALL, not per generator: a type whose every draw fails must not take the other
    // type down with it. Six rejections -- three bands, each with its retry.
    it('keeps the other type when one generator fails every call', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('first retry'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))
      mockGenerate.mockRejectedValueOnce(new Error('second retry'))
      mockGenerate.mockRejectedValueOnce(new Error('third'))
      mockGenerate.mockRejectedValueOnce(new Error('third retry'))

      const result = await createPack(packDate)

      expect(mockSlowGenerate).toHaveBeenCalledTimes(1)
      expect(result.puzzles).toEqual([slowPuzzleFor(4)])
    })

    // Most of what these generators throw is a bad draw off Math.random, so a second call fills.
    it('retries a failed draw once and keeps the puzzle', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(4)
      expect(result.puzzles).toEqual([puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
    })

    it('raises no alarm for a draw the retry rescued', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      await createPack(packDate)

      expect(logError).not.toHaveBeenCalled()
    })

    // A type whose every draw needs two is a generator defect that a silent rescue would hide.
    it('logs the retry it spent', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      await createPack(packDate)

      expect(log).toHaveBeenCalledWith(
        'Retrying a puzzle that failed to generate',
        expect.objectContaining({ attempt: 1, date: packDate, difficulty: 1, type: 'gofigure' }),
      )
    })

    // Bounded at two calls: difficulty 1 spends both attempts and is lost, 2 and 3 take one each.
    it('gives up after one retry rather than drawing a third time', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(4)
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
    })

    // Both attempts must fail to reach the ERROR: it is for a band the retry could not rescue.
    it('still logs an error and continues for an ordinary failed draw', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('bad draw'))
      mockGenerate.mockRejectedValueOnce(new Error('bad draw again'))

      const result = await createPack(packDate)

      expect(logError).toHaveBeenCalledWith('Puzzle generation failed', expect.objectContaining({ difficulty: 1 }))
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3), slowPuzzleFor(4)])
    })

    // With exact equality an over-full pack is permanently incomplete -- nothing is missing, so
    // nothing is generated or written and the flag never clears. Reachable when countPerDay shrinks.
    it('treats an over-full pack as complete rather than stranding it', async () => {
      const overFull: Pack = {
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(1), puzzleFor(2), puzzleFor(3), slowPuzzleFor(4), phrasePuzzleFor(5)],
      }
      mockGetPackByDate.mockResolvedValueOnce(overFull)

      const result = await createPack(packDate)

      // Non-vacuity: "no contribution applies here" produces the same untouched complete pack, so
      // this pins that goFigure is in range and owes three, making four puzzles the over-full case.
      expect(missingDifficulties(selfContained[0] as PackContribution, [], packDate)).toEqual([1, 2, 3])
      expect(result.puzzles).toEqual(overFull.puzzles)
      expect(result.complete).toEqual(true)
      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockSlowGenerate).not.toHaveBeenCalled()
    })

    // The local copy holds puzzle ids that were never persisted. A client caching them would key
    // lull:progress against ids the next refetch cannot contain.
    it('returns the stored pack rather than its own discarded copy when another run wrote first', async () => {
      // Distinct ids: a winner from puzzleFor() would be deep-equal to the discarded copy.
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
          { ...slowPuzzleFor(4), id: `${packDate}:phrazle:winner4` },
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

    // The stored flag was frozen at write time by whichever deploy wrote it, so a newer deploy
    // that loses the race and re-reads would hand back a stale complete: true -- suppressing
    // create-pack.ts's alarm and serving a short day the client stops refetching.
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

    // Unreachable in practice, but v8 counts the line covered either way, so without this the
    // branch gate stays green over a fallback nobody ever ran.
    it('falls back to its own copy when the re-read comes back empty', async () => {
      mockGetPackByDate.mockResolvedValueOnce(undefined)
      mockSetPackByDate.mockResolvedValueOnce(false)
      mockGetPackByDate.mockResolvedValueOnce(undefined)

      const result = await createPack(packDate)

      // complete is false by design; see the first case in this block.
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
