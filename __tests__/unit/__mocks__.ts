/* eslint sort-keys:0 */
import { GoFigureData, Pack, PackDate, Puzzle } from '@types'

export const packDate: PackDate = '2026-06-15'

export const goFigurePuzzle: Puzzle<GoFigureData> = {
  id: '2026-06-15:gofigure:abc123de',
  type: 'gofigure',
  difficulty: 3,
  estimatedSeconds: 120,
  data: {
    goal: 154,
    bank: [6, 9, 7, 7],
    operators: ['+', '-', '*', '/'],
    acceptedSolutions: ['6+9+7*7', '9+6+7*7'],
  },
}

export const pack: Pack = {
  date: packDate,
  complete: true,
  puzzles: [goFigurePuzzle],
}
