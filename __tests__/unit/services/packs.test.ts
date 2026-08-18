import { createPack } from '@services/packs'
import { Difficulty, Pack, Puzzle } from '@types'

const mockGenerate = jest.fn()
jest.mock('@generators/index', () => ({
  generators: [
    {
      countPerDay: 3,
      difficulties: [1, 2, 3],
      generate: (...args: unknown[]) => mockGenerate(...args),
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

      expect(mockSetPackByDate).toHaveBeenCalledWith(packDate, {
        complete: true,
        date: packDate,
        puzzles: [puzzleFor(1), puzzleFor(2), puzzleFor(3)],
      })
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
  })
})
