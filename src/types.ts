export * from 'aws-lambda'

// Packs

// A UTC calendar date, YYYY-MM-DD. Never derived from a local-time Date.
export type PackDate = string

export type PuzzleType = 'gofigure' | 'missingvowels' | 'cryptogram' | 'themedanagrams' | 'crypticclue' | 'phrazle'

// Within-type: a 4 goFigure is hard for a goFigure and is not comparable to a 4 of another type.
export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface Puzzle<T = unknown> {
  // `${date}:${type}:${shortId}` -- opaque, never positional.
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

// What a type owes a pack. isComplete and missingDifficulties read these fields and nothing else,
// so this is all generators/index.ts exports about the model-backed types: data, no implementation.
export interface PackContribution {
  type: PuzzleType
  countPerDay: number
  // One target per puzzle; length === countPerDay. Neither failure direction is clearable at
  // runtime -- too few makes the pack permanently incomplete, too many over-ships -- so the
  // assertion over allContributions in __tests__/unit/generators/index.test.ts enforces it.
  difficulties: Difficulty[]
  // estimatedSeconds is BASE + PER x (difficulty - 1). Derived per type from its catalog range:
  // BASE is the low end, PER is (high - low) / 4. They sit here so a registry test can reach them.
  baseSeconds: number
  secondsPerDifficulty: number
  // The first UTC pack date this type applies to, a per-type literal rather than config, read by
  // appliesTo in services/packs.ts. Zero-padding is load-bearing and unchecked at runtime:
  // '2026-8-1' <= '2026-08-15' is false, so one unpadded literal makes its type apply to no date at
  // all, silently and forever. The format assertion in generators/index.test.ts holds it.
  availableFrom: PackDate
  // "Short by design", as distinct from "short because something broke". isComplete skips such a
  // contribution so it cannot hold the pack's `complete` flag down, that flag being the client's
  // refetch signal. It suppresses the alarm, never the attempt: missingDifficulties still asks and
  // hasWorkRemaining still counts it as owed, so a short day stays repairable.
  bestEffort?: boolean
}

export interface Generator<T = unknown> extends PackContribution {
  // True means no model call and a slowest generate() that reliably finishes well under a second;
  // false is the safe default for anything unmeasured. It also puts the generator's transitive
  // imports into GetPackByDateFunction, so a committed corpus costs module-eval on every cold start
  // whether or not it runs: measured by hand at 852,948 B of bundle and 85-170 ms of cold start.
  inRequest: boolean
  // Required even though only inRequest: true rows are summed: an optional number defaulting to 0
  // is a generator that costs nothing until someone flips its flag. Declare the smallest honest
  // integer -- an O(1) index declares 1, never 0.
  budgetMsPerPuzzle: number
  generate: (date: PackDate, difficulty: Difficulty) => Promise<Puzzle<T>>
}

// Hints
//
// Wire contract, and only for the types that ship hints: goFigure, Missing Vowels and Cryptic
// Clue. The other three build letter-shaped hints on the device, against a board no generator can
// enumerate in advance. `text` is the sentence, decided here and rendered verbatim -- a phrase
// rung's is model prose that passed the gates in utils/phrase-checks.ts -- and `metadata` is
// structure for the board, never a substitute for the sentence.

export interface Hint {
  text: string
  metadata?: HintMetadata
}

// Every member carries `kind`, valued `${PuzzleType}-${role}`, and restates its own rung's `text`
// without ever exceeding it, because a renderer that prints only hint.text must work on every
// type. Neither rule is enforceable by the type or by any test here -- an untagged member widens
// this union silently, and toHintLadder's discipline is what keeps goFigure structure off a phrase
// rung.
export type HintMetadata = GoFigureHintMetadata

// Wire contract. Ordered by the backend and not necessarily least to most revealing: render in
// arrival order and never sort or renumber. One to three rungs, with the lower bound in the type,
// so `ladder[0]` needs no guard while `ladder[2]` does and clients read `hints.length` rather than
// indexing blind. A type that ships no hints omits the `hints` key entirely -- an absent field
// rather than a short ladder, since there is no empty HintLadder.
export type HintLadder = [Hint, ...Hint[]]

// Declare no runtime value in this file. `export * from 'aws-lambda'` above is a types-only
// re-export, so every import here is erased at compile time; an exported `const` makes importers
// require types.ts for real and surfaces as a module-not-found at Lambda cold start, not at tsc.

// The internal phrase representation, deliberately not HintLadder: bare strings are what the model
// returns, what the prose gates read and what the dedupe compares. Wrapping happens once, at
// puzzle construction, through toHintLadder in utils/hints.ts.
export type PhraseHints = [string, string, string]

// What a hinted puzzle carries, which is not every type: three of the six ship no ladder. So a
// shell asks "does this puzzle have `hints`", never "which type is this", and absence is normal
// rather than a defect. MissingVowelsData and CrypticClueData extend this; GoFigureData conforms
// structurally, since GoFigureHintLadder is assignable to HintLadder.
export interface HintedPuzzleData {
  hints: HintLadder
}

// goFigure

export type Operator = '+' | '-' | '*' | '/'

export interface GoFigureData {
  goal: number
  bank: number[] // each digit used exactly once
  operators: Operator[] // reusable
  acceptedSolutions: string[] // e.g. "6+9+7*7"
  // Required, and no read site branches on its absence. Nothing rewrites a stored pack -- the table
  // is Retain, no role can delete from it, and createPack tops up rather than replaces -- so what
  // makes a non-optional field safe is the manual delete-and-rebuild runbook in endpoints.rest.
  hints: GoFigureHintLadder
}

// goFigure hints
//
// Three rungs, each naming one operator slot of one canonical tuple, always ending on the
// rightmost operator: with the goal known it fixes the last step arithmetically. Operators and
// never digits -- the whole tuple still leaves 24 arrangements to test, while digit positions
// collapse the permutation and leave all 64 tuples standing.

// 0-based operator index, left to right. Frozen at three because BANK_SIZE is 4; a different board
// size changes BANK_SIZE in generator.ts, OPERATOR_COUNT in hints.ts and this type together. They
// are deliberately unwired (generator.ts imports buildHints, so importing BANK_SIZE back is a
// cycle) and pickCanonical throws on the first puzzle generated if they drift.
export type OperatorSlot = 0 | 1 | 2

// The two facts a rung reveals, plus the HintMetadata tag. These fields determine the sentence but
// never compose it: `text` is authored in hints.ts and this rides alongside it.
export interface GoFigureHintMetadata {
  kind: 'gofigure-operator'
  // lull-ui renders the working expression as one joined string, so no cell index is useful here.
  slot: OperatorSlot
  // ASCII, matching Operator, never a board glyph: '/' ships as '/', not U+00F7. The rung's `text`
  // carries the same operator as a glyph (+ − × ÷) -- one alphabet for reading, one for the board.
  operator: Operator
}

// `metadata` narrowed to required, which is the whole reason this interface exists: a goFigure read
// site never has to narrow, while the ladder stays assignable to HintLadder for generic renderers.
export interface GoFigureHint extends Hint {
  metadata: GoFigureHintMetadata
}

// Exactly three, like HintLadder, and assignable to it.
export type GoFigureHintLadder = [GoFigureHint, GoFigureHint, GoFigureHint]

// Themed Anagrams

// answer and scrambles in one object, never parallel arrays: a skew there is a board showing word
// 3's scramble above word 2's answer.
export interface AnagramEntry {
  answer: string // uppercase A-Z, 6-9 letters, the word the player types
  // [0] is the board as it first appears, the rest are what the reshuffle control cycles through,
  // in order; every member is the same letter multiset and length as `answer`. SCRAMBLES_PER_ENTRY
  // is a ceiling, not a quota, so a short list is a normal return and a client reads the length.
  scrambles: [string, ...string[]]
}

// No `answer`: that means the one string the player types and this type has four, so the repeat
// unit is the THEME -- which is why utils/exclusions.ts reads themes and words through two narrowed
// readers rather than through answerOf. No `category` either, because the theme is always shown at
// every difficulty and hiding it turns a one-answer puzzle into a several-answer one.
//
// Render entries in wire order: the rungs lull-ui builds carry ordinals into this array, so a board
// that sorts entries by length breaks its own hints. There is no `hints` field, because which
// entries are still unsolved is a fact about a board four guesses have already changed.
export interface ThemedAnagramsData {
  entries: [AnagramEntry, AnagramEntry, AnagramEntry, AnagramEntry]
  theme: string
}

// Cryptic Clue

// Half-open [start, end) UTF-16 code-unit offsets into CrypticClueData.clue, computed in code and
// never returned by the model: one miscounted character ships a hint quoting the wrong words. The
// clue's charset is [A-Za-z ], so code unit, code point and grapheme coincide.
export interface ClueSpan {
  end: number
  start: number
}

// Closed here and never in the tool schema. The VerifiedClue union in verify.ts is discriminated on
// this, so a fourth device cannot be added without the compiler naming every site that handles it.
// All three are synonym devices: they work on a word the solver must supply, so the wordplay
// under-determines the answer and the definition is the cross-check. A literal-string device over
// characters already printed on the screen does not belong here -- its wordplay alone solves it.
export type CrypticDevice = 'charade' | 'deletion' | 'doubledefinition'

// Which letter a deletion removes. Closed because indicators.ts keys its committed lists on it, so
// a removal kind with no indicator family is a compile error rather than a clue nothing can signal.
// `middle` requires an odd-length source, enforced in verify.ts: HEARTH is six letters, so
// "heartless" could remove A (-> HERTH) or R (-> HEATH) and both read.
export type RemovalKind = 'first' | 'last' | 'middle'

// HintedPuzzleData, not PhrasePuzzleData: `answer` is a single English word, and this type is
// deliberately outside PHRASE_CORPUS_TYPES (utils/exclusions.ts), the set that decides the
// anti-repetition list -- holding AARDVARK there would ban the word from three other types for
// twenty nights.
//
// No span or `device` field on the wire, and none may come back: a charade's parts are several
// spans and CAR never appears in the clue (`Vehicle` does), a deletion's source word is absent
// from the clue, and a double definition has no wordplay half to point at. `definitionSpan` and
// `device` live on VerifiedClue for the band map and hint builder.
export interface CrypticClueData extends HintedPuzzleData {
  // The code-supplied shortlist word, uppercased -- never the model's spelling. nouns.ts entries
  // are single lowercase lemmas, so this is one token of 4-8 letters by construction.
  answer: string
  // Byte-identical to the string the verifier proved, so a clue needing a trim is rejected rather
  // than trimmed. No enumeration parenthetical: residue the cover tolerates is where a model hides
  // content.
  clue: string
  // Word lengths derived in code from `answer`, so the two cannot disagree. An array rather than a
  // number because changing a wire shape later costs the delete-and-rebuild runbook.
  enumeration: number[]
  // The post-solve reveal, and the only thing that explains a synonym device: CARPET being CAR
  // (vehicle) + PET (animal) is nowhere on the page. Composed in code from the decomposition the
  // verifier proved, then gated, then rendered verbatim -- it carries model-supplied strings, so it
  // takes a length bound and a content check before it ships. Unlike a gloss its failure drops the
  // candidate, which is why it is built in its own module rather than in the hint pool.
  explanation: string
}

// Phrase puzzles

// 5 = a general audience recognizes it instantly, 1 = obscure but fair. Set by the reviewer, never
// the generator, and defaulting to 3 when review did not run. Direction is easy to get backwards:
// high familiarity makes a Cryptogram easier.
export type Familiarity = 1 | 2 | 3 | 4 | 5

// What a phrase-derived puzzle carries on top; these fields are the phrase corpus's, not universal.
// `answer` means, once and everywhere, the one string the player types -- a multi-answer type does
// not set it. It does not decide membership of the anti-repetition list either: utils/exclusions.ts
// decides that from an explicit PHRASE_CORPUS_TYPES set.
//
// `category` is optional because difficulty hides it -- see generators/category-visibility.ts. It
// is omitted, never nulled: the pack is stored as JSON.stringify, so an absent key disappears from
// the payload entirely.
export interface PhrasePuzzleData {
  answer: string
  category?: string
}

// Missing Vowels

// The only phrase type that names HintedPuzzleData, because the shared prose rungs are semantic
// and recognizing a phrase from its meaning is what this player is doing.
export interface MissingVowelsData extends HintedPuzzleData, PhrasePuzzleData {
  displayed: string // respaced consonant string -- the spacing deliberately lies
}

// Cryptogram

// No `revealed` map: this type has no pre-filled letters. No `hints` either -- a player solving a
// substitution cipher one letter at a time gains nothing from a semantic nudge, so the replacement
// ranks the cipher letters they have not yet got right and runs on the device in lull-ui. The
// phrase still arrives with three prose hints, which this generator drops.
export interface CryptogramData extends PhrasePuzzleData {
  ciphertext: string
}

// Phrazle

// The same phrase in a third costume, so it adds no field of its own. An alias rather than an
// `extends` with an empty body, which is the same type carrying a lint error. No `hints`: a letter
// reveal fixed before the player exists cannot know what four guesses have already colored in, so
// the rungs are built on the device in lull-ui.
//
// No guess limit and no loss state -- this game is not losable -- and no sentinel field either: a
// `null` or `0` meaning "unlimited" is a limit field claiming to have no limit.
//
// `answer` ships the canonical form -- uppercase A-Z words separated by single spaces -- and is the
// only phrase-type answer that is not `phrase.text` verbatim, because the board marks tiles with
// markGuess, which works on canonical words. It is not a secret: a hash cannot color a tile, an
// encoding ships its own reversal in the same bundle, and either would make `answer` unreadable as
// a phrase and silently drop this type from the anti-repetition list.
//
// No `wordLengths`: it is splitPhrase(answer).map(w => w.length), and two fields that can disagree
// is a board with the wrong number of tiles.
export type PhrazleData = PhrasePuzzleData

// Client-side only: lull-api never reads or writes this, and defines the shape so a rules fix
// cannot be contradicted by state a client cached. Marks are derived, never stored -- markGuess's
// ordering may be corrected and src/rules/ has no cross-repo check, so a client caching tile colors
// would resume a board showing two colorings of one game. `solved` is not here; it lives in the
// shell's progress envelope and is derivable from this blob, so the two cannot disagree.
export interface PhrazleProgress {
  // In order, canonical form, valid guesses only: appended after isValidGuess returns true, so an
  // invalid guess never occupies an attempt. Raw keystrokes would make a resumed board depend on a
  // normalization rule that is allowed to change. Unbounded, because there is no guess limit.
  guesses: string[]
}

// Prompts

export type PromptId = string

export interface PromptConfig {
  anthropicVersion: string
  maxTokens: number
  model: string
  // Sent as output_config.effort, not as a thinking budget: budget_tokens is removed on Opus 5 and
  // returns a 400.
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
// Generated fresh for each pack build, consumed immediately, and never stored. Repetition across
// dates is handled by querying recent packs and handing their answers to the model as phrases not
// to use.

// Tagged by shape because consumers want different things from one call. Enforced by isUsable, per
// phrase, and never by the tool schema: an ajv constraint on an element fails the whole batch over
// one drifted phrase.
//
//   title   -- a recognizable title of a work. Missing Vowels' preferred shape.
//   idiom   -- a common saying or expression.
//   quote   -- a witty or aphoristic line. Cryptogram's preferred shape.
//   compact -- two or three short words sharing letters. Phrazle's preferred shape.
//
// A consumer prefers a shape and never requires one; requiring would make a call that came back
// light on a single tag produce zero puzzles of a type.
export type PhraseShape = 'compact' | 'idiom' | 'quote' | 'title'

export interface Phrase {
  text: string
  shape: PhraseShape
  // One label, the general kind of thing. A second, more specific label would duplicate rung 1 of
  // the ladder and squeeze the ladder into the narrow band between them.
  category: string
  // Bare strings, because this is what the model returned and what the prose gates read. The wrap
  // into { text } happens at puzzle construction.
  hints: PhraseHints
  familiarity: Familiarity
}

// A generator that needs a phrase to work from, kept separate because a self-contained generator
// runs inside a request while these need a model call first and only ever run in the async builder.
export interface PhraseGenerator<T = unknown> extends PackContribution {
  // Required, not optional: two phrase generators share one mutated pool, so a generator that
  // cannot say what it can use gets whatever the greedier one left.
  isUsablePhrase: (phrase: Phrase, difficulty: Difficulty) => boolean
  generate: (date: PackDate, difficulty: Difficulty, phrase: Phrase) => Promise<Puzzle<T>>
}

// One gated model draft plus the difficulties it can carry. The draft type never escapes: the
// selection loop reads `usableAt` and calls `build`, and sees nothing else.
export interface Candidate<TData = unknown> {
  // Non-empty; a draft usable at nothing is dropped at the gate rather than carried.
  usableAt: Difficulty[]
  build: (date: PackDate, difficulty: Difficulty) => Promise<Puzzle<TData>>
}

// A generator whose material comes from its own model call rather than the shared phrase batch.
// One call per type per pack, never one per puzzle. It has no inRequest field because a model type
// is off the request path by which list it is in -- modelContributions (data) or modelGenerators
// (implementations) -- not by a flag it sets.
//
// `recent` is the packs themselves, not a pre-flattened exclusion list, so each type applies its
// own narrowed reader: a type with two repeat units cannot flatten them into one string[] without
// making them indistinguishable to the dedupe. `origin` is the date being built, needed because
// `recent` is a window centered on it rather than the days before it.
//
// Candidate rather than a draft type parameter is a compiler fact: strictFunctionTypes checks
// function properties contravariantly, so a generator whose build() took the draft as an argument
// is not assignable into ModelGenerator[] (TS2322).
export interface ModelGenerator<TData = unknown> extends PackContribution {
  fetchCandidates: (count: number, recent: { puzzles: Puzzle[] }[], origin: PackDate) => Promise<Candidate<TData>[]>
}
