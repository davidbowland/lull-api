export * from 'aws-lambda'

// Packs

// A UTC calendar date, YYYY-MM-DD. Never derived from a local-time Date.
export type PackDate = string

export type PuzzleType = 'gofigure'

// Within-type: a 4 goFigure is hard for a goFigure and is not comparable to a 4 of another type.
export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface Puzzle<T = unknown> {
  // `${date}:${type}:${shortId}` -- opaque, never positional. Difficulty is a generation input,
  // passed in; identity is an address, generated once.
  id: string
  type: PuzzleType
  difficulty: Difficulty
  estimatedSeconds: number
  data: T
}

export interface Pack {
  date: PackDate
  complete: boolean
  puzzles: Puzzle[]
}

// Generators

export interface Generator<T = unknown> {
  type: PuzzleType
  countPerDay: number
  // One target per puzzle; length === countPerDay
  difficulties: Difficulty[]
  // Graded per type, and NOT implied by any other property. Making no model call is necessary but
  // not sufficient: a generator that enumerates every path or brute-forces every assignment is
  // model-free and still far too slow. True means no model call AND a slowest generate() that
  // reliably finishes in well under a second. False is the safe default for anything unmeasured.
  inRequest: boolean
  generate: (date: PackDate, difficulty: Difficulty) => Promise<Puzzle<T>>
}

// goFigure

export type Operator = '+' | '-' | '*' | '/'

export interface GoFigureData {
  goal: number
  bank: number[] // each digit used exactly once
  operators: Operator[] // reusable
  acceptedSolutions: string[] // e.g. "6+9+7*7"
}
