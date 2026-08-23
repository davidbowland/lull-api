import { HintLadder } from '../../types'
import { log, logError } from '../../utils/logging'
import { containsAnswerToken, passesStringGates } from '../../utils/model-output-checks'
import { tellingIndicators } from './indicators'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, crypticInflections } from './verify'

// `The wordplay works on "X".` is 25 characters of frame and X is a slice of an already-length-gated
// clue, so the composed rung cannot exceed MAX_CLUE_LENGTH + 25 = 145 -- well inside the
// foundation's 200-character hint cap. ASSERTED rather than assumed, because "cannot bind" is a
// property of today's constants.
//
// 25 AND NOT 21: the fodder frame is four characters wider than `The definition is "X".`, and both
// quote a clue slice. Taking the narrower of the two would leave the wider rung ungated at its own
// worst case, which is the failure a cap exists to prevent.
export const MAX_CRYPTIC_RUNG_LENGTH = MAX_CLUE_LENGTH + 25

// THE CEILING, not the length. A cryptic ladder is ONE TO THREE rungs -- see HintLadder in types.ts
// for why the wire widened -- and this is the most buildHints will emit. Declared here rather than
// beside HintLadder because types.ts is a types-only module and may hold no runtime value; see the
// note there.
export const MAX_HINT_RUNGS = 3

// The gloss ships VERBATIM as a rung, so this is a rung cap and it is set where the other two
// code-built types set theirs -- MAX_ANAGRAM_RUNG_LENGTH and MAX_PHRAZLE_RUNG_LENGTH are both 80.
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

// DEVICE BEFORE DEFINITION -- the device is rung TWO, behind the gloss, and it is that pair's order
// the reversal settled: naming the definition hands the solver the WORDPLAY half by elimination, and
// the wordplay half of a hidden clue contains the answer's letters in order. That is nearly the
// whole solve. Naming the device tells the solver the mechanism without telling them where to look.
const DEVICE_RUNGS: Record<string, string> = {
  anagram: 'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
  hidden:
    "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
}

// The openings of the four composed rungs that are not the device sentence. CONSTANTS RATHER THAN
// INLINE LITERALS because isComposedRung below has to agree with the pool exactly, and two copies of
// `The answer ends with ` would be two things to keep in step.
const DEFINITION_FRAME = 'The definition is "'
const FODDER_FRAME = 'The wordplay works on "'
const ENDS_FRAME = 'The answer ends with '
const BEGINS_FRAME = 'The answer begins with '

/**
 * Whether a shipped rung was composed HERE, as opposed to written by the model.
 *
 * It exists for scripts/audit-cryptic.ts, which reads packs off the wire and has to tell a gloss
 * from a structural rung. The gloss carries NO METADATA -- this type ships none on any rung, and at
 * six bytes of headroom against its pack row it cannot afford to start -- so there is no tag to read
 * and the text is all there is.
 *
 * That is only sound because it reads THE POOL'S OWN CONSTANTS. A prefix table copied into the audit
 * would silently stop matching the day a template is reworded, and the audit would report every rung
 * as a gloss without failing anything.
 *
 * DIRECTIONAL, and the direction is the safe one: a gloss that happened to open with one of these
 * frames would be counted as structural and the gloss rate would read LOW. An audit that
 * under-reports its own supply prompts an investigation; one that over-reports hides a dead prompt.
 */
export const isComposedRung = (text: string): boolean =>
  Object.values(DEVICE_RUNGS).includes(text) ||
  [DEFINITION_FRAME, FODDER_FRAME, ENDS_FRAME, BEGINS_FRAME].some((frame) => text.startsWith(frame))

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
 * over every rung that quotes it. A gloss carries no such license: it is a sentence about the answer
 * and naming the answer is exactly the failure. Same module, same function, reversed polarity, and
 * the reason is the STRING'S ROLE rather than the puzzle type -- which is how passesStringGates
 * documents its own applicability.
 *
 * The inflection check is not redundant beside G5. That gate matches WHOLE TOKENS with no
 * stemming, so "penguins are flightless" leaks nothing by that test while handing the player the
 * answer. It is the same list verify step 11 runs over the clue.
 *
 * THE DEFINITION-REUSE RULE is the one new rule: definition "Bird" rejects "A bird that cannot fly"
 * and forces the model to find another angle.
 *
 * IT DOES NOT USE THE ANSWER-LEAK PREDICATE, which is the obvious fit and is BANNED IN THIS
 * DIRECTORY -- by an eslint rule on the import and by a source scan in imports.test.ts that rejects
 * the identifier anywhere in this file, comments included, so it is not named here. The ban exists
 * because a cryptic clue legitimately carries its answer's letters and that gate would reject every
 * valid hidden clue; it cannot tell that this call would have passed the DEFINITION rather than the
 * answer, and a guard that strict is worth more than the exception.
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
  // EXPECTED outcome, not a fault -- the ladder is still three rungs. The reason travels so the
  // prompt can be tuned by reading which gate fires, which is the same operation the indicator list
  // grows by.
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
 * Three rungs drawn from a six-entry pool: the first three that say something the player cannot
 * already read off their screen.
 *
 * THE RULE THIS ENFORCES, and it is the whole of the type's hint design: A RUNG THAT RESTATES THE
 * CLUE IS NOT A HINT. `Bird hidden in sharpen guinea (7)` used to spend its entire ladder telling
 * the player that the wordplay was a hidden word (the clue says `hidden in`), that the definition
 * was "Bird" (the first word), and that the answer had seven letters (the client renders the
 * enumeration beside the clue) -- three hints to deliver one letter. The cause was structural rather
 * than a bad template: every rung described the clue's SHAPE, and verify.ts constrains shape so
 * hard that shape is legible from the clue.
 *
 * The pool, in ladder order, weakest first so taking a prefix preserves the escalation:
 *
 *   1. the gloss         -- dropped when it fails gatedGloss, or the model supplied none
 *   2. the device        -- dropped when the indicator's own words name it (tellingIndicators)
 *   3. the definition    -- dropped when it is a single token, i.e. a word already on screen
 *   4. the last letter   -- always new
 *   5. the first letter  -- always new
 *   6. the fodder        -- always new, and the strongest, which is why it is last
 *
 * THE GLOSS IS THE ONLY RUNG ABOUT THE ANSWER; every other one is about the clue. That is what it is
 * for -- the five below it can only rearrange what is already on the player's screen, which is why
 * a clue that trips both drop rules had nothing left but a lookup. It is also the only rung this
 * type does not compose itself, so it is the only one that passes through a content gate before
 * shipping.
 *
 * IT IS FIRST ON STRENGTH, not on sympathy for a beginner. "Flightless, and more at home in the
 * water" leaves penguin, ostrich, emu, kiwi and rhea standing; "the wordplay is a hidden word" plus
 * the enumeration already on screen is a mechanical scan with one output. The mechanism rung is the
 * stronger of the two and goes second.
 *
 * THE FODDER RUNG IS THE STRONGEST RUNG IN THIS POOL ON BOTH DEVICES, AND IT IS THEREFORE LAST.
 * That is not obvious from its wording -- it names two words and reveals no letter -- and this pool
 * got it wrong twice in opposite directions before landing here.
 *
 * On `anagram` the fodder IS the answer: devicePredicates.anagram requires letter-multiset equality,
 * so quoting it hands over every letter, and the enumeration is already on screen. There is nothing
 * left to deduce but the ordering. On `hidden` verify proves the answer occurs exactly once in the
 * fodder, spanning a break, strictly inside the first and last tokens -- so `The wordplay works on
 * "instant angora".` reduces a five-letter answer to six candidate windows, one of which is a word.
 * Both are complete solves; a letter reveal is one character.
 *
 * THE TWO ERRORS THIS PARAGRAPH RECORDS, because each looked like a fix for the other. The FIRST
 * pool ranked the letter rungs at 3 and 4, above the fodder, which promoted a lookup to RUNG ONE
 * whenever both structural rules fired. The SECOND moved the letter rungs to the bottom and left the
 * fodder at 4 -- which promoted a DIFFERENT complete solve to rung one on the same clues, and shipped
 * that ladder in endpoints.rest as the worked example of the fix. Ranking by how much a rung LOOKS
 * like it says is what produced both. Rank by what it yields on the device in hand.
 *
 * On `anagram` the device rung can never drop -- tellingIndicators.anagram is deliberately empty --
 * so the fodder is reachable there only when the gloss and the definition rung both drop, which is
 * the shape with nothing else left to give. That is the right home for a giveaway.
 *
 * THE TWO DROP RULES ARE COMPLEMENTARY, and that is what makes dropping both at once safe. A
 * one-word definition is only obvious to a player who has found the indicator; when the indicator is
 * telling they have found it, and when it is not, the device rung survives and names the mechanism
 * they need in order to go looking. Neither rule is safe alone, and a future edit that keeps one and
 * deletes the other reopens the bug on the half it deletes.
 *
 * THE TWO QUOTING RUNGS QUOTE A SLICE OF THE CLUE rather than pointing at one, and HintMetadata gains NO
 * MEMBER from this type. The asymmetry: a substring degrades to no highlight, an offset degrades to
 * a WRONG one -- and a wrong highlight on a cryptic clue points the player at the wrong half of the
 * puzzle, a rendering defect in another repo caused by a number this repo shipped. Quoting is safe
 * BECAUSE verify step 4 already proved each span occurs exactly once, which is the same proof a
 * highlight would have relied on, spent on the option whose failure is benign.
 *
 * Both quote THE CLUE, never a string the model handed over: there is no second copy of the text
 * for a model to make disagree with the first.
 *
 * NEVER THROWS. Returns undefined with a logged reason instead.
 */
export const buildHints = (verified: VerifiedClue): HintLadder | undefined => {
  const { answer, clue, definitionSpan, device, fodderSpan, gloss, indicatorSpan } = verified
  if (answer.length < MIN_ANSWER_LENGTH || answer.length > MAX_ANSWER_LENGTH) {
    logError('Cryptic answer outside the shortlist band', { answer, reason: 'answer-not-on-shortlist' })
    return undefined
  }

  const definition = clue.slice(definitionSpan.start, definitionSpan.end)
  // Lowercased to meet the list, which is lowercase by its own invariant. Spans hold whole tokens
  // separated by single spaces -- step 1 guarantees it -- so this slice is exactly the entry shape
  // `crypticIndicators` is keyed on, and step 8 already matched the same string against it.
  const indicator = clue.slice(indicatorSpan.start, indicatorSpan.end).toLowerCase()

  // THE SUBSTANTIVE POOL -- every rung that says something about the puzzle rather than spelling a
  // letter of the answer. `fodder` is unconditional, so this is never empty, which is what makes the
  // ladder's non-empty type honest rather than asserted.
  const substantive = [
    // 'generator' because a gloss reaching HERE has already been gated by whichever caller built
    // this clue, so this arm logs only if that ever stops being true -- and if it does, the nightly
    // path is where it broke.
    gatedGloss(gloss, answer, definition, 'generator'),
    tellingIndicators[device].has(indicator) ? undefined : DEVICE_RUNGS[device],
    // A single-token definition is a word the player is already looking at; quoting it back returns
    // no characters they did not have. A multi-word one is real information -- WHICH words belong to
    // the definition is not readable off the clue.
    definition.includes(' ') ? `${DEFINITION_FRAME}${definition}".` : undefined,
    `${FODDER_FRAME}${clue.slice(fodderSpan.start, fodderSpan.end)}".`,
  ].filter((text): text is string => text !== undefined)

  // ONE LETTER RUNG, LAST, AND ONLY TO FILL A LADDER THAT WOULD OTHERWISE BE SHORT.
  //
  // A letter reveal is the least interesting thing this type can say and on a `hidden` clue it is
  // the whole solve, so it is a floor rather than a rung the ladder aims for: it appears only when
  // fewer than three substantive rungs survived, and never anywhere but the end. TWO of them in a
  // row -- which is what the pool emitted before -- is not a ladder, it is one hint delivered twice,
  // and it was the shape a player named as the thing they hated most.
  //
  // `begins with` rather than `ends with`, and the ENDS_FRAME constant survives ONLY because
  // isComposedRung reads it: packs written before this change carry that rung, and
  // scripts/audit-cryptic.ts has to keep recognizing it to read them. Nothing emits it any more.
  const texts = substantive.slice(0, MAX_HINT_RUNGS)
  if (texts.length < MAX_HINT_RUNGS) {
    texts.push(`${BEGINS_FRAME}${answer[0]}.`)
  }

  // A LADDER MAY BE SHORTER THAN THREE, and this gate is the floor rather than the count. `fodder`
  // is unconditional, so `substantive` always holds at least one and this cannot fire -- it is the
  // code-defect gate on the property HintLadder's non-empty type depends on, so a future drop rule
  // over the fodder rung becomes a logged rejection instead of an empty array that typechecks.
  if (texts.length === 0) {
    logError('The cryptic rung pool ran dry', { available: texts.length, reason: 'rung-pool' })
    return undefined
  }

  // G1/G2/G3/G4 on the COMPOSED rung, through the only exported entry point to those rows. G4 is
  // re-run even though the quoted slices' tokens are a subset of the clue's, because the composition
  // adds tokens of its own. G5 is waived BY ROLE -- `answer` omitted, never passed empty -- and it
  // MUST stay waived now that a rung quotes the fodder: a hidden clue's fodder contains the answer's
  // letters consecutively by construction, so the leak gate would reject every hidden clue that
  // reached it. Verify step 11's inflection check over the whole clue is the replacement. G6 is not
  // requested: a rung is not a string the player types.
  //
  // THE GLOSS HAS ALREADY HAD G5 RUN OVER IT, in gatedGloss, with the answer supplied. This pass
  // re-runs G1-G4 over it harmlessly and must not be the place someone "unifies" the two: the waiver
  // here is what lets the fodder rung exist, and applying it to the gloss would let a gloss name the
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
