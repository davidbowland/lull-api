import { createPack } from '@services/packs'
import { Difficulty, Pack, Puzzle } from '@types'

const mockGenerate = jest.fn()
jest.mock('@generators/index', () => ({
  generators: [
    {
      countPerDay: 3,
      difficulties: [1, 2, 3],
      generate: (...args: unknown[]) => mockGenerate(...args),
      inRequest: true,
      type: 'gofigure',
    },
  ],
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

const writtenPack = (): Pack => mockSetPackByDate.mock.calls[0][1]

describe('packs', () => {
  beforeAll(() => {
    mockGenerate.mockImplementation((_date, difficulty) => Promise.resolve(puzzleFor(difficulty)))
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
      expect(result).toEqual({
        complete: true,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3)],
      })
    })

    it('writes the pack it built', async () => {
      await createPack(packDate)

      expect(mockSetPackByDate).toHaveBeenCalledWith(
        packDate,
        {
          complete: true,
          date: packDate,
          puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3)],
        },
        0,
      )
    })

    it('tops up only the missing difficulty and leaves the existing puzzles byte-identical', async () => {
      const existing: Pack = {
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(3)],
      }
      mockGetPackByDate.mockResolvedValueOnce(existing)

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(1)
      expect(mockGenerate).toHaveBeenCalledWith(packDate, 2)
      expect(JSON.stringify(result.puzzles.filter((puzzle) => puzzle.difficulty !== 2))).toBe(
        JSON.stringify(existing.puzzles),
      )
      expect(result.complete).toBe(true)
    })

    it('writes nothing when the pack is already complete', async () => {
      const existing: Pack = {
        complete: true,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3)],
      }
      mockGetPackByDate.mockResolvedValueOnce(existing)

      const result = await createPack(packDate)

      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockSetPackByDate).not.toHaveBeenCalled()
      expect(result).toEqual(existing)
    })

    it('loses only the failed puzzle when a generate call throws', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      const result = await createPack(packDate)

      expect(mockGenerate).toHaveBeenCalledTimes(3)
      expect(result.puzzles).toEqual([puzzleFor(2), puzzleFor(3)])
      expect(result.complete).toBe(false)
    })

    it('writes the surviving puzzles of an incomplete pack', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Could not draw a bank'))

      await createPack(packDate)

      expect(writtenPack()).toEqual({
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(2), puzzleFor(3)],
      })
    })

    it('keeps generating after a failure rather than losing the whole type', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('first'))
      mockGenerate.mockRejectedValueOnce(new Error('second'))

      const result = await createPack(packDate)

      expect(result.puzzles).toEqual([puzzleFor(3)])
      expect(result.complete).toBe(false)
    })

    // The blocking defect this replaced: with exact equality an over-full pack is permanently
    // incomplete -- nothing is missing so nothing is generated, so nothing is written, so the flag
    // can never clear, while the handler logs an ERROR every day forever. Reachable the moment
    // countPerDay shrinks, which the system design plans for as later types land.
    it('treats an over-full pack as complete rather than stranding it', async () => {
      const overFull: Pack = {
        complete: false,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(1), puzzleFor(2), puzzleFor(3)],
      }
      mockGetPackByDate.mockResolvedValueOnce(overFull)

      const result = await createPack(packDate)

      expect(result.complete).toEqual(true)
      expect(mockGenerate).not.toHaveBeenCalled()
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
        puzzles: [winnerPuzzle(1), winnerPuzzle(2), winnerPuzzle(3)],
      }
      mockGetPackByDate.mockResolvedValueOnce(undefined)
      mockSetPackByDate.mockResolvedValueOnce(false)
      mockGetPackByDate.mockResolvedValueOnce(winner)

      const result = await createPack(packDate)

      expect(mockSetPackByDate).toHaveBeenCalled()
      expect(result).toEqual(winner)
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
