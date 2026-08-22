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

// Hints
//
// ONE shape on the wire for every puzzle type. `text` is the sentence, DECIDED HERE and rendered
// verbatim; `metadata` is machine-readable structure for the board and never a substitute for the
// sentence.
//
// "Decided" rather than "authored", because only goFigure's is written here -- textFor builds it
// from templates. A phrase rung's text is model prose that reached the wire by passing the gates in
// utils/phrase-checks.ts (blocklist, answer-leak, length, no control or format codes). Telling every
// client to render it verbatim is what makes those gates load-bearing. Before this existed, phrase puzzles shipped three plain strings and goFigure shipped
// three objects, so a shared renderer typed on one of them printed [object Object] three times
// against the other -- a split that had to be warned about in five separate files.
//
// `metadata` is OPTIONAL here and required on the per-type narrowings below. That is what lets a
// shared renderer typed on HintLadder read `hint.metadata` without a type error while a goFigure
// consumer never has to narrow.

export interface Hint {
  text: string
  metadata?: HintMetadata
}

// A union of one today, because goFigure is the only type with structure a board can act on.
//
// UNTAGGED, and NOTHING WILL TELL YOU when that starts to matter. An earlier version of this comment
// claimed `hint.metadata.slot` would stop compiling the day a second member arrived; that is false,
// and the compiler says so. GoFigureHint.metadata is typed `GoFigureHintMetadata` directly, not
// `HintMetadata`, so widening this union leaves every goFigure read site compiling clean. Nor is
// there a generic read to break: no code in src/ or scripts/ reads `Hint.metadata` at all -- the
// only occurrences are these declarations and the one write in gofigure/hints.ts.
//
// So the second member must arrive WITH a discriminant, and adding it is a manual discipline that no
// test and no type will enforce. Adding one now would be a tag nothing reads; the trade is
// deliberate, but it is a trade, not a safety property.
//
// The optional field also cannot keep goFigure structure OFF a phrase rung: `{ text, metadata }`
// satisfies `Hint`, so a cryptogram ladder carrying operator metadata typechecks. Only
// toHintLadder's discipline stops that, not the type.
export type HintMetadata = GoFigureHintMetadata

// Exactly three. ORDERED BY THE BACKEND, and NOT necessarily least to most revealing -- render them
// in the order they arrive and do not sort or renumber. Phrase ladders do run least to most
// revealing, but a goFigure ladder with a unique operator tuple deliberately does not: it spends
// rung 1 on op2, so its slots come out 1, 0, 2. This type is the wire shape for every puzzle type,
// so a promise true of only one of them does not belong on it.
//
// For phrase puzzles the count is checked once, at the parse boundary in phrase-checks; the tuple
// carries that guarantee to every read site downstream.
export type HintLadder = [Hint, Hint, Hint]

// The INTERNAL phrase representation, and deliberately not HintLadder. Three bare strings is what
// the model returns, what the prose gates in phrase-checks read, and what the dedupe compares --
// wrapping happens once, at puzzle construction, through toHintLadder in utils/hints.ts. Keeping
// the two named apart is what stops a gate quietly running over objects and passing everything.
export type PhraseHints = [string, string, string]

// goFigure

export type Operator = '+' | '-' | '*' | '/'

export interface GoFigureData {
  goal: number
  bank: number[] // each digit used exactly once
  operators: Operator[] // reusable
  acceptedSolutions: string[] // e.g. "6+9+7*7"
  // REQUIRED, and no read site branches on its absence.
  //
  // Packs are NOT wiped on deploy, whatever an earlier version of this comment claimed.
  // template.yaml:417-418 sets DeletionPolicy and UpdateReplacePolicy to Retain, the Lambda's IAM
  // policy grants no delete action, and createPack TOPS UP rather than replaces
  // (services/packs.ts:266) -- so a pack written before a shape change keeps its old puzzles
  // indefinitely and nothing in this repo will ever rewrite it. What makes this field safe to
  // declare non-optional is the MANUAL runbook at endpoints.rest:188-198, run before release:
  // delete every pack item by hand, deploy, re-bootstrap today and tomorrow, then fetch each live
  // date and check the shape. Skip it and the guarantee is a lie at runtime.
  hints: GoFigureHintLadder
}

// goFigure hints
//
// Three rungs, each naming one operator slot of ONE canonical operator tuple. The ladder always
// ENDS on the rightmost operator, which is the strongest reveal -- with the goal known it fixes the
// last step arithmetically, and on a * or / it names the final digit too. The first two rungs are
// ordered on whether the puzzle has ONE operator tuple or several, and on the one-tuple puzzles that
// order is deliberately NOT least-to-most-revealing. Operators and never digits: revealing the whole
// tuple leaves the player at most 24 arrangements to test and all the arithmetic to do, while
// revealing digit positions collapses the permutation outright and leaves all 64 tuples standing.

// 0-based operator index, left to right. Frozen at three because BANK_SIZE is 4. goFigure has never
// had another board size; if it ever does, three places change together -- BANK_SIZE in
// generator.ts, OPERATOR_COUNT in hints.ts, and this type. They are deliberately NOT wired to each
// other. BANK_SIZE stays unexported and hints.ts declares its own copy, because generator.ts
// imports buildHints -- so importing BANK_SIZE back would be a genuine cycle, and under the CJS
// interop Jest runs, a module-scope `BANK_SIZE - 1` evaluates to NaN whenever generator.ts loads
// first. pickCanonical's throw is what catches the drift instead: it fires on the first puzzle
// generated, in the right file, with the real number in the message.
export type OperatorSlot = 0 | 1 | 2

// The two facts a rung reveals, and nothing derived from them. There is no `kind` discriminator: the
// presence of `operator` is what says this is an operator rung, so the rejected elimination rung
// would join as a structurally distinct member of the HintMetadata union rather than as a new value
// of a tag.
//
// A PREVIOUS VERSION OF THIS TYPE HAD NO `text`, on the grounds that lull-ui could compose the
// sentence from these two fields and that wording is not rule. That was the one deliberate exception
// made to "the backend decides; the UI displays", and it is REVERSED. Text is authored here again,
// in hints.ts, and this structure rides alongside it as `metadata`. CLAUDE.md now carries the rule
// ("Every hint on the wire is { text, metadata? }") so the exception is not reintroduced by someone
// noticing that these two fields determine the sentence.
export interface GoFigureHintMetadata {
  // What the board does with this is the board's business. No cell index and no row arithmetic --
  // lull-ui renders the working expression as one joined string and has no per-token cell.
  slot: OperatorSlot
  // ASCII, matching Operator, and never a board glyph: '/' ships as '/', not as U+00F7. The SAME
  // operator appears in the rung's `text` as a board glyph (+ − × ÷) and here as ASCII, in two
  // different alphabets, deliberately -- one is for reading, one is for the board.
  operator: Operator
}

// `metadata` narrowed from optional to REQUIRED, which is the whole reason this interface exists: a
// goFigure read site never has to narrow, while GoFigureHintLadder stays structurally assignable to
// HintLadder for anything rendering hints generically.
export interface GoFigureHint extends Hint {
  metadata: GoFigureHintMetadata
}

// Exactly three, like HintLadder, and assignable to it.
export type GoFigureHintLadder = [GoFigureHint, GoFigureHint, GoFigureHint]

// Phrase puzzles

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
  // PhraseHints, not HintLadder: a Phrase is what the model returned and what the prose gates read,
  // and both work on bare strings. The wrap into { text } happens at puzzle construction.
  hints: PhraseHints
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
