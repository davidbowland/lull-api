import { createPack } from '@services/packs'
import { Puzzle } from '@types'

// The one test that wires the REAL registry through createPack. Every other suite substitutes a
// fake generator (packs.test.ts) or calls generate directly (generator.test.ts), so without this
// nothing proves the actual goFigureGenerator produces a valid, complete pack -- which is exactly
// the gap a 100%-coverage figure hides. Only the storage layer is stubbed.
const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

describe('createPack with the real registry', () => {
  const packDate = '2026-06-15'

  const setup = (): void => {
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)
  }

  it('builds a complete pack of real goFigure puzzles', async () => {
    setup()

    const pack = await createPack(packDate)

    expect(pack.complete).toEqual(true)
    expect(pack.date).toEqual(packDate)
    expect(pack.puzzles).toHaveLength(5)
  })

  it('gives every puzzle an opaque id with no positional component', async () => {
    setup()

    const pack = await createPack(packDate)
    const ids = pack.puzzles.map((puzzle) => puzzle.id)

    expect(new Set(ids).size).toEqual(ids.length)
    // date:type:shortId -- the trailing segment is random hex, never an index.
    expect(ids.filter((id) => !new RegExp(`^${packDate}:gofigure:[0-9a-f]+$`).test(id))).toEqual([])
    expect(ids.filter((id) => /:\d+$/.test(id))).toEqual([])
  })

  it('covers every declared difficulty exactly once', async () => {
    setup()

    const pack = await createPack(packDate)

    expect(pack.puzzles.map((puzzle) => puzzle.difficulty).sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('emits only positive goals', async () => {
    setup()

    const pack = await createPack(packDate)
    const goals = pack.puzzles.map((puzzle) => (puzzle as Puzzle<{ goal: number }>).data.goal)

    expect(goals.filter((goal) => goal <= 0)).toEqual([])
  })

  it('emits accepted solutions that all reach the stated goal', async () => {
    setup()

    const pack = await createPack(packDate)

    const evaluate = (expression: string): number => {
      const operands = expression.split(/[+\-*/]/).map(Number)
      const operators = [...expression.matchAll(/[+\-*/]/g)].map((match) => match[0])
      return operators.reduce((total, operator, index) => {
        const operand = operands[index + 1]
        return operator === '+'
          ? total + operand
          : operator === '-'
            ? total - operand
            : operator === '*'
              ? total * operand
              : total / operand
      }, operands[0])
    }

    const mismatched = pack.puzzles.flatMap((puzzle) => {
      const { acceptedSolutions, goal } = (puzzle as Puzzle<{ acceptedSolutions: string[]; goal: number }>).data
      return acceptedSolutions.filter((expression) => evaluate(expression) !== goal)
    })

    expect(mismatched).toEqual([])
  })
})
