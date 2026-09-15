import { ClueSpan, CrypticDevice, HintLadder } from '../../types'
import { log, logError } from '../../utils/logging'
import { containsAnswerToken, passesStringGates } from '../../utils/model-output-checks'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, crypticInflections } from './verify'

// THE PER-RUNG GATE CAP, AND NO RUNG QUOTES THE CLUE ANY MORE, so it is now slack by a wide margin
// rather than by four characters. It was sized against frames that interpolated a SLICE of an
// already-length-gated clue: the fodder quotation first, then `The definition is "X".` at 21
// characters of frame. Both are retired -- see the frame table below for why the definition rung went
// -- and every surviving frame interpolates ANSWER-SIZED text: a charade's parts concatenate to the
// answer (8 letters, at most 8 parts, ` + ` between them), a deletion's source is one letter longer
// than the answer, the letter rung names one character, and a word gloss is capped at
// MAX_WORD_GLOSS_LENGTH. The widest rung this pool can compose is 79.
//
// LEFT AT MAX_CLUE_LENGTH + 25 DELIBERATELY, and the reason survives the rungs it was written for. A
// cap's job here is to be non-binding over every rung the pool can compose; tightening it to the
// width of the widest frame makes the next frame -- one character wider, for a perfectly good reason
// -- a rejected clue rather than a rung that fits. hints.test.ts asserts every composed rung fits
// this cap and deliberately does NOT assert the cap is tight, because a tight cap is the failure mode
// rather than the goal.
//
// IT IS NO LONGER THE BINDING CAP ON ANYTHING. MAX_GLOSS_LENGTH (80) is what actually bounds a rung's
// width today, and worst-case.ts measures against that. This stays as the gate's own ceiling: the
// thing that fires if a future frame starts quoting the clue again.
export const MAX_CRYPTIC_RUNG_LENGTH = MAX_CLUE_LENGTH + 25

// THE CEILING, not the length. A cryptic ladder is ONE TO THREE rungs -- see HintLadder in types.ts
// for why the wire widened -- and this is the most buildHints will emit. Declared here rather than
// beside HintLadder because types.ts is a types-only module and may hold no runtime value; see the
// note there.
export const MAX_HINT_RUNGS = 3

// The gloss ships VERBATIM as a rung, so this is a rung cap and it is set at 80, which is where
// every code-built rung in either repo is capped. It used to be set against two siblings in
// src/generators -- MAX_ANAGRAM_RUNG_LENGTH and MAX_PHRAZLE_RUNG_LENGTH -- and both moved out when
// Themed Anagrams and Phrazle stopped shipping ladders.
//
// THE OTHER TWO 80s ARE NO LONGER PINNED AGAINST THIS ONE, and the pin is not replaceable. The
// builders kept both names and the same 80 -- MAX_ANAGRAM_RUNG_LENGTH and MAX_PHRAZLE_RUNG_LENGTH --
// but they now live only in lull-ui, as components/{themedanagrams,phrazle}/rungs.ts, so there is
// nothing here to import. hints.test.ts asserts this 80 alone; lull-ui's rungs tests assert theirs,
// each carrying a comment naming this constant. A sibling drifting off 80 goes red over there or not
// at all.
//
// MAX_CRYPTOGRAM_RUNG_LENGTH IS DELIBERATELY OUTSIDE THAT PIN at 99, because cryptogram is the one
// type with no per-word length gate; the reason is stated on that constant and in hints.test.ts.
//
// Deliberately NOT MAX_HINT_LENGTH (200), which is sized for phrase prose carrying a whole semantic
// field; a gloss is one clause about one word, and a longer one drifts toward naming the answer.
export const MAX_GLOSS_LENGTH = 80

// THE CAP ON THE SECOND MODEL STRING, and it is 56 rather than 80 because this one is INTERPOLATED
// rather than shipped verbatim. A gloss IS a rung, so its cap and the rung cap are the same number. A
// word gloss is a PHRASE that a code frame wraps into a rung, so the rung's width is the phrase plus
// the frame, and the widest frame here is `The answer also means ` at 22. 56 + 22 + 1 for the period
// is 79, which keeps every framed rung inside the same 80 MAX_GLOSS_LENGTH documents.
//
// hints.test.ts asserts that arithmetic against the frame rather than restating 79, so widening a
// frame reddens the row instead of silently pushing a rung over.
export const MAX_WORD_GLOSS_LENGTH = 56

// The 4-8 shortlist band, restated here rather than imported -- see the comment on the exports in
// answers.ts for why, and hints.test.ts for the assertion that holds the two copies equal. A length
// outside it is UNREACHABLE from model output (verify step 2 round-trips the answer and takes the
// code-supplied spelling), so it is a CODE DEFECT, and a code-defect gate is a logError-with-reason
// rejection at runtime and a throwing assertion in a test. Never a throw on the nightly path:
// buildHints runs inside `accept`, whose contract is per-item and throw-free, and requestBatch
// downgrades a throwing accept to a per-item rejection anyway -- precisely the "a gate would quietly
// drop the evidence" outcome a throw would have been for.
const MIN_ANSWER_LENGTH = 4
const MAX_ANSWER_LENGTH = 8

// The openings of every composed rung. CONSTANTS RATHER THAN INLINE LITERALS because isComposedRung
// below has to agree with the pools exactly, and two copies of `The answer begins with ` would be two
// things to keep in step.
//
// FOUR FRAMES ARE STRUCK AND TWO ARE NEW, and the four all went for one reason. ENDS_FRAME and
// FODDER_FRAME survived only so scripts/audit-cryptic.ts could read packs written before their rungs
// were retired. DEFINITION_FRAME and the two DEVICE_RUNGS sentences join them here: a rung must narrow
// the answer using something the player cannot read off their own screen, and neither could.
//
//   * THE DEVICE SENTENCES WERE PER-DEVICE CONSTANTS. `The answer is built from two or more shorter
//     words, one after the other.` was the SAME STRING on every charade this repo ever shipped, and
//     the double definition's was the same on every one of those. The argument for them was that no
//     indicator prints the mechanism, which is true and is an argument about a player's FIRST game.
//     A rung carrying no information about the puzzle in front of the player is a tutorial, and a
//     tutorial billed to one of three hints is a rung that narrows nothing.
//   * THE DEFINITION QUOTE POINTED AT THE CLUE. `clue` ships on `data` and the client renders it, so
//     its words are on the player's screen -- the same rule that retired an enumeration rung. The
//     old defence was that WHICH words form the definition is not readable off the surface; that is
//     a claim about parsing, and this type already spends a rung teaching the parse better.
//
// WHAT REPLACED THEM IS ONE FRAME PER DEVICE OVER A WORD THE CLUE DOES NOT PRINT. That is the whole
// idea: a charade's parts, a deletion's source and a double definition's third sense are the only
// content this type holds that a player cannot already read.
const FIRST_PART_FRAME = 'The first part is '
const LONGER_WORD_FRAME = 'The longer word is '
const ALSO_MEANS_FRAME = 'The answer also means '
const ALL_PARTS_FRAME = 'The answer is '
const SOURCE_FRAME = 'The wordplay starts from '
const BEGINS_FRAME = 'The answer begins with '

/**
 * The frame each device wraps its word gloss in, and the thing that phrase is ABOUT.
 *
 * ONE FIELD, THREE TARGETS, and the targets are what make this a hint rather than a restatement:
 * a charade's first part and a deletion's source are words the clue is FORBIDDEN to print -- verify
 * proves the letters are never on the page -- so a phrase for either is new information by
 * construction. A double definition hides no word at all, both halves being printed, so its phrase is
 * a third angle on the answer and the gate forbids it both printed halves and the gloss above it.
 *
 * FIRST_PART_FRAME IS SHARED WITH THE LETTER-BEARING RUNG, deliberately. `The first part is a noisy
 * argument.` and `The first part is ROW.` sit one above the other on the ladder, the second answering
 * the first, and a player reads that as one hint escalating rather than two unrelated ones.
 */
const WORD_GLOSS_FRAMES: Record<CrypticDevice, string> = {
  charade: FIRST_PART_FRAME,
  deletion: LONGER_WORD_FRAME,
  doubledefinition: ALSO_MEANS_FRAME,
}

/**
 * Whether a shipped rung was composed HERE, as opposed to written by the model.
 *
 * It exists for scripts/audit-cryptic.ts, which reads packs off the wire and has to tell a gloss
 * from a structural rung. The gloss carries NO METADATA -- this type ships none on any rung, and at
 * sixty bytes of headroom against its pack row it cannot afford to start -- so there is no tag to
 * read and the text is all there is. (The row is 700 and the shape measures 640; it read "six bytes"
 * against the 750 row this branch replaced. Sixty is still under what three rungs of `kind` string
 * and its fields cost -- see the phrazle figures in packs-size.test.ts.)
 *
 * That is only sound because it reads THE POOLS' OWN CONSTANTS. A prefix table copied into the audit
 * would silently stop matching the day a template is reworded, and the audit would report every rung
 * as a gloss without failing anything.
 *
 * ALL_PARTS_FRAME IS A PREFIX OF THE CHARADE DEVICE SENTENCE (`The answer is built from ...`), which
 * costs nothing: both are composed here, so both answers are `true` and the two clauses of this
 * disjunction agree. It is stated because the overlap looks like a bug on first reading.
 *
 * DIRECTIONAL, and the direction is the safe one: a gloss that happened to open with one of these
 * frames would be counted as structural and the gloss rate would read LOW. An audit that
 * under-reports its own supply prompts an investigation; one that over-reports hides a dead prompt.
 */
export const isComposedRung = (text: string): boolean =>
  [ALL_PARTS_FRAME, ALSO_MEANS_FRAME, BEGINS_FRAME, FIRST_PART_FRAME, LONGER_WORD_FRAME, SOURCE_FRAME].some((frame) =>
    text.startsWith(frame),
  )

/**
 * SEVEN ROWS IN THREE GATE CHECKS, and the ONLY place model prose is judged for this type.
 *
 * `passesStringGates` contributes FIVE of the seven on its own -- G1 typeof and non-empty-after-trim,
 * G2 the cap, G3 no control or format codes, G4 no charged term, G5 no answer leak -- and they all
 * report as `gloss-gate`, because that reason names THE CALL, not the row that fired. Then the
 * inflection check, then definition reuse. So a control character, a charged word and an over-long
 * gloss are indistinguishable in the logs, which is the cost of one call and is worth knowing before
 * reading a `gloss-gate` count as a length problem.
 *
 * FOUR `if`s, not three: the `undefined` guard is one, and it is the arm the reviewer path relies on.
 * hints.test.ts carries one row per REACHABLE reason -- three, since gloss-gate covers five of the
 * seven -- and generator.test.ts's gate table carries four rows over those same three reasons. Seven,
 * three and four are three different counts of three different things, which is why each is named
 * with what it counts.
 *
 * Returns the gloss if it may ship as a rung, undefined if the rung drops. NEVER rejects the clue:
 * every failure here costs one hint, and the pool backfills from rungs composed in code.
 *
 * IT RUNS TWICE ON THE NIGHTLY PATH AND FOUR TIMES BEHIND A REVIEWER FIX -- `accept`, then the
 * `buildHints` inside the `toCandidate` that same `accept` calls, then review.ts's applyFix over the
 * replacement, then the rebuild's `buildHints`. The buildHints call below is the one a tidying edit
 * will reach for, and dropping `accept`'s own from that list -- as an earlier version of this
 * paragraph did -- makes it look like the removable one.
 *
 * It must stay. generator.ts's `accept` gates the gloss immediately after the clue's own
 * passesStringGates call, because review.ts sends the VerifiedClue to a second model and an ungated
 * gloss must not be what that model is asked to judge. buildHints keeps its call anyway: it is the
 * ONLY entry point to a ladder, and a builder that trusts its caller ships an ungated rung the day
 * someone adds a second caller. The repeat is IDEMPOTENT AND SILENT -- a gloss that passed passes
 * again writing no log, and a dropped one arrives `undefined` and returns above every drop() -- so
 * there is no double log to suppress and therefore no `quiet` flag to plumb through.
 *
 * G5 RUNS, AND THAT IS THE OPPOSITE OF WHAT buildHints DOES TO EVERY OTHER RUNG. A cryptic clue
 * legitimately contains its answer's letters, so the leak gate is waived by role over the clue and
 * over every rung that quotes it or spells its parts. A gloss carries no such license: it is a
 * sentence about the answer and naming the answer is exactly the failure. Same module, same function,
 * reversed polarity, and the reason is the STRING'S ROLE rather than the puzzle type -- which is how
 * passesStringGates documents its own applicability.
 *
 * The inflection check is not redundant beside G5. That gate matches WHOLE TOKENS with no
 * stemming, so "penguins are flightless" leaks nothing by that test while handing the player the
 * answer. It is the same list verify step 11 runs over the clue.
 *
 * THE DEFINITION-REUSE RULE is the one new rule: definition "Bird" rejects "A bird that cannot fly"
 * and forces the model to find another angle. On a DOUBLE DEFINITION the `definition` argument is the
 * union of both halves -- see the derivation in buildHints -- so a gloss may lean on neither.
 *
 * IT DOES NOT USE THE ANSWER-LEAK PREDICATE, which is the obvious fit and is BANNED IN THIS
 * DIRECTORY -- by an eslint rule on the import and by a source scan in imports.test.ts that rejects
 * the identifier anywhere in this file, comments included, so it is not named here. The ban exists
 * because a cryptic clue legitimately carries its answer's letters and that gate would reject a clue
 * whose wordplay spells them out; it cannot tell that this call would have passed the DEFINITION
 * rather than the answer, and a guard that strict is worth more than the exception.
 *
 * Honoring it produced the better check anyway. `containsAnswerToken` -- the replacement the rule's
 * own message names -- asks "does this prose contain this token whole", over the same
 * module-private tokenizer, so running it per definition token reuses the shared tokenizer that
 * verify.ts declined to duplicate. And the banned predicate keeps only tokens of four characters or
 * more, so definitions like "Cat" and "Owl" would have slipped through it. Filtering on CONNECTIVES
 * instead of a length floor catches them, and CONNECTIVES is already this type's notion of a
 * function word -- verify step 7's substantive-definition floor reads the same set, so the two
 * cannot disagree about what a content word is.
 */
export const gatedGloss = (
  gloss: string | undefined,
  answer: string,
  definition: string,
  // WHICH MODEL WROTE THE STRING, and it is required rather than defaulted because the two callers
  // read two different prompts. `source` is the only thing separating a create-cryptic-clues gloss
  // from a review-cryptic-clues replacement in the logs, and the gate's whole justification for
  // carrying a `reason` is that a prompt can be tuned by reading which gate fires. One message name
  // over two prompts cannot do that, and a clue whose original AND replacement both fail emits two
  // identical lines that read as one gloss failing twice.
  source: 'generator' | 'review',
): string | undefined => {
  if (gloss === undefined) {
    return undefined
  }

  // A `log`, not a logError, on every arm. A dropped gloss is a working gate on model prose and an
  // EXPECTED outcome, not a fault -- the ladder is still three rungs on most shapes. The reason
  // travels so the prompt can be tuned by reading which gate fires, which is the same operation the
  // indicator list grows by.
  const drop = (reason: string): undefined => {
    log('Dropped a cryptic gloss', { answer, reason, source, type: 'crypticclue' })
    return undefined
  }

  if (!passesStringGates({ answer, maxLength: MAX_GLOSS_LENGTH, value: gloss })) {
    return drop('gloss-gate')
  }
  if (crypticInflections(answer).some((form) => containsAnswerToken(form, gloss))) {
    return drop('gloss-inflection')
  }
  // Whole tokens on both sides. The definition is a slice of a clue that cleared CLUE_CHARSET, so it
  // is letter-runs separated by single spaces and needs no tokenizer of its own to split.
  const substantive = definition
    .toUpperCase()
    .split(' ')
    .filter((token) => !CONNECTIVES.has(token))
  if (substantive.some((token) => containsAnswerToken(token, gloss))) {
    return drop('gloss-restates-definition')
  }
  return gloss
}

/**
 * THE LENGTH FLOOR THAT APPLIES TO PROSE AND NOT TO A CLUE SLICE, and the split is the whole point.
 *
 * CONNECTIVES IS NOT A STOPWORD LIST. It is the cryptic SEAM alphabet -- the words a clue may spend
 * between its blocks -- and verify step 6 gates on it. It holds `of`, `to` and `with`; it does not
 * hold `on`, `it`, `at`, `be` or `no`, because those are not seams. Over a CLUE SLICE that is exactly
 * right and a length floor would be wrong, which gatedGloss's own note records: definitions like
 * `Cat` and `Owl` are three letters of pure content, and a floor would wave them through.
 *
 * OVER FREE PROSE IT IS NOT ENOUGH, and this floor exists because it shipped a false drop. A double
 * definition forbids its word gloss the GLOSS ABOVE IT, which is a whole sentence rather than a
 * four-word slice, so the two strings meet across a far wider surface. `Might be pencil lines on
 * paper.` and `five funny minutes on a stage` share exactly one token -- `on` -- and the rung died
 * over it. Nothing was restated; the filter simply had no opinion about prepositions because the list
 * it reads was never asked to have one.
 *
 * FOUR, matching the floor the repo's own answer-leak filter uses on the same question of the same
 * kind of text. It is a cost rather than free: two glosses sharing a real four-letter content word
 * still drop. That is the right way to be wrong here -- the drop costs one rung and never the clue,
 * and the prompt's instruction on both fields is to find a different angle anyway.
 */
const MIN_PROSE_TOKEN_LENGTH = 4

/**
 * The substantive tokens of some text, for the restatement rules.
 *
 * SPLIT ON NON-ALPHANUMERICS rather than on spaces, which is a no-op on a clue slice -- one cleared
 * CLUE_CHARSET, so it is already letter-runs separated by single spaces -- and is what makes the
 * floor above meaningful on prose, where `paper.` would otherwise measure six characters and
 * `it,` three.
 */
const substantiveTokens = (texts: readonly string[], minLength = 1): string[] =>
  texts
    .flatMap((text) => text.toUpperCase().split(/[^A-Z0-9]+/))
    .filter((token) => token.length >= minLength && !CONNECTIVES.has(token))

/**
 * Whether a model-supplied string names any form of any protected word.
 *
 * WHOLE TOKENS, WITH THIS TYPE'S INFLECTION LIST, and it is the check G5 cannot make. G5 keeps only
 * tokens of four characters or more, so a three-letter part -- CAR, ROW, PET -- passes it untouched;
 * and G5 has no stemming, so CARPETS passes while handing the player the answer.
 */
const namesAny = (protectedWords: readonly string[], prose: string): boolean =>
  protectedWords.flatMap(crypticInflections).some((form) => containsAnswerToken(form, prose))

/**
 * What a word gloss may not restate, separated by the KIND of text rather than gathered into one
 * list, because the two take different token filters and merging them is a bug that typechecks.
 */
export interface WordGlossForbids {
  // The GLOSS already shipped as rung one, on the one device whose two model strings are both about
  // the answer. Free prose, so it takes the length floor.
  prose?: string
  // Slices of the clue: the cue that already means the target, or a double definition's two printed
  // halves. Short, curated, and filtered on CONNECTIVES alone so a three-letter definition counts.
  slices: readonly string[]
}

/**
 * The gate on a WORD GLOSS -- the model's phrase for the sense of a word the answer is built from.
 *
 * IT IS A SECOND GATE RATHER THAN A SECOND CALLER OF gatedGloss, because the string plays a different
 * role and three of its rows differ:
 *
 * TWO PROTECTED WORDS, NOT ONE. A gloss is about the answer, so it protects the answer alone. A word
 * gloss is about a DIFFERENT word -- a charade's first part, a deletion's source -- and must name
 * neither that word nor the answer. On a double definition the two coincide and the list collapses to
 * one, which is a property of the device rather than a special case in here.
 *
 * A SHAPE ROW, WHICH gatedGloss HAS NO NEED OF. A gloss ships VERBATIM and is a sentence; a word
 * gloss is INTERPOLATED into one, so `A noisy argument.` composes `The first part is A noisy
 * argument..` -- a capital mid-sentence and a doubled period. The rung is composed here, so its
 * well-formedness is decidable here, and it is a DROP rather than a rung-gate rejection because a
 * malformed phrase costs the rung and must never cost the puzzle.
 *
 * SEVERAL FORBIDDEN TEXTS, NOT ONE. A charade forbids the cue that already means the target; a double
 * definition forbids BOTH printed halves AND the gloss already shipped as rung one, because a second
 * angle that repeats the first is one hint delivered twice.
 *
 * G5 RUNS HERE, with the answer supplied, for the reason gatedGloss gives: the waiver every other rung
 * on this type enjoys is held BY ROLE, and a sentence about the answer's sense has no claim on it.
 *
 * NEVER REJECTS THE CLUE. Every failure costs one rung and the pool backfills.
 */
export const gatedWordGloss = (
  wordGloss: string | undefined,
  // The word the phrase is about: a charade's first part, a deletion's source, or -- on a double
  // definition, which hides no word -- the answer itself.
  target: string,
  answer: string,
  // Text the phrase may not restate, SPLIT BY WHAT KIND OF TEXT IT IS because the two take different
  // filters -- see MIN_PROSE_TOKEN_LENGTH, which exists because treating them alike shipped a false
  // drop over the word `on`.
  forbid: WordGlossForbids,
  source: 'generator' | 'review',
): string | undefined => {
  if (wordGloss === undefined) {
    return undefined
  }

  const drop = (reason: string): undefined => {
    log('Dropped a cryptic word gloss', { answer, reason, source, type: 'crypticclue' })
    return undefined
  }

  if (!passesStringGates({ answer, maxLength: MAX_WORD_GLOSS_LENGTH, value: wordGloss })) {
    return drop('word-gloss-gate')
  }
  // AFTER the string gates and before anything reads the text: those gates are what prove this is a
  // non-empty string, so `wordGloss[0]` cannot be undefined here.
  if (wordGloss.endsWith('.') || wordGloss[0] !== wordGloss[0].toLowerCase()) {
    return drop('word-gloss-shape')
  }
  if (namesAny([answer, target], wordGloss)) {
    return drop('word-gloss-inflection')
  }
  const restated = [
    ...substantiveTokens(forbid.slices),
    ...substantiveTokens(forbid.prose === undefined ? [] : [forbid.prose], MIN_PROSE_TOKEN_LENGTH),
  ]
  if (restated.some((token) => containsAnswerToken(token, wordGloss))) {
    return drop('word-gloss-restates-cue')
  }
  return wordGloss
}

/**
 * Up to three rungs drawn from THIS DEVICE'S pool: the first three that say something the player
 * cannot already read off their screen, weakest first.
 *
 * THE RULE THIS ENFORCES, and it is the whole of the type's hint design: A RUNG THAT RESTATES THE
 * CLUE IS NOT A HINT. The retired `hidden` device used to spend its entire ladder telling the player
 * that the wordplay was a hidden word (the clue says `hidden in`), that the definition was its first
 * word, and that the answer had seven letters (the client renders the enumeration beside the clue) --
 * three hints to deliver one letter. The cause was structural rather than a bad template: every rung
 * described the clue's SHAPE, and verify.ts constrains shape hard enough to make shape legible.
 *
 * ONE POOL PER DEVICE, AND DELIBERATELY NO SHARED ORDERING. The same rung is worth different amounts
 * on each device, and ranking rungs by how much they LOOK like they say is the error CLAUDE.md
 * records this type making TWICE, in opposite directions, on the devices that came before these. The
 * pools below are ranked by what each rung YIELDS in the player's hand on the device in hand, and the
 * per-device reasoning is written at each pool rather than factored into a shared table -- because a
 * shared table is exactly what invites the next reviewer to rank by appearance again.
 *
 * THERE IS NO APPENDED FLOOR, AND ITS REMOVAL IS THE THIRD CORRECTION TO THIS FILE'S RANKING. The
 * letter rung used to be pushed on BELOW whatever the pool produced, on the reasoning that a letter
 * reveal is the least interesting thing this type can say. That was true of the devices this pool
 * replaced and is FALSE of these three, and the mechanic quietly inverted the ladder: a deletion whose
 * gloss failed shipped `The wordplay starts from BRANDY.` and then `The answer begins with B.` -- the
 * complete solve, followed by one letter of it. Appending a fixed rung below a pool is only safe when
 * that rung is weaker than everything IN the pool, which is a claim about each device and not a
 * property of the mechanic. So the letter rung is now a POOL ENTRY WITH A PER-DEVICE RANK, and it
 * ranks in three different places.
 *
 * WHY IT RANKS HIGH HERE, where it ranked lowest on the devices that came before: all three of these
 * devices put a STRAIGHT DEFINITION on the player's screen -- that is what makes them synonym devices
 * -- and the client renders the enumeration beside the clue. A definition plus a length plus a first
 * letter is a crossword lookup, so the letter rung is one step short of the answer rather than a
 * consolation. On the retired `anagram` and `hidden` clues it was a single character against wordplay
 * that already contained every character, which is why it was worth so little there.
 *
 * WHAT IS COMMON TO ALL THREE POOLS, and it is only this: the gloss leads, and no rung sits below one
 * that yields more than it does.
 *
 * THE GLOSS IS THE ONLY RUNG ABOUT THE ANSWER; every other one is about the clue. That is what it is
 * for -- everything below it can only rearrange or reveal what the clue already commits to. It is
 * also the only rung this type does not compose itself, so it is the only one that passes through a
 * content gate before shipping. It leads ON STRENGTH, not on sympathy for a beginner: a sentence
 * about the answer's sense leaves a field of candidates standing, where every structural rung below
 * it narrows to one or to a handful.
 *
 * ---
 *
 * CHARADE -- five entries, NO LETTER RUNG, and the ladder is ALWAYS three rungs:
 *
 *   1. the gloss        -- dropped when it fails gatedGloss, or the model supplied none
 *   2. the device       -- NEVER DROPS; a charade carries no indicator, so nothing on the player's
 *                          screen says the answer is two words abutting. This is the rung that turns
 *                          an unparseable surface into a search.
 *   3. the definition   -- dropped when it is a single token, i.e. a word already on screen
 *   4. the first part   -- hands over a prefix of the answer's letters, and the parts are 2-8
 *                          letters, so this is typically half the answer
 *   5. every part       -- THE COMPLETE SOLVE
 *
 * THE LETTER RUNG IS ABSENT HERE BECAUSE RUNG 4 SUBSUMES IT. The parts concatenate to the answer in
 * clue order -- verify step 10 -- so the first part's first letter IS the answer's first letter, plus
 * one to seven more. Shipping both would spend a hint on a character the very next rung repeats,
 * which is the "one hint delivered twice" shape a player named as the thing they hated most. This is
 * the only device where some other rung already contains the letter reveal, and it is the only device
 * that omits it.
 *
 * RUNG 5 SHIPS, AT THE BOTTOM, ON THE PRECEDENT ALREADY IN THIS FILE. The pool it replaced ended with
 * the fodder rung, which was ALSO a complete solve -- on an anagram the fodder IS the answer's
 * letters -- and it was emitted unconditionally, last. CLAUDE.md permits a giveaway "at the bottom of
 * the ladder or nowhere" and this design chose bottom, twice, for the same reason: a player who has
 * spent all three hints has said they want the answer. Because the pool takes the first three, rung 5
 * surfaces ONLY when the gloss and the definition rung have both dropped -- the shape with nothing
 * else left to give -- and it is rung THREE there, never rung one.
 *
 * WHY 4 IS BELOW 3, since both look like modest reveals: naming the definition tells the player which
 * clue words to look up, and the wordplay half remains a search over synonyms; naming the first part
 * spells letters of the answer that no amount of reading the clue produces, and on a two-part charade
 * it typically halves the puzzle. Letters beat labels here, which is the opposite of how the retired
 * `hidden` pool had to rank the same two shapes -- there the "label" rung quoted a fodder that
 * CONTAINED the answer.
 *
 * ---
 *
 * DELETION -- four entries, and NO DEVICE RUNG:
 *
 *   1. the gloss
 *   2. the definition   -- dropped when it is a single token
 *   3. the first letter -- UNCONDITIONAL
 *   4. the source word  -- THE COMPLETE SOLVE, and therefore last
 *
 * THE MISSING DEVICE RUNG IS NOT AN OMISSION. See DEVICE_RUNGS above: every deletion indicator names
 * its own operation, so the sentence would be a word off the player's screen on every clue.
 *
 * RUNG 4 IS A COMPLETE SOLVE because the indicator has ALREADY told the player what to remove --
 * `endless` says drop the last letter -- so handing over BRANDY hands over BRAND. That is why it sits
 * below every other entry even though it names one word where the definition rung quotes up to four.
 *
 * RUNG 3 SITS ABOVE THE LABEL AND BELOW THE GIVEAWAY, which is the placement the old appended floor
 * got wrong in both directions at once. It beats rung 2 because the definition rung RE-LABELS words
 * already printed on the clue -- it says which of two chunks defines the answer, on a clue that has
 * only two -- while a first letter is a character no reading of the surface produces and eliminates
 * most of the shortlist outright. It loses to rung 4 because a letter narrows the search and the
 * source word ENDS it: the removal is already named, so BRANDY is BRAND with one step of arithmetic.
 *
 * THE COMPLETE SOLVE IS NOW UNREACHABLE ON THE GENTLEST SHAPE, and that is the re-ranking paying for
 * itself rather than a rung going missing. A clue with a usable gloss and a multi-word definition
 * ships gloss, definition, letter and never names the source at all -- CLAUDE.md's "at the bottom of
 * the ladder or NOWHERE", taking the second branch on the shape that can afford it.
 *
 *   gloss survives + multi-word definition -> gloss, definition, letter        (3)
 *   gloss survives + one-word definition   -> gloss, letter, source            (3)
 *   gloss drops    + multi-word definition -> definition, letter, source       (3)
 *   gloss drops    + one-word definition   -> letter, source                   (2)
 *
 * ---
 *
 * DOUBLE DEFINITION -- three entries, and the letter rung is the STRONGEST of them:
 *
 *   1. the gloss
 *   2. the device       -- NEVER DROPS
 *   3. the first letter -- UNCONDITIONAL, and last
 *
 * NO QUOTING RUNG, AND THAT IS THE DEVICE RATHER THAN A GAP. Both halves are on screen, and neither
 * is distinguishable as "the definition" -- that is what makes it a double definition -- so quoting
 * one back returns nothing the player did not have, and quoting BOTH is the clue.
 *
 * THE LETTER RUNG OUTRANKS THE DEVICE SENTENCE HERE, AND ONLY HERE, and this is the one placement
 * that reads as backwards until it is worked out in the hand. A double definition's clue is TWO
 * STRAIGHT DEFINITIONS and nothing else -- no wordplay, no letters to operate on -- so a player given
 * the first letter has a definition, a length and a letter, which is a crossword clue and usually a
 * lookup. The device sentence is worth more than the gloss and less than that: it fixes the PARSE,
 * turning an unreadable surface into two definitions, and then leaves the solver to find the word.
 * Fixing a parse is worth a great deal on the device where recognizing it is most of the work, and it
 * is still not worth as much as handing over a character.
 *
 * SO THE SAME SENTENCE RANKS DIFFERENTLY ON TWO DEVICES and the letter rung ranks differently on
 * three, which is the whole argument for one pool per device rather than a shared order with
 * exceptions.
 *
 * ---
 *
 * THE QUOTING RUNG QUOTES A SLICE OF THE CLUE rather than pointing at one, and HintMetadata gains NO
 * MEMBER from this type. The asymmetry: a substring degrades to no highlight, an offset degrades to a
 * WRONG one -- and a wrong highlight on a cryptic clue points the player at the wrong half of the
 * puzzle, a rendering defect in another repo caused by a number this repo shipped. Quoting is safe
 * BECAUSE verify step 4 already proved each span occurs exactly once, which is the same proof a
 * highlight would have relied on, spent on the option whose failure is benign.
 *
 * It quotes THE CLUE, never a string the model handed over. The part and source rungs are the one
 * exception and they are not an exception to that rule: `text` on a CluePart is stored as
 * normalizeAnswer(model string) and verify step 10 pinned every letter of it against the answer, so
 * it is a string the letter math proved rather than one the model asserted.
 *
 * NEVER THROWS. Returns undefined with a logged reason instead.
 */
export const buildHints = (verified: VerifiedClue): HintLadder | undefined => {
  const { answer, clue, gloss } = verified
  if (answer.length < MIN_ANSWER_LENGTH || answer.length > MAX_ANSWER_LENGTH) {
    logError('Cryptic answer outside the shortlist band', { answer, reason: 'answer-not-on-shortlist' })
    return undefined
  }

  const slice = (span: ClueSpan): string => clue.slice(span.start, span.end)

  // THE UNION OF BOTH HALVES ON A DOUBLE DEFINITION, and it is the right input rather than a
  // convenience. gatedGloss's restates-the-definition rule filters this string to its substantive
  // tokens and rejects a gloss reusing any of them; on a device with TWO definitions a gloss must
  // lean on NEITHER, so the union is exactly the set to check against. Passing only the first half
  // would let a gloss restate the second one -- the half the player is likelier to be stuck on,
  // since the first is the one they have already tried to read as a definition.
  //
  // Derived rather than destructured: `definitionSpan` does NOT exist on every arm of VerifiedClue.
  // VerifiedDoubleDefinition carries `definitionSpans`, a readonly pair, which is what makes this a
  // switch on the discriminant rather than a field read.
  const definition =
    verified.device === 'doubledefinition'
      ? verified.definitionSpans.map(slice).join(' ')
      : slice(verified.definitionSpan)

  // ONCE, ABOVE THE POOLS. gatedGloss LOGS on every drop, so calling it inside each arm of the pool
  // switch would be three call sites emitting one line -- fine today, and a duplicate log the day
  // someone makes an arm evaluate two of them.
  const glossRung = gatedGloss(gloss, answer, definition, 'generator')

  // THE WORD THE PHRASE IS ABOUT, and on two of three devices it is a word verify PROVED is absent
  // from the clue -- a charade's parts and a deletion's source each carry `text` that "APPEARS NOWHERE
  // IN THE CLUE", in verify.ts's own words. That proof is what makes this rung a hint rather than a
  // pointer at the screen, and it is why the same rung cannot be built for a double definition, whose
  // halves are both printed: there the target is the answer itself and the gate carries the weight.
  //
  // THE FORBIDDEN TEXT IS THE CUE, for the same reason gatedGloss forbids the definition. A cue is the
  // clue words that already mean the target, so a phrase restating one hands back what the player is
  // reading. A double definition forbids both printed halves AND the gloss above it, because its two
  // model strings are both about the answer and a second angle repeating the first is one hint twice.
  const [wordTarget, forbidden]: [string, WordGlossForbids] =
    verified.device === 'charade'
      ? [verified.parts[0].text, { slices: [slice(verified.parts[0].cueSpan)] }]
      : verified.device === 'deletion'
        ? [verified.source.text, { slices: [slice(verified.source.cueSpan)] }]
        : [answer, { prose: glossRung, slices: verified.definitionSpans.map(slice) }]

  // COMPOSED FROM THE GATED PHRASE, never from the raw field, so a dropped phrase is an absent rung
  // rather than a frame wrapped around nothing.
  const gatedPhrase = gatedWordGloss(verified.wordGloss, wordTarget, answer, forbidden, 'generator')
  const wordGlossRung = gatedPhrase === undefined ? undefined : `${WORD_GLOSS_FRAMES[verified.device]}${gatedPhrase}.`

  // ONE CHARACTER OF THE ANSWER, and it is a POOL ENTRY rather than a floor pushed on below the pool.
  // Composed here, above the switch, because it is the one rung two of the three pools share and the
  // one whose RANK differs on every device -- absent on charade, third of four on deletion, last of
  // three on double definition. Written once so the three placements are visibly three placements of
  // the same string, which is what makes the ranking argument checkable.
  const letterRung = `${BEGINS_FRAME}${answer[0]}.`

  // THE POOL FOR THIS DEVICE. Weakest first, so taking a prefix preserves the escalation, and NOTHING
  // IS APPENDED AFTER THE PREFIX -- a rung that is not in the pool has not been ranked, and an
  // unranked rung is how the complete solve ended up above a letter reveal.
  //
  // Every arm ends with an UNCONDITIONAL entry, so no pool can be empty; that is what makes the
  // ladder's non-empty type honest rather than asserted. Every arm's last entry is also its strongest,
  // and taking a prefix carries that down: the SHIPPED ladder's last rung is the strongest rung that
  // survived. hints.test.ts asserts exactly that over all ten shapes -- naming the winner per shape
  // rather than deriving it, because a derivation would re-encode this order and agree with it.
  const pool = (
    verified.device === 'charade'
      ? [
          glossRung,
          wordGlossRung,
          `${FIRST_PART_FRAME}${verified.parts[0].text}.`,
          `${ALL_PARTS_FRAME}${verified.parts.map((part) => part.text).join(' + ')}.`,
        ]
      : verified.device === 'deletion'
        ? [glossRung, wordGlossRung, letterRung, `${SOURCE_FRAME}${verified.source.text}.`]
        : [glossRung, wordGlossRung, letterRung]
  ).filter((text): text is string => text !== undefined)

  // THE FIRST THREE, AND NEVER A FOURTH. A pool longer than the ladder is what lets a rung drop
  // without shortening the ladder -- CLAUDE.md requires drawing from one -- and taking a PREFIX is
  // what makes "weakest first" and "strongest last" the same statement.
  const texts = pool.slice(0, MAX_HINT_RUNGS)

  // A LADDER MAY BE SHORTER THAN THREE, and this gate is the LOWER BOUND rather than the count. Every pool
  // ends with an unconditional entry, so `pool` always holds at least one and this cannot fire -- it
  // is the code-defect gate on the property HintLadder's non-empty type depends on, so a future drop
  // rule over a pool's last entry becomes a logged rejection instead of an empty array that
  // typechecks.
  if (texts.length === 0) {
    logError('The cryptic rung pool ran dry', { available: texts.length, reason: 'rung-pool' })
    return undefined
  }

  // G1/G2/G3/G4 on the COMPOSED rung, through the only exported entry point to those rows. G4 is
  // re-run even though a quoted slice's tokens are a subset of the clue's, because the composition
  // adds tokens of its own. G5 is waived BY ROLE -- `answer` omitted, never passed empty -- and it
  // MUST stay waived now that a charade names its parts: those parts concatenate to the answer by
  // verify step 10, so the leak gate would reject every charade that reached it. Verify step 11's
  // inflection check over the whole clue is the replacement. G6 is not requested: a rung is not a
  // string the player types.
  //
  // THE GLOSS HAS ALREADY HAD G5 RUN OVER IT, in gatedGloss, with the answer supplied. This pass
  // re-runs G1-G4 over it harmlessly and must not be the place someone "unifies" the two: the waiver
  // here is what lets the part rungs exist, and applying it to the gloss would let a gloss name the
  // answer.
  const gated = texts.every((text) => passesStringGates({ maxLength: MAX_CRYPTIC_RUNG_LENGTH, value: text }))
  if (!gated) {
    logError('A cryptic rung failed the string gates', { reason: 'rung-gate', texts })
    return undefined
  }

  // MAPPED rather than spread into a literal. The old form named three indices, so a two-rung ladder
  // would have shipped `{ text: undefined }` as a third rung -- typechecking, rendering as an empty
  // hint, and telling nobody. The cast carries the non-emptiness the gate above just proved and the
  // type cannot infer through `map`.
  return texts.map((text) => ({ text })) as HintLadder
}
