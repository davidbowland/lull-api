/* eslint sort-keys:0 */
import { GoFigureData, Pack, PackDate, Puzzle } from '@types'

export const packDate: PackDate = '2026-06-15'

export const goFigurePuzzle: Puzzle<GoFigureData> = {
  id: '2026-06-15:gofigure:abc123de',
  type: 'gofigure',
  // Matches what the real generator produces for this bank and goal: one operator tuple across
  // six orderings, which difficultyForSolution rates 4. An earlier fixture said difficulty 3 with
  // two solutions -- a shape the code cannot emit, sitting in the shared mock for the canonical
  // example of this type.
  difficulty: 4,
  estimatedSeconds: 150,
  data: {
    goal: 154,
    bank: [6, 9, 7, 7],
    operators: ['+', '-', '*', '/'],
    acceptedSolutions: ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7'],
  },
}

export const pack: Pack = {
  date: packDate,
  complete: true,
  puzzles: [goFigurePuzzle],
}
