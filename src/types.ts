export * from 'aws-lambda'

// Packs

// A UTC calendar date, YYYY-MM-DD. Never derived from a local-time Date.
export type PackDate = string

export type PuzzleType = 'gofigure' | 'missingvowels'

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

// Missing Vowels

export interface MissingVowelsData {
  category: string
  displayed: string // respaced consonant string -- the spacing deliberately lies
  answer: string
}

// Prompts

export type PromptId = string

export interface PromptConfig {
  anthropicVersion: string
  maxTokens: number
  model: string
  thinkingEffort: 'low' | 'medium' | 'high' | 'max'
}

export interface Prompt {
  config: PromptConfig
  contents: string
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, any>
}

// Phrase corpus

// Tagged by shape because the three consumers want different things, and one nightly call feeds
// all of them. The tool schema requires this and ajv rejects a response missing it, so a model
// that returns untagged phrases fails validation rather than silently filling the corpus with
// entries no consumer can use.
//
//   title   -- a recognizable title of a work. Missing Vowels' preferred shape.
//   idiom   -- a common saying or expression.
//   quote   -- a witty or aphoristic line. Cryptogram's preferred shape.
//   compact -- two or three short words sharing letters. Phrazle's preferred shape.
//
// A consumer PREFERS a shape; it does not require one. Requiring one would make a night that came
// back light on a single tag produce zero puzzles of a type, which is the outcome the corpus
// fallback exists to prevent.
export type PhraseShape = 'compact' | 'idiom' | 'quote' | 'title'

export interface CorpusEntry {
  // Derived from the normalized text, so the same phrase carries the same id across nights. That
  // is what lets usedIds stay meaningful when a later corpus repeats an earlier phrase.
  id: string
  text: string
  shape: PhraseShape
  // Two labels at different specificities, both supplied by the model. Missing Vowels' difficulty
  // dial picks between them: the specific label is a bigger hint than the broad one, so an easy
  // puzzle shows "Star Wars film" where a hard one shows "Film".
  categorySpecific: string
  categoryBroad: string
}

export interface Corpus {
  date: PackDate
  entries: CorpusEntry[]
  // Ids already consumed by some pack. Only load-bearing on the fallback path, where one corpus
  // serves several dates because a later night's model call failed.
  usedIds: string[]
}
