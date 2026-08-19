/* eslint sort-keys:0 */
import { Corpus, CorpusEntry, GoFigureData, MissingVowelsData, Pack, PackDate, Puzzle } from '@types'

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

// Corpus

// The catalog's own worked example, so the fixture and the specification cannot drift apart.
export const corpusEntry: CorpusEntry = {
  id: 'f8c8a0b1',
  text: 'The Empire Strikes Back',
  shape: 'title',
  categorySpecific: 'Star Wars film',
  categoryBroad: 'Film',
}

// Deliberately spans all four shapes and a range of lengths. Missing Vowels prefers `title` but
// must still produce puzzles from a corpus holding none, which several tests rely on.
export const corpusEntries: CorpusEntry[] = [
  corpusEntry,
  {
    id: 'a1b2c3d4',
    text: 'Time flies like an arrow',
    shape: 'idiom',
    categorySpecific: 'Saying about time',
    categoryBroad: 'Saying',
  },
  {
    id: 'b2c3d4e5',
    text: 'To be or not to be',
    shape: 'quote',
    categorySpecific: 'Hamlet soliloquy',
    categoryBroad: 'Quote',
  },
  {
    id: 'c3d4e5f6',
    text: 'Toe hold',
    shape: 'compact',
    categorySpecific: 'Wrestling move',
    categoryBroad: 'Sport',
  },
  {
    id: 'd4e5f6a7',
    text: 'Raiders of the Lost Ark',
    shape: 'title',
    categorySpecific: 'Indiana Jones film',
    categoryBroad: 'Film',
  },
]

export const corpus: Corpus = {
  date: packDate,
  entries: corpusEntries,
  usedIds: [],
}

export const missingVowelsPuzzle: Puzzle<MissingVowelsData> = {
  id: '2026-06-15:missingvowels:9f8e7d6c',
  type: 'missingvowels',
  difficulty: 3,
  estimatedSeconds: 90,
  data: {
    category: 'Film',
    displayed: 'THMP RSTR KSBCK',
    answer: 'The Empire Strikes Back',
  },
}
