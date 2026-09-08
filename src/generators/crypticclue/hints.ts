import { ClueSpan, HintLadder } from '../../types'
import { log, logError } from '../../utils/logging'
import { containsAnswerToken, passesStringGates } from '../../utils/model-output-checks'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, crypticInflections } from './verify'

// `The definition is "X".` is 21 characters of frame and X is a slice of an already-length-gated
// clue, so the composed rung cannot exceed MAX_CLUE_LENGTH + 21 = 141. ASSERTED rather than assumed,
// because "cannot bind" is a property of today's constants.
//
// 25 AND NOT 21, AND THE FOUR CHARACTERS ARE NOW SLACK. The number was set from the FODDER frame --
// `The wordplay works on "X".`, four characters wider -- and that rung died with the `anagram` and
// `hidden` devices it quoted. The definition rung is the only survivor that quotes a clue slice, so
// 21 is today's true worst case and 25 is a bound that provably cannot bind.
//
// KEPT AT 25 DELIBERATELY. A cap's job here is to be non-binding over every rung the pool can
// compose, and tightening it to the exact width of the widest frame makes the next frame -- one
// character wider, for a perfectly good reason -- a rejected clue rather than a rung that fits. The
// test asserts every composed rung fits the cap; it does not assert the cap is tight, because a tight
// cap is the failure mode, not the goal.
//
// EVERY OTHER FRAME INTERPOLATES ANSWER-SIZED TEXT, not a clue slice: a charade's parts concatenate
// to the answer (8 letters, at most 8 parts, ` + ` between them), a deletion's source is one letter
// longer than the answer, and the letter floor names one character. None can approach this cap.
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

/**
 * The mechanism sentence, for the two devices that have one worth saying.
 *
 * `deletion` HAS NO ENTRY, AND ITS ABSENCE IS THE DESIGN. Every deletion indicator names its own
 * operation -- `endless`, `beheaded`, `heartless` each say what to do to the letters -- which is why
 * tellingIndicators.deletion is the WHOLE indicator set rather than a curated subset of it. "The
 * wordplay is a deletion" therefore hands back a word already printed on the player's screen, on
 * every deletion clue this repo can build, without exception. Declaring the rung and dropping it
 * every time is a rung the pool pretends to have: it would report as a two-entry pool with a drop
 * rule that fires 100% of the time, and the ladder-length table below would be a lie about where the
 * rungs come from.
 *
 * That is also why this module no longer imports tellingIndicators at all. The list is still the
 * reason -- indicators.test.ts asserts deletion's telling set EQUALS its indicator set, and
 * hints.test.ts carries the row that fails if a quiet deletion indicator is ever added -- but the
 * consequence is now structural rather than evaluated per clue. A quiet indicator would mean this
 * table owes a `deletion` entry, and the test is what says so.
 *
 * THE OTHER TWO NEVER DROP, because neither device HAS an indicator (crypticIndicators.charade and
 * .doubledefinition are both empty by construction, not by omission). With no indicator on the page
 * there is nothing on the player's screen that names the mechanism, so the sentence is always new
 * information -- and on a double definition, where recognizing the device IS most of the solve, it is
 * the single most valuable thing this type can say.
 */
const DEVICE_RUNGS: Record<'charade' | 'doubledefinition', string> = {
  charade: 'The answer is built from two or more shorter words, one after the other.',
  doubledefinition: 'Both halves of the clue define the answer; there is no wordplay.',
}

// The openings of the five composed rungs that are not a device sentence. CONSTANTS RATHER THAN
// INLINE LITERALS because isComposedRung below has to agree with the pools exactly, and two copies of
// `The answer begins with ` would be two things to keep in step.
//
// ENDS_FRAME AND FODDER_FRAME ARE STRUCK. Both survived only so scripts/audit-cryptic.ts could read
// packs written before the rung that emitted them was retired; those packs are deleted in this
// migration, along with the `hidden` and `anagram` devices whose fodder the second one quoted, so
// there is no longer an archive for either frame to recognize.
const DEFINITION_FRAME = 'The definition is "'
const FIRST_PART_FRAME = 'The first part is '
const ALL_PARTS_FRAME = 'The answer is '
const SOURCE_FRAME = 'The wordplay starts from '
const BEGINS_FRAME = 'The answer begins with '

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
  Object.values(DEVICE_RUNGS).includes(text) ||
  [ALL_PARTS_FRAME, BEGINS_FRAME, DEFINITION_FRAME, FIRST_PART_FRAME, SOURCE_FRAME].some((frame) =>
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

  // A single-token definition is a word the player is already looking at; quoting it back returns no
  // characters they did not have. A multi-word one is real information -- WHICH words belong to the
  // definition is not readable off the clue. Shared by charade and deletion because it is the same
  // rung with the same drop rule; a double definition has no such rung at all.
  const definitionRung = definition.includes(' ') ? `${DEFINITION_FRAME}${definition}".` : undefined

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
          DEVICE_RUNGS.charade,
          definitionRung,
          `${FIRST_PART_FRAME}${verified.parts[0].text}.`,
          `${ALL_PARTS_FRAME}${verified.parts.map((part) => part.text).join(' + ')}.`,
        ]
      : verified.device === 'deletion'
        ? [glossRung, definitionRung, letterRung, `${SOURCE_FRAME}${verified.source.text}.`]
        : [glossRung, DEVICE_RUNGS.doubledefinition, letterRung]
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
