export * from 'aws-lambda'

// Packs

// A UTC calendar date, YYYY-MM-DD. Never derived from a local-time Date.
export type PackDate = string

export type PuzzleType = 'gofigure' | 'missingvowels' | 'cryptogram' | 'themedanagrams' | 'crypticclue' | 'phrazle'

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

// What a type owes a pack, and the ONLY thing the request path needs to know about a generator it
// cannot run. isComplete and missingDifficulties read these fields and nothing else, so this is what
// generators/index.ts exports about the model-backed types -- data, never an implementation.
export interface PackContribution {
  type: PuzzleType
  countPerDay: number
  // One target per puzzle; length === countPerDay. The TYPE cannot carry this -- Difficulty[] holds
  // no length relation to a sibling field -- so what enforces it is the assertion over
  // allContributions in __tests__/unit/generators/index.test.ts, named here so the next reader knows
  // where it is. The test exists because neither failure direction is clearable at runtime:
  // missingDifficulties generates only declared difficulties and isComplete demands countPerDay of
  // them, so declaring FEWER difficulties than countPerDay makes the pack permanently incomplete
  // with no code path able to fix it, and declaring MORE over-ships. Without the test both land at
  // 03:33; with it, they land at `npm test`.
  difficulties: Difficulty[]
  // The two constants estimatedSeconds is computed from: BASE + PER x (difficulty - 1). They live
  // HERE rather than as module constants inside each generator, and that move is not a tidy-up. The
  // generator is not their only reader: a pack-duration ceiling is the one product number in this
  // design that somebody signs off on, and while it was a module constant inside a generate() it was
  // unwritable. A model-backed contribution has no generate() at all -- its estimatedSeconds is set
  // after a live Bedrock call -- and the registry may not import a model implementation, so a test
  // over the registry can reach these numbers by no other route than the contribution.
  //
  // Derived per type from its catalog range: BASE is the range's low end, PER is (high - low) / 4,
  // so difficulty 5 lands exactly on the high end.
  //
  // ON THE CONTRIBUTION AND READ BY NOTHING NEW YET, like availableFrom and bestEffort below. Their
  // only readers today are the three generate() implementations, which is where they were read from
  // before this field existed; the ceiling that would sum them across the registry does not exist
  // yet. What the move bought is reachability, not a reader -- and that is exactly why the field is
  // declared before the test that needs it.
  baseSeconds: number
  secondsPerDifficulty: number
  // The first UTC pack date this type applies to. Both bounds are YYYY-MM-DD, so a lexical
  // comparison is a chronological one. A LITERAL per type -- the date that TYPE shipped -- never
  // read from config.ts: wiring it to an env var would make a code fact into a deploy fact.
  //
  // READ BY appliesTo in services/packs.ts, which gates missingDifficulties, isComplete and
  // hasWorkRemaining alike -- so a type is not generated for, not demanded of, and not attempted on
  // any date before it.
  //
  // ZERO-PADDING IS LOAD-BEARING and nothing at runtime checks it: '2026-8-1' <= '2026-08-15' is
  // FALSE, so one unpadded literal makes its type apply to no date at all, silently and forever,
  // with no error and no log line on any date. What holds it is the format assertion over
  // allContributions in __tests__/unit/generators/index.test.ts.
  availableFrom: PackDate
  // "Short by design", as distinct from "short because something broke". isComplete SKIPS a
  // best-effort contribution entirely: a type that cannot promise countPerDay every night must not
  // be able to hold the pack's `complete` flag down, because that flag is the client's refetch
  // signal and the incomplete-pack logError is the only alarm this stack has. A best-effort type
  // that produces nothing still logs its own per-type ERROR; what it does not do is convert the
  // pack-level alarm into noise and every archived pack into a permanent refetch.
  //
  // IT SUPPRESSES THE ALARM, NEVER THE ATTEMPT, and keeping those two apart is why there are two
  // predicates rather than one. missingDifficulties still asks for a best-effort type, and
  // hasWorkRemaining -- the only question that may gate an async builder invocation -- still counts
  // it as owed. Asked through `complete` instead, this flag would mean "never attempted after the
  // first pass": a date whose only gap is the best-effort type reads complete, so no builder is ever
  // invoked for it and the retry that exists to repair a short day cannot reach it.
  //
  // Default false, and it is a claim a type's spec must ARGUE for rather than a convenience.
  bestEffort?: boolean
}

export interface Generator<T = unknown> extends PackContribution {
  // Graded per type, and NOT implied by any other property. Making no model call is necessary but
  // not sufficient: a generator that enumerates every path or brute-forces every assignment is
  // model-free and still far too slow. True means no model call AND a slowest generate() that
  // reliably finishes in well under a second. False is the safe default for anything unmeasured.
  //
  // And the criterion measures generate() and nothing else, which is not the whole cost: inRequest
  // true also puts the generator's whole transitive import graph into GetPackByDateFunction, so a
  // generator with a committed corpus pays module-eval on every cold start whether or not it runs --
  // measured at 852,948 B of added bundle, 85-170 ms of Lambda cold start and +46.7 MB RSS for one
  // module-scope lexical index, multiplied by eight because usePrefetch walks eight dates. A
  // generator that needs a lexical oracle at runtime is inRequest: false by that fact alone, no
  // measurement required. Flipping any generator to true therefore costs THREE numbers rather than
  // one -- generate()'s worst case, the added bundle bytes, and the added cold start -- and all
  // three above were taken by hand. `npm run benchmark-generators` now re-takes the FIRST of them
  // and only the first: module-eval cost cannot be measured from inside a process that has already
  // evaluated the module, and a bundle delta is not a runtime reading at all. So quote the method
  // with the number whenever one changes -- two of the three still have no script behind them.
  inRequest: boolean
  // Beside it. REQUIRED rather than optional even though only inRequest: true rows are summed,
  // because an optional number defaulting to 0 is a generator that costs nothing until someone flips
  // its flag. An inRequest: false generator declares the measurement it would have to BEAT -- an
  // O(1) index into a committed list declares 1, never 0 -- and the day it is promoted the budget
  // assertion already has its number. Declare the smallest honest integer, never zero. It is on
  // Generator and not on PackContribution because inRequest is, and a PhraseGenerator or a
  // ModelGenerator never runs on the request path at all.
  budgetMsPerPuzzle: number
  generate: (date: PackDate, difficulty: Difficulty) => Promise<Puzzle<T>>
}

// Hints
//
// ONE shape on the wire for every type that ships them, which since 2026-08-31 is HALF the catalog
// rather than all of it -- goFigure, Missing Vowels and Cryptic Clue. Cryptogram, Phrazle and Themed
// Anagrams ship none; their hints are letter-shaped, computed on the device from src/rules/ against a
// board no generator can enumerate in advance, and nothing below describes them. `text` is the
// sentence, DECIDED HERE and rendered verbatim; `metadata` is machine-readable structure for the
// board and never a substitute for the sentence.
//
// "Decided" rather than "authored", because only goFigure's is written here -- textFor builds it
// from templates. A phrase rung's text is model prose that reached the wire by passing the gates in
// utils/phrase-checks.ts (blocklist, answer-leak, length, no control or format codes). Telling every
// client to render it verbatim is what makes those gates load-bearing. Before this existed, phrase puzzles shipped three plain strings and goFigure shipped
// three objects, so a shared renderer typed on one of them printed [object Object] three times
// against the other -- a split that had to be warned about in five separate files.
//
// `metadata` is OPTIONAL here and REQUIRED on the one per-type narrowing below, GoFigureHint. That
// is what lets a shared renderer typed on HintLadder read `hint.metadata` without a type error while
// a goFigure consumer never has to narrow. There were three such narrowings; the other two left with
// their types' ladders.

export interface Hint {
  text: string
  metadata?: HintMetadata
}

// TAGGED, AND BACK TO A UNION OF ONE. Every member carries `kind`, and its value is
// `${PuzzleType}-${role}` with the type segment the PuzzleType literal verbatim -- so
// `gofigure-operator`, the only member left.
//
// IT REACHED THREE AND CAME BACK. Themed Anagrams contributed { entryIndex, reveal } and Phrazle
// { wordIndex, position, letter }, and both left with the ladders that carried them when Cryptogram,
// Phrazle and Themed Anagrams stopped shipping `hints` on the wire at all -- their hints are now
// letter-shaped, chosen on the device against a board the generator cannot see, and built from
// src/rules/ rather than sent.
//
// SO THE DISCRIMINANT NARROWS NOTHING AGAIN, and that is worth saying plainly rather than leaving
// the reader to notice. The case for tagging was made on two arms arriving at once -- "a `kind` on
// one arm narrows nothing and on two it narrows both" -- and with one arm the compiler is back where
// it started: `metadata` typed as this union is already GoFigureHintMetadata, and there is nothing
// to discriminate.
//
// IT STAYS ANYWAY, and not out of deference to work already done. The tag is a NAMING RULE first and
// a compiler feature second, and the naming rule is what stops the drift that produced three
// separate proposals -- 'gofigure', 'operator', 'gofigure-operator' -- for this one member. Dropping
// it would cost a wire change on the one type whose `metadata` is REQUIRED and whose read sites do
// not branch on its absence, and would buy back nothing: the next type to add metadata would
// re-litigate the naming from nothing and pay the same widening again. It inherits the convention
// instead, and the narrowing arrives with it on the day it lands.
//
// A NEW MEMBER ARRIVES WITH ITS OWN `kind`, and NOTHING MAKES IT -- not the type, and not any test.
// A member declared without a tag widens this union just as quietly as before, because the union is
// what would have to be checked and a bare `A | B` has no shape to violate.
//
// NO TEST CATCHES IT EITHER, and it is worth being exact about why, because a golden ladder looks
// like it would. goFigure pins its ladder with toEqual against what its builder emits --
// __tests__/unit/generators/gofigure/hints.test.ts, over the fixture in __tests__/unit/__mocks__.ts.
// That catches DRIFT BETWEEN A BUILDER AND ITS FIXTURE: one side losing `kind`, or carrying a wrong
// one. Every case it catches is a regression on a member that is ALREADY TAGGED. It cannot catch a
// member arriving untagged, because that type's fixture and its builder are written by the same hand
// in the same commit and agree with each other perfectly -- toEqual passes on two untagged ladders.
// Both halves were run before this sentence was written: dropping `kind` from buildHints alone fails
// that assertion, and dropping it from the builder and the fixture together passes it.
//
// So this convention is held by REVIEW and by nothing else. tsconfig.json excludes __tests__/, so
// the annotations there are checked by nothing at CI time either, and no script, CI step or smoke
// check inspects `kind` anywhere in this repo.
//
// ONE RULE ON THE UNION, and it survives the shrink: `metadata` is a machine-readable RESTATEMENT of
// its own rung's `text`, never a superset. A renderer that prints only hint.text must work on every
// type, and a metadata field revealing more than its rung silently breaks that.
//
// The optional field on Hint also cannot keep goFigure structure OFF a phrase rung:
// `{ text, metadata }` satisfies `Hint`, so a missing vowels ladder carrying operator metadata
// typechecks. Only toHintLadder's discipline stops that, not the type.
export type HintMetadata = GoFigureHintMetadata

// ORDERED BY THE BACKEND, and NOT necessarily least to most revealing -- render them in the order
// they arrive and do not sort or renumber. The prose ladder Missing Vowels ships does run least to
// most revealing, but a goFigure ladder with a unique operator tuple deliberately does not: it
// spends rung 1 on op2, so its slots come out 1, 0, 2. This type is the wire shape for every type
// that ships hints at all, so a promise true of only one of them does not belong on it.
//
// For phrase puzzles the count is checked once, at the parse boundary in phrase-checks; the tuple
// carries that guarantee to every read site downstream.
//
// ONE TO THREE RUNGS, and the lower bound is the type rather than a comment: `[Hint, ...Hint[]]` is
// a NON-EMPTY array, so `ladder[0]` needs no guard while `ladder[2]` does. It was a fixed 3-tuple
// until 2026-08-24.
//
// WHY IT WIDENED. Cryptic Clue draws its rungs from a pool whose entries drop when the clue already
// says what they would say, and on one clue shape -- an indicator that announces the device, a
// one-word definition, and no usable gloss -- only two survive that are worth a player's hint.
// Padding to three meant emitting a second letter reveal, and two letter reveals in a row is not a
// ladder, it is the same hint twice. A rung you do not have is better than a bad one.
//
// THE OTHER TWO TYPES THAT SHIP A LADDER STILL SHIP EXACTLY THREE -- goFigure through
// GoFigureHintLadder, a 3-tuple that stays assignable to this, and Missing Vowels through
// toHintLadder over a PhraseHints triple. So the tuple was never load-bearing for them and this
// widening costs them nothing; what it costs is that a client can no longer index blind.
//
// A FOURTH CASE IS NOT THIS TYPE'S. Cryptogram, Phrazle and Themed Anagrams ship no `hints` key,
// which is an ABSENT field rather than a short ladder -- there is no empty HintLadder and this type
// cannot express one. A client tests for the field, then reads its length.
export type HintLadder = [Hint, ...Hint[]]

// NO RUNTIME CONSTANT FOR THE CEILING LIVES HERE, and the reason is this file's first line:
// `export * from 'aws-lambda'` is a TYPES-ONLY re-export, so every import of this module is erased
// at compile time and nothing requires it at runtime. Adding an exported `const` reverses that --
// every importer starts requiring types.ts for real, resolution of the types-only package fails,
// and the failure surfaces as a module-not-found at Lambda cold start rather than at tsc. The
// builders keep their own ceiling; endpoints.rest states the range in prose.

// The INTERNAL phrase representation, and deliberately not HintLadder. Three bare strings is what
// the model returns, what the prose gates in phrase-checks read, and what the dedupe compares --
// wrapping happens once, at puzzle construction, through toHintLadder in utils/hints.ts. Keeping
// the two named apart is what stops a gate quietly running over objects and passing everything.
export type PhraseHints = [string, string, string]

// What a HINTED puzzle carries, and it is NO LONGER EVERY TYPE. It said "which today is every puzzle
// type", and that stopped being true when Cryptogram, Phrazle and Themed Anagrams moved to
// letter-shaped hints computed on the device: three of the six types now ship no ladder at all, and
// a shell that assumes one finds `undefined`. The three that DO extend this are goFigure, Missing
// Vowels and Cryptic Clue.
//
// SO THE SHELL'S TEST IS "does this puzzle have `hints`", not "which type is this". A client
// branching on the type list above would have to be edited every time a type crosses the line, and
// the line is exactly what this base draws. Absence is the normal case for half the catalog rather
// than a defect to repair.
//
// It lives HERE rather than in the phrase section below because it is not a phrase type's business:
// it is the base the shared UI shell reads to find hints without knowing the type, and `hints` is
// the ONLY thing it needs for that job. The ladder is ONE TO THREE rungs by HintLadder above -- not
// always three, since 2026-08-24 -- and each rung's shape is fixed by CLAUDE.md ("Every hint on the
// wire is { text, metadata? }"). The shell must read `hints.length` rather than assuming it.
//
// GoFigureData satisfies it without extending it, because GoFigureHintLadder is assignable to
// HintLadder -- so it is a base something conforms to rather than one nothing reads.
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
  // REQUIRED, and no read site branches on its absence.
  //
  // Packs are NOT wiped on deploy, whatever an earlier version of this comment claimed.
  // template.yaml sets DeletionPolicy and UpdateReplacePolicy to Retain on the packs table, NO Lambda
  // role holds a delete action on it -- all three are hand-scoped statements rather than managed
  // policy templates -- and createPack TOPS UP rather than replaces
  // (buildPack in services/packs.ts) -- so a pack written before a shape change keeps its old puzzles
  // indefinitely and nothing in this repo will ever rewrite it. What makes this field safe to
  // declare non-optional is the MANUAL runbook in endpoints.rest ("building a pack for a MISSING
  // date by hand", and the delete-and-rebuild note beside it), run before release:
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

// The two facts a rung reveals, plus the tag that says which member of HintMetadata this is -- which
// is currently a question with one answer, for the reasons recorded on that union.
//
// `kind` is REQUIRED and its value is fixed by the union's naming rule: `${PuzzleType}-${role}`, so
// `gofigure-operator`. The role segment is required even though goFigure has exactly one member
// today, because a SECOND member of the same type is the case a bare type tag cannot express -- and
// that case is the rejected elimination rung, which the second paragraph below places on the axis
// `kind` is NOT. Nothing in this repo describes that rung further; it was never built.
//
// AN EARLIER VERSION OF THIS COMMENT argued there is no discriminator, on the ground that "the
// presence of `operator` is what says this is an operator rung". That reasoning is sound for ONE
// alternative member and did not survive two arriving in one phase: Themed Anagrams contributed
// { entryIndex, reveal } and Phrazle { wordIndex, position, letter }, which are the same shape --
// { index-into-the-board, what-is-revealed } -- and nothing structural separated them.
//
// BOTH OF THOSE MEMBERS HAVE SINCE GONE, with the ladders that carried them, so the structural
// argument is technically available again and the tag is kept anyway. Where that was decided, and
// what it costs to undo, is on HintMetadata above; it is not re-argued here.
//
// The WITHIN-goFigure half of that argument is untouched and still holds: a rejected elimination
// rung is a variant axis INSIDE one type and would join structurally. `kind` is the TYPE axis.
//
// A PREVIOUS VERSION OF THIS TYPE HAD NO `text`, on the grounds that lull-ui could compose the
// sentence from these two fields and that wording is not rule. That was the one deliberate exception
// made to "the backend decides; the UI displays", and it is REVERSED. Text is authored here again,
// in hints.ts, and this structure rides alongside it as `metadata`. CLAUDE.md now carries the rule
// ("Every hint on the wire is { text, metadata? }") so the exception is not reintroduced by someone
// noticing that these two fields determine the sentence.
export interface GoFigureHintMetadata {
  kind: 'gofigure-operator'
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

// Themed Anagrams

// answer and scrambles in ONE object, never two parallel arrays. Parallel arrays permit different
// lengths and permit an index skew, and a type that permits an invalid state will eventually hold
// one -- here that state is a board showing word 3's scramble above word 2's answer.
export interface AnagramEntry {
  answer: string // uppercase A-Z, 5-9 letters, the word the player types
  // ONE TO FOUR arrangements of the answer's letters: [0] is the board as it first appears, and the
  // rest are what the reshuffle control cycles through, in order. Every member is the same letter
  // multiset and the same length as `answer`, proved at construction.
  //
  // A NON-EMPTY TUPLE rather than string[], which is the same argument as the sentence above applied
  // one level down: an entry with no scramble is a row the board cannot render at all, and it is the
  // shape a `.filter` over a rejected draw produces. SCRAMBLES_PER_ENTRY is a CEILING and not a
  // quota -- KETTLE's hardest band has exactly one acceptable arrangement and ROBOT's has none -- so
  // a short list is a normal return and a client reads the length rather than assuming four.
  scrambles: [string, ...string[]]
}

// No `answer` and no `category`. `answer` is defined above as THE ONE STRING THE PLAYER TYPES, and
// this type has four; the repeat unit is the THEME, which is why utils/exclusions.ts reads themes and
// words through two narrowed readers rather than through answerOf.
//
// The theme is ALWAYS SHOWN, at every difficulty. Hiding it is the Backlog's Scrambled Connections
// under another type's name, and mechanically it converts a one-answer puzzle into a several-answer
// one -- which breaks the Tier A claim rather than raising a difficulty. So there is no `category`
// field here and this type never imports generators/category-visibility.ts.
//
// RENDERED IN WIRE ORDER, and the reason is now the device's rather than the wire's. The ladder used
// to ship ordinals that indexed this array, so a board that sorted entries by length -- the obvious
// tidy-up -- made every rung point at the wrong row. There is no shipped ladder to break any more,
// but the rungs the device builds carry the same ordinals against the same array, so a board that
// reorders these entries breaks its own hints instead of the pack's.
//
// NO `hints`, and this type no longer extends HintedPuzzleData. Its ladder picked three target
// entries by ANSWER LENGTH, ranked once at generate time, so a player who had already solved the
// longest entry still got the whole-answer reveal spent on it. Which entries are still unsolved is a
// fact about a board four guesses have already changed, so the rungs are chosen on the device from
// src/rules/hint-themed-anagrams.ts instead.
export interface ThemedAnagramsData {
  entries: [AnagramEntry, AnagramEntry, AnagramEntry, AnagramEntry]
  theme: string
}

// Cryptic Clue

// Half-open [start, end) UTF-16 code-unit offsets into CrypticClueData.clue.
//
// COMPUTED IN CODE by locating the model's part strings and then discarding them. NEVER returned by
// the model: a model that miscounts one character would ship a hint quoting the wrong words. The
// clue's charset is [A-Za-z ], so code unit, code point and grapheme all coincide -- which is said
// out loud because a client slicing by grapheme would otherwise highlight the wrong span.
export interface ClueSpan {
  end: number
  start: number
}

// CLOSED HERE AND NOWHERE ELSE -- never in the tool schema. The predicate table in
// generators/crypticclue/verify.ts is exhaustive on this union, so a third device cannot be added
// without the compiler naming the site that must prove it.
export type CrypticDevice = 'anagram' | 'hidden'

// HintedPuzzleData, not PhrasePuzzleData: `answer` here is a single English word drawn from the
// source corpus, and it is deliberately outside PHRASE_CORPUS_TYPES (utils/exclusions.ts) -- a list
// of "phrases not to reuse" holding AARDVARK bans that word from three other types for twenty
// nights.
export interface CrypticClueData extends HintedPuzzleData {
  // The CODE-SUPPLIED shortlist word, uppercased -- never the model's spelling of it. nouns.ts
  // entries are single lowercase lemmas, so this is one token of 4-8 letters by construction, which
  // is the premise `enumeration` and the two letter rungs both stand on. No rung states a length.
  answer: string
  // Gated, rendered verbatim, and stored byte-identical to the string the verifier proved -- which
  // is why a clue needing a trim is REJECTED rather than trimmed. It carries NO enumeration
  // parenthetical: every character the cover tolerates as residue is a character a model can hide
  // content in.
  clue: string
  definitionSpan: ClueSpan
  device: CrypticDevice
  // Word lengths, derived in code from `answer`, so it cannot disagree with it. Always length 1 in
  // Phase 1, and guaranteed so rather than assumed: the answer is a single-token lemma. An array
  // rather than a number because the WIRE SHAPE is the expensive thing to change -- a data-shape
  // change requires the hand-run delete-and-rebuild runbook endpoints.rest documents -- and the
  // derivation is split().map() either way.
  enumeration: number[]
  fodderSpan: ClueSpan
  // NO indicatorSpan. It is verified and not shipped: nothing renders it, the `device` literal
  // already names what the indicator signals, and a field with no reader is a field that rots.
}

// Phrase puzzles

// 5 = a general audience recognizes it instantly, 1 = obscure but fair. Set by the REVIEWER, never
// by the generator: a generator asked to rate its own output is grading its own work. Defaults to 3
// when review did not run.
//
// Direction matters and is easy to get backwards: high familiarity makes a Cryptogram EASIER.
export type Familiarity = 1 | 2 | 3 | 4 | 5

// What a PHRASE-derived puzzle carries on top. `answer` and `category` were never universal: they
// are the phrase corpus's fields, and the base above is what keeps that honest.
//
// `answer` is defined, once, as THE ONE STRING THE PLAYER TYPES. A multi-answer type does not set
// it -- it carries its own fields and is read through a reader narrowed on its own type. Move the
// field up to the base and every type starts claiming to have one.
//
// It is NOT what decides membership of the anti-repetition list. That used to be true --
// create-phrase-puzzles.ts read `answer` off every puzzle of the last 20 days without narrowing on
// type, so what kept a type out was having no `answer` to find -- and it is now utils/exclusions.ts
// that decides, from an explicit PHRASE_CORPUS_TYPES set. The two questions came apart because a
// type can have a perfectly good single answer that is an ordinary English word, which belongs in an
// adjudication but not in a list titled "phrases not to reuse".
//
// `category` is optional because difficulty HIDES it -- see generators/category-visibility.ts. It is
// omitted, never nulled: dynamodb.ts stores the pack as JSON.stringify, so an absent key simply
// disappears from the payload.
//
// IT NO LONGER EXTENDS HintedPuzzleData, and that is the change that took cryptogram and phrazle
// hints off the wire. Drawing a phrase and shipping the phrase's ladder were always separate
// questions -- toHintLadder's comment has said so since Phrazle arrived -- and this type used to
// answer the second one for all three of its members. Missing Vowels extends both bases and is now
// the only phrase type that ships a ladder; Cryptogram and Phrazle compute letter-shaped hints on
// the device from src/rules/, against a board no generator can enumerate in advance.
export interface PhrasePuzzleData {
  answer: string
  category?: string
}

// Missing Vowels

// TWO BASES, and the second one used to be inherited through the first. It is the ONLY phrase type
// that still ships a ladder, so it is the only one that names HintedPuzzleData: the shared prose
// rungs are semantic ("never about how it is written", per prompts/create-phrases.txt), and
// recognizing the phrase from its meaning is exactly what a missing vowels player is doing.
export interface MissingVowelsData extends HintedPuzzleData, PhrasePuzzleData {
  displayed: string // respaced consonant string -- the spacing deliberately lies
}

// Cryptogram

// No `revealed` map: the system design sketches one for pre-filled letters and Cryptogram has none.
//
// AND NO `hints`. It shipped the shared prose ladder -- three model sentences about what the phrase
// MEANS -- and a cryptogram player is not trying to recognize a phrase from its meaning, they are
// solving a substitution cipher one letter at a time. A semantic nudge on this type is a hint for a
// different puzzle. The replacement is letter-shaped and cannot be shipped at all: it ranks the
// cipher letters this player has not yet got right, which is a fact about a board built at play
// time. It lives in src/rules/hint-cryptogram.ts and runs on the device.
//
// The phrase still ARRIVES with three prose hints -- passesProseGates requires them before a phrase
// is usable at all, and Missing Vowels ships them -- and this generator drops them on the floor.
export interface CryptogramData extends PhrasePuzzleData {
  ciphertext: string
}

// Phrazle

// TWO fields, both of them inherited, and its smallness is the point: `answer` and `category?` come
// from PhrasePuzzleData, which is this type declaring in the type system what it is -- the same
// phrase in a third costume, exactly as generators/category-visibility.ts already says. An ALIAS
// rather than an `extends` with an empty body, which is the same type carrying a lint error.
//
// IT WAS THREE FIELDS. `hints` left with PhrasePuzzleData's ladder, and this type's went two ways at
// once: it never used the prose rungs (it built three positional letter reveals in code instead),
// and those reveals were blind -- `Letter 1 of word 1 is T.` names a position with no regard for
// what four guesses have already colored in, so a rung routinely spent itself on something the
// player had proved. A hint fixed before the player exists cannot know what is still worth saying.
// src/rules/hint-phrazle.ts replaces it on the device, reading the guesses actually made.
//
// THERE IS NO GUESS LIMIT AND NO LOSS STATE. It carried one own field, `maxGuesses`, shipping six.
// That was the right shape for a rule the backend owns and the wrong rule: this game is not
// losable, and a player guesses until the phrase falls. The FIELD IS GONE rather than sentinelled,
// because a `null` or a `0` meaning "unlimited" is a limit field claiming to have no limit, and the
// next reader builds a bound on top of it. A client that keeps a bounded window of guesses is doing
// STORAGE, not rules, and needs nothing from the wire to do it.
//
// `answer` SHIPS THE CANONICAL FORM -- uppercase A-Z words separated by single spaces, the output of
// splitPhrase re-joined -- and is the ONLY phrase-type answer that is not `phrase.text` verbatim.
// The board paints its characters as tiles and marks them with markGuess, which works on canonical
// words, so shipping corpus text with an accent or a stray double space would give the board an
// answer string whose characters are not the characters the marker marks. Missing Vowels and
// Cryptogram both display a DERIVATION of `answer` (a consonant run, a ciphertext) and adjudicate
// through normalizeAnswer, so neither has this constraint. utils/exclusions.ts is unaffected either
// way, because the anti-repetition list keys on normalizeAnswer, which collapses both forms.
//
// AND IT IS NOT A SECRET. endpoints.rest says so in one sentence rather than obscuring it. A hash
// cannot color a tile -- marking needs the letters -- and an encoding would ship its own reversal in
// the same bundle, which is a CLAIM of secrecy rather than secrecy, and more dangerous than an
// admitted absence of one because the next person builds a control on top of it. Either would also
// make `answer` unreadable as a phrase, which silently removes this type from the anti-repetition
// list. The pack sits in localStorage where three keystrokes reveal it in any case.
//
// NO `wordLengths`, against the system design's sketch. It is splitPhrase(answer).map(w => w.length),
// and two fields that can disagree is a defect surface on the one type where a disagreement is a
// board with the wrong number of tiles. The board derives the lengths through the SAME splitter the
// guess goes through, so grid and guess cannot disagree by construction.
//
// Nothing else: no precomputed marks, no dictionary subset, no familiarity, no shape, no limit.
export type PhrazleData = PhrasePuzzleData

// CLIENT-SIDE ONLY. lull-api never reads or writes this; it defines the SHAPE so that a rules fix
// cannot be contradicted by state a client cached. The shell persists progress verbatim and never
// interprets it -- what gains a contract is the type, and a type contract is this repo's to write.
//
// MARKS ARE DERIVED, NEVER STORED, and that is what makes the vendored-rules exposure survivable.
// markGuess's ordering is near-certain to be corrected at least once -- this branch is already
// correcting the published version of it -- and src/rules/ has no cross-repo check. A client caching
// tile colors would resume a board showing two different colorings of one game; raw guesses
// re-derive on every render, so a future marking fix REPAIRS every saved board instead of
// contradicting it. The enforcement is mechanical rather than contractual: markGuess is pure and
// runs in microseconds, so caching marks buys nothing.
//
// `solved` is NOT here and is not this type's to define. It lives in the shell's progress envelope,
// and what this decision fixes is that it is DERIVABLE from the blob -- true iff some guess marks
// all green -- so the two can never disagree.
export interface PhrazleProgress {
  // In order, in CANONICAL FORM, and VALID GUESSES ONLY. A guess is appended AFTER isValidGuess
  // returns true, never before, so an invalid guess never occupies an attempt. Storing raw
  // keystrokes instead would make a resumed board depend on a normalization rule that is allowed to
  // change, which is the thing this type exists to prevent.
  //
  // UNBOUNDED HERE, because there is no guess limit (see PhrazleData). A client is free to keep a
  // bounded recent window rather than every guess forever -- that is a storage decision about a
  // string in localStorage, which a player can type into, and it is the client's to make. It is not
  // a rule and nothing on the wire declares it.
  guesses: string[]
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

// Tagged by shape because the consumers want different things from one call. The tag is required by
// isUsable, PER PHRASE -- never by the tool schema, which describes the top level and nothing below
// it, because an ajv constraint on an element fails the whole batch over one drifted phrase.
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
export interface PhraseGenerator<T = unknown> extends PackContribution {
  // REQUIRED, not optional. Two phrase generators share one mutated pool, so a generator that
  // cannot say what it can use gets whatever the greedier one left -- and an optional predicate
  // defaulting to "yes" is exactly the silent version of that bug.
  isUsablePhrase: (phrase: Phrase, difficulty: Difficulty) => boolean
  generate: (date: PackDate, difficulty: Difficulty, phrase: Phrase) => Promise<Puzzle<T>>
}

// ONE gated model draft plus the difficulties it can carry. The draft type never escapes: the
// selection loop reads `usableAt` and calls `build`, and sees nothing else.
export interface Candidate<TData = unknown> {
  // Non-empty; a draft usable at nothing is dropped at the gate rather than carried.
  usableAt: Difficulty[]
  build: (date: PackDate, difficulty: Difficulty) => Promise<Puzzle<TData>>
}

// A generator whose material comes from its OWN model call rather than the shared phrase batch.
// ONE call per type per pack, never one per puzzle.
//
// It has no inRequest field, and that is structural rather than an omission: inRequest lives on
// Generator, and a model type is off the request path because of WHICH LIST IT IS IN, not because of
// a flag it sets. The two lists are modelContributions (data, in generators/index.ts) and
// modelGenerators (implementations, in generators/model.ts), and both guards named on
// modelContributions exist to keep the second out of the first's module graph.
//
// The second parameter is THE RECENT PACKS, not a pre-flattened exclusion list. Each type applies
// its own narrowed reader. Two reasons, and neither is ergonomics: a type with two repeat units
// cannot flatten them into one string[] without making them indistinguishable to the dedupe that
// consumes them, and a per-type excludedFor() in the handler is a registration point outside the
// registry. `{ puzzles: Puzzle[] }[]` is structurally satisfied by the Pack[] getRecentPacks already
// returns, so a caller passes what it has and casts nothing.
//
// Candidate rather than a draft type parameter, and that is a compiler fact rather than a
// preference. strictFunctionTypes checks function properties contravariantly in their parameters, so
// a generator whose build() took the draft as an argument is not assignable into ModelGenerator[]
// (probed: TS2322). Closing the draft inside build is what makes the array sound with no cast -- and
// the same fact forbids widening fetchCandidates' second parameter generically, which is why it
// names one concrete type.
//
// `origin` IS THE DATE BEING BUILT, and it is here because `recent` reaches in both directions. The
// handler reads a window centred on that date rather than the days before it, so "which of these
// packs matters most" is a distance from `origin` and cannot be recovered from `recent` alone --
// a reader handed the window with no centre falls back to newest-first and, on a truncated list,
// keeps a pack twenty days ahead over yesterday's.
export interface ModelGenerator<TData = unknown> extends PackContribution {
  fetchCandidates: (count: number, recent: { puzzles: Puzzle[] }[], origin: PackDate) => Promise<Candidate<TData>[]>
}
