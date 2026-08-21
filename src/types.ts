export * from 'aws-lambda'

// Packs

// A UTC calendar date, YYYY-MM-DD. Never derived from a local-time Date.
export type PackDate = string

export type PuzzleType = 'gofigure' | 'missingvowels' | 'cryptogram'

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
  // Every distinct operator arrangement that reaches the goal, deduplicated and sorted by raw ASCII.
  // Derivable from acceptedSolutions by stripping the digits, and shipped anyway: that strip is only
  // correct because bank digits are 1-9 and every operand is therefore one character, and sending
  // the list keeps that assumption in this repo instead of in lull-ui.
  //
  // What the client does with it is hedge the hint copy. `operatorTuples.length > 1` means more than
  // one arrangement wins, so a rung must read "One winning answer has ..." rather than asserting a
  // uniqueness that does not hold. It is exactly equivalent to "difficulty is 1-3" -- see
  // difficultyForSolution, whose first branch IS the one-tuple test -- but it says so in data the
  // client can read, rather than making it copy a difficulty table.
  operatorTuples: Operator[][]
  // REQUIRED. Every pack is wiped and rebuilt on deploy, so there is no puzzle in the table without
  // it and no reason for a read site to branch.
  hints: GoFigureHintLadder
}

// goFigure hints
//
// Three rungs, each naming one operator slot of ONE canonical operator tuple. The ladder always
// ENDS on the rightmost operator, which is the strongest reveal -- with the goal known it fixes the
// last step arithmetically, and on a * or / it names the final digit too. The first two rungs are
// ordered by difficulty, and on difficulties 4 and 5 that order is deliberately NOT
// least-to-most-revealing. Operators and never digits: revealing the whole tuple leaves the player
// at most 24 arrangements to test and all the arithmetic to do, while revealing digit positions
// collapses the permutation outright and leaves all 64 tuples standing.

// 0-based operator index, left to right. Frozen at three because BANK_SIZE is 4. goFigure has never
// had another board size; if it ever does, three places change together -- BANK_SIZE in
// generator.ts, OPERATOR_COUNT in hints.ts, and this type. They are deliberately NOT wired to each
// other. BANK_SIZE stays unexported and hints.ts declares its own copy, because generator.ts
// imports buildHints -- so importing BANK_SIZE back would be a genuine cycle, and under the CJS
// interop Jest runs, a module-scope `BANK_SIZE - 1` evaluates to NaN whenever generator.ts loads
// first. canonicalTuple's throw is what catches the drift instead: it fires on the first puzzle
// generated, in the right file, with the real number in the message.
export type OperatorSlot = 0 | 1 | 2

// The two facts a rung reveals, and nothing derived from them. There is no `kind` discriminator: the
// presence of `operator` is what says this is an operator rung, so the rejected elimination rung
// would join as a structurally distinct member of the GoFigureHint union rather than as a new value
// of a tag. There is no `text` either -- lull-ui composes the sentence, which is the one place a
// deliberate exception is made to "the backend decides; the UI displays", on the grounds that this
// is wording rather than rule. The rule half stays here: which slot each rung reveals, and in what
// order, is decided by slotOrder in hints.ts and carried by the ladder's ORDER.
//
// The sentence lull-ui builds from these, for the record, since nothing here can enforce it:
//
//   hedged (operatorTuples.length > 1, i.e. difficulty 1-3)
//     rung 1     One winning answer has "×" as its 1st operator.
//     rungs 2-3  The same answer has "+" as its 2nd operator.
//   unhedged (one tuple, i.e. difficulty 4-5)
//     every rung The 2nd operator from the left is "×".
//
// "From the left" is load-bearing in the unhedged band and must not be dropped. The hint bar renders
// opened rungs into an ordered, decimal-marked list, and that band's slots come out 1, 0, 2 -- so
// rung 1 would otherwise read "1. The 2nd operator is ×", two numbering systems disagreeing on one
// line. The hedged band needs no anchor: its ordinal hangs off "its", and its slots run 0, 1, 2 so
// marker and ordinal agree. That pairing is not luck -- the 1, 0, 2 order and the unhedged copy are
// both the one-tuple case -- but it does couple SLOT_ORDER_BY_DIFFICULTY to copy in another repo.
export interface GoFigureOperatorHint {
  // What the board does with this is the board's business. No cell index and no row arithmetic --
  // lull-ui renders the working expression as one joined string and has no per-token cell.
  slot: OperatorSlot
  // ASCII, matching Operator, and never a board glyph: '/' ships as '/', not as U+00F7. The glyph
  // mapping is lull-ui's OPERATOR_SYMBOLS.
  operator: Operator
}

export type GoFigureHint = GoFigureOperatorHint

// Exactly three, like HintLadder -- but never HintLadder itself, which is three strings and belongs
// to PhrasePuzzleData. goFigure is not a phrase puzzle.
export type GoFigureHintLadder = [GoFigureHint, GoFigureHint, GoFigureHint]

// Phrase puzzles

// Exactly three, ordered least to most revealing. The count is checked once, at the parse boundary
// in phrase-checks; the tuple carries that guarantee to every read site downstream.
export type HintLadder = [string, string, string]

// 5 = a general audience recognizes it instantly, 1 = obscure but fair. Set by the REVIEWER, never
// by the generator: a generator asked to rate its own output is grading its own work. Defaults to 3
// when review did not run.
//
// Direction matters and is easy to get backwards: high familiarity makes a Cryptogram EASIER.
export type Familiarity = 1 | 2 | 3 | 4 | 5

// What every phrase-derived puzzle carries, so the UI shell can find hints without knowing the
// type. `category` is optional because difficulty hides it.
//
// `answer` lives HERE rather than on each type. create-phrase-puzzles.ts builds the anti-repetition
// list by reading it off every puzzle in the last 20 days without knowing what type they are; a
// type that stored its answer under a different name would be invisible to that list, and every one
// of its phrases would be free to be served again the next day.
export interface PhrasePuzzleData {
  answer: string
  category?: string
  hints: HintLadder
}

// Missing Vowels

export interface MissingVowelsData extends PhrasePuzzleData {
  displayed: string // respaced consonant string -- the spacing deliberately lies
}

// Cryptogram

// No `revealed` map: the system design sketches one for pre-filled letters and Cryptogram has none.
export interface CryptogramData extends PhrasePuzzleData {
  ciphertext: string
}

// Prompts

export type PromptId = string

export interface PromptConfig {
  anthropicVersion: string
  maxTokens: number
  model: string
  // Widened from connections-api's copy, which predates xhigh. Sent as output_config.effort, not
  // as a thinking budget: budget_tokens is removed on Opus 5 and returns a 400.
  thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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

// Phrases
//
// Generated fresh for each pack build, consumed immediately, and never stored. An earlier design
// persisted a nightly corpus in its own table with a used-id set, a TTL lock, and a fallback to
// the most recent stored corpus. All of that existed to stop many dates repeating each other out
// of ONE shared list -- which stops being a problem when every build generates its own phrases
// from its own random seed. What replaced it is smaller and reads better: recent packs are queried
// and their answers handed to the model as phrases not to use.

// Tagged by shape because the consumers want different things from one call. The tool schema
// requires the tag and ajv rejects a response missing it.
//
//   title   -- a recognizable title of a work. Missing Vowels' preferred shape.
//   idiom   -- a common saying or expression.
//   quote   -- a witty or aphoristic line. Cryptogram's preferred shape.
//   compact -- two or three short words sharing letters. Phrazle's preferred shape.
//
// A consumer PREFERS a shape; it does not require one. Requiring one would make a call that came
// back light on a single tag produce zero puzzles of a type.
export type PhraseShape = 'compact' | 'idiom' | 'quote' | 'title'

export interface Phrase {
  text: string
  shape: PhraseShape
  // ONE label -- the general kind of thing. Rung 1 of the ladder is what the old `categorySpecific`
  // used to be, so keeping both would squeeze the ladder into the narrow band between them and make
  // rung 1 duplicate whatever is already on screen.
  category: string
  hints: HintLadder
  familiarity: Familiarity
}

// A generator that needs a phrase to work from. Kept separate from Generator because the
// difference is structural rather than incidental: a self-contained generator runs inside a
// request, while these need a model call first and so only ever run in the async builder.
export interface PhraseGenerator<T = unknown> {
  type: PuzzleType
  countPerDay: number
  difficulties: Difficulty[]
  // REQUIRED, not optional. Two phrase generators share one mutated pool, so a generator that
  // cannot say what it can use gets whatever the greedier one left -- and an optional predicate
  // defaulting to "yes" is exactly the silent version of that bug.
  isUsablePhrase: (phrase: Phrase, difficulty: Difficulty) => boolean
  generate: (date: PackDate, difficulty: Difficulty, phrase: Phrase) => Promise<Puzzle<T>>
}
