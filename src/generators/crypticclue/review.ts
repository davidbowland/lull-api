import { llmCrypticReviewPromptId } from '../../config'
import { invokeModel } from '../../services/bedrock'
import { getPromptById } from '../../services/dynamodb'
import { ClueSpan, ToolSchema } from '../../types'
import { log, logError, logWarning } from '../../utils/logging'
import { isTransientModelFailure } from '../../utils/model-errors'
import { gatedGloss } from './hints'
import { VerifiedClue } from './verify'

/**
 * The second model call this type makes, and the ONLY check in this repo on whether a cryptic clue
 * means anything.
 *
 * IT IS NOT FOR THE GLOSS, whatever the gloss's arrival date suggests. verify.ts opens by naming the
 * hole this closes: "Nothing in this repo proves the definition means the answer, or that `vehicle`
 * means CAR. A clue whose wordplay decomposes perfectly and whose definition points elsewhere is
 * unsolvable by the intended route and indistinguishable from a correct puzzle to every check here."
 * Every one of the verifier's steps is a property of STRINGS.
 *
 * IT WENT FROM A DEFINITION CHECK TO THE LOAD-BEARING GATE, and the device change is what moved it.
 * `hidden` and `anagram` put the answer's letters in the clue: the surface handed them over, and the
 * one unprovable leaf was the definition. Every device that replaced them works on a word the solver
 * must SUPPLY FROM A SYNONYM -- a charade's `vehicle` yields CAR, a deletion's `spirit` yields
 * BRANDY -- and `text` appears nowhere in the clue, so no amount of reading the surface reaches it.
 * Code proves the letter arithmetic on those words; nothing in this system can tell whether the cue
 * means them. `doubledefinition` goes furthest and has no letter arithmetic at all: verify.ts says in
 * as many words that it is "the one device this file cannot defend on its own."
 *
 * So this call now answers three questions code cannot: does the definition mean the answer, does
 * every cue mean the letters it was proved to yield, and -- on a double definition -- are the two
 * halves genuinely different senses. A `keep` here is the whole of the meaning check.
 *
 * TYPE-LOCAL, and not an extension of services/review.ts. That module is Phrase-shaped end to end --
 * its verdicts carry `category`, `hints` and `familiarity`, its tool and prompt name phrases
 * throughout, and reviewPhrases returns Phrase[]. Admitting a second content type is a rewrite of it
 * rather than a parameter, and the two reviewers do not even run in the same Lambda: reviewPhrases
 * lives in CreatePhrasePuzzlesFunction and this runs in CreateModelPuzzlesFunction, which
 * services/lambda.ts invokes CONCURRENTLY and forbids anything from ordering. There is no
 * arrangement in which one call could have covered both.
 *
 * AFTER verifyClue, never before. Reviewing candidates the decomposition already rejected spends
 * Opus tokens on strings that will never ship.
 *
 * THE BATCH IS NOT BOUNDED AT EIGHT, and an earlier version of this comment said it was. `asked` is
 * a REQUEST, not a ceiling: crypticTool's schema carries no maxItems by design, `itemsOf` hands back
 * whatever array the model returned, and requestBatch iterates ALL of it -- it never truncates to
 * `count`, which is the very reason `asked` cannot bound anything. The real ceiling is the dedupe on
 * normalized answer in requestBatch: one clue per distinct shortlist word, so SHORTLIST_SIZE, forty.
 *
 * That matters because it is the premise of this call's token budget. A run that returned forty
 * verifiable clues would truncate the response, and the degrade is the loud one: bedrock.ts promotes
 * a max_tokens stop reason to logError, extractModelPayload throws, and reviewClues catches into
 * 'Could not review cryptic clues; shipping the batch unreviewed'. So the worst case is an unreviewed
 * night with an ERROR line naming it, never a silently truncated review. Slicing `itemsOf` to `asked`
 * would make the bound real; it is NOT done here, because that changes what the decomposition sees
 * and belongs in a branch that says so.
 *
 * ===========================================================================================
 * review-cryptic-clues.txt IS 16000 TOKENS, AND IT WAS 8000. THE DERIVATION, NOT THE NUMBER:
 * ===========================================================================================
 *
 * 8000 was set by ab70a10, "Size the model budget for the slowest generator, not the slowest call",
 * on two premises stated in its own message. BOTH ARE GONE, and one of them this branch deleted:
 *
 *   1. "GENERATOR_BUDGET_MS drops to 300_000, reserving 600s for the two-call generator." That
 *      reserve no longer exists. The fetches went CONCURRENT and GENERATOR_BUDGET_MS is 890_000,
 *      bounding the WRITE LOOP and nothing else -- create-model-puzzles.ts says so at length. The
 *      timeout risk the cut was half of was closed by concurrency, not by the token cap.
 *   2. "It returns at most eight short verdicts, so the rest was tail risk." That was true of the
 *      call it described and is FALSE of this one. It is the same eight short verdicts, but
 *      `thinking: { type: 'adaptive' }` means thinking and the tool call SHARE max_tokens, so what
 *      the cap actually bounds is REASONING -- and the reasoning per clue went from one judgment
 *      (does the definition mean the answer) to as many as five: the definition, up to three
 *      cue-to-letters links, and the fairness call on whether an ordinary solver reaches the synonym.
 *      Across a batch that is roughly fifteen judgments where it was three.
 *
 * WHY THIS WAS NOT LEFT TO MEASUREMENT, which was the first recommendation and was overridden: the
 * cost is asymmetric and no amount of data changes that. `doubledefinition` has an EMPTY derivation
 * arm in verify.ts by design -- "a doubledefinition HAS NOTHING TO DERIVE, and that is the device" --
 * so for that device this call IS the verification. A max_tokens stop returns content [thinking] and
 * no tool_use block, this module catches, and the batch ships with nothing behind it but the cover
 * theorem and a lexicon check. Being wrong high costs wall clock; being wrong low ships a puzzle no
 * check in this system ever read. Waiting for the second outcome to show up in a log is not a
 * measurement strategy.
 *
 * WHAT IT COSTS, against bedrock.ts's own measured figure and not a guess. That file has exactly ONE
 * wall-clock measurement -- 16000 output tokens in 204s, ~78 tok/s, measured on create-phrases and
 * extrapolated here with the same warning it carries: tokens-per-second is not linear in maxTokens.
 * On that figure the ceiling moves ~102s, and the fetch phase -- crypticclue's fetchCandidates is TWO
 * SERIAL calls -- goes from ~512s (410 + 102) to ~614s (410 + 204) against GENERATOR_BUDGET_MS of
 * 890 and a Lambda Timeout of 900. It fits, with ~276s of headroom.
 *
 * AND THE CEILING IS NOT THE COST. maxTokens is a CAP, not a spend: the 204s was a run that actually
 * PRODUCED 16000 tokens because it hit max_tokens. A healthy review spends a few hundred tokens of
 * verdict plus its reasoning and finishes in the same time at either cap. The ~102s is paid only on
 * the runaway -- which is exactly the run that returns nothing at 8000. The extra headroom is bought
 * with wall clock that a healthy night never spends.
 *
 * WHAT IT NARROWS, stated because it is the one thing that genuinely got worse. bedrock.ts sets
 * maxAttempts 4 and an attempt RE-RUNS the call rather than resuming it. A night with one retried
 * review was 410 + 102 + 102 = ~614s and is now 410 + 204 + 204 = ~818s -- still inside 890, but on
 * ~72s rather than ~276s. TWO retried reviews (~1022s) now exceed the Lambda Timeout where they
 * previously did not. That is a narrowing of an ALREADY-UNBOUNDED risk rather than a new one:
 * create-model-puzzles.ts already records that a single retried create-cryptic-clues is ~820s on its
 * own and that "no budget here can stop it". The fix, if the logs ever show one, is the client with
 * its own maxAttempts that comment names -- not a smaller cap on the only meaning check this type has.
 *
 * WHAT TO READ BEFORE MOVING IT AGAIN: thinkingTokens / maxTokens on this call, which logModelUsage
 * now reports on every invocation. bedrock.ts's rule from the phrase generator applies unchanged --
 * "a request that needs 78% of its ceiling on a good run is one bad run from returning nothing".
 * If this call settles well under that, the next move is DOWNWARD and it is measured, not guessed.
 */

// One call per batch, not per clue: cheaper, and only a batch-wide view catches two clues that lean
// on the same trick. The per-verdict fields are described HERE and not in the schema, for the reason
// crypticTool gives -- an element is opaque to ajv, and any keyword below the batch key fails the
// whole review over one malformed verdict.
export const crypticReviewTool: ToolSchema = {
  description:
    'Return one verdict per clue, addressed by its 0-based index. Each element is an object with: ' +
    '`index`, the 0-based position of the clue this verdict addresses; `verdict`, one of "keep", ' +
    '"fix" or "drop"; optionally `gloss` on a fix -- a replacement for the one shown, or a NEW one ' +
    'where the clue carries no `gloss` field at all; and optionally `reason`. keep leaves the clue ' +
    'alone, fix sets ONLY its gloss, drop removes it. Judge the meaning code cannot: on a charade, ' +
    "whether `definition` means `answer` and whether each `parts` entry's `cue` means its `text`; " +
    'on a deletion, whether `definition` means `answer` and whether `source.cue` means ' +
    '`source.text`, the word the stated `removal` was applied to; on a double definition, whether ' +
    'both `definitions` define `answer` IN DIFFERENT SENSES. A cue that does not mean its word is a ' +
    'drop. Never rewrite the clue, the definition, the definitions, the parts, the source, the ' +
    'indicator or the answer.',
  input_schema: {
    properties: {
      // items: {} -- opaque, exactly as in crypticTool, and for the identical measured reason.
      verdicts: { items: {}, type: 'array' },
    },
    required: ['verdicts'],
    type: 'object',
  },
  name: 'submit_cryptic_review',
}

interface CrypticVerdict {
  gloss?: unknown
  index: number
  // `unknown`, not `string`, because the schema no longer requires OR types it: `items: {}` is
  // opaque to ajv, so a model returning an object or a four-kilobyte essay here typechecks. It only
  // reaches a log line, but CLAUDE.md's input rule is about the string's PROVENANCE rather than its
  // destination, and this was the last model-authored value on this path with no bound at all.
  reason?: unknown
  verdict: 'keep' | 'fix' | 'drop'
}

// A CloudWatch field is still a destination. Bounded and type-checked at the two sites that log it,
// rather than at the boundary, because a reason that fails this is not worth rejecting a verdict
// over -- the verdict is the decision, the reason is the note attached to it.
const MAX_REASON_LENGTH = 200

/**
 * The floor below which a unanimous drop is taken at face value rather than treated as a malfunction.
 *
 * IT WAS 4, AND 4 WAS DERIVED FROM A PREMISE THAT NO LONGER HOLDS. The comment here asserted
 * "`asked` is count * CANDIDATES_PER_PUZZLE = 8 ... so a normal night reaches the reviewer with ONE
 * to THREE clues". `countPerDay` is 2, so `asked` is SIXTEEN, and the range that justified putting
 * the floor at 4 was computed against half the real request. The constant outlived its derivation --
 * which is why this is written as a derivation from today's constants rather than as a number.
 *
 * THE ARITHMETIC, FROM THE CONSTANTS AS THEY STAND:
 *
 *   `asked` = count * CANDIDATES_PER_PUZZLE = 2 * 8 = 16.
 *
 *   `asked` IS A REQUEST, NOT A CEILING. crypticTool's schema carries no maxItems by design, itemsOf
 *   hands back whatever array the model returned, and requestBatch iterates ALL of it -- it never
 *   truncates to `count`. The real bound is requestBatch's dedupe on normalized answer: one clue per
 *   distinct shortlist word, so SHORTLIST_SIZE, FORTY. Any reasoning that treats 16 as the ceiling is
 *   reasoning about a bound this code does not have.
 *
 *   generator.ts sizes the over-ask against the pass rate in as many words: "REQUEST_MULTIPLIER = 3
 *   in the phrase handler tolerates rejecting two thirds, and this rejects more than that."
 *   Sixteen returned, more than two thirds rejected, gives a verified batch of about FIVE
 *   or fewer -- and the synonym devices reject harder than the devices that estimate was written
 *   for: `parts-out-of-order`, `ambiguous-removal`, `definitions-not-distinct` and a
 *   `unknown-part-word` that now runs over every cue token AND every part text are all codes that
 *   did not exist when it was made.
 *
 * SO 4 SITS INSIDE THE ORDINARY RANGE RATHER THAN ABOVE IT, and that is the wrong side to be on. The
 * guard's ACTION when it fires is to OVERRIDE the reviewer and ship every clue it condemned -- on the
 * devices where this call is the entire verification. A floor that fires on a batch size the type
 * routinely produces is not a safety net; it is a switch that turns the meaning check off on ordinary
 * nights.
 *
 * THE SHARPER REASON THE FLOOR HAD TO MOVE, and it is about what reaches this guard at all. The
 * malfunction the floor was built for -- a reviewer returning garbage -- is ALREADY CAUGHT one branch
 * up: verdicts keyed `clueIndex`, bare strings, an empty array, anything indexVerdicts cannot address,
 * all land in `unjudged === clues.length`, ship unreviewed and raise their own ERROR without
 * overriding any judgment. What survives to this guard is N verdicts that are well formed, in range,
 * uniquely addressed and say "drop". THAT IS NOT A MALFUNCTION SIGNATURE. It is a working reviewer on
 * a bad batch, and the prompt tells it in as many words that "dropping is cheap".
 *
 * EIGHT, AND IT IS CANDIDATES_PER_PUZZLE RATHER THAN A ROUND NUMBER. That constant is the over-ask
 * ratio -- the candidates this type buys per puzzle -- so a VERIFIED batch reaching 8 means the pass
 * rate cleared 50% on a type whose own generator says it will reject more than two thirds. At that
 * size unanimity is genuinely surprising and the override is defensible; below it, it is Tuesday.
 * Reading the floor as "the over-ask ratio" is also what keeps it from going stale again: if
 * CANDIDATES_PER_PUZZLE moves, the batch moves with it and so does the number this should be.
 *
 * NOT IMPORTED, deliberately. generator.ts imports this module, so importing CANDIDATES_PER_PUZZLE
 * back would be a cycle. The derivation is written here and
 * __tests__/unit/generators/crypticclue/review.test.ts holds it from the other end -- a row per batch
 * size from 1 to 7 asserting the drops are HONORED, which is what fails if someone lowers this again.
 *
 * BELOW THE FLOOR THE TYPE SHIPS NOTHING, which is a legal outcome for a bestEffort type -- isComplete
 * skips it and the pack still reads complete. The logError fires either way, so an operator sees both
 * cases and only one of them overrides the reviewer.
 */
const MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP = 8

const loggableReason = (reason: unknown): string | undefined =>
  typeof reason === 'string' ? reason.slice(0, MAX_REASON_LENGTH) : undefined

interface CrypticReviewResponse {
  verdicts: CrypticVerdict[]
}

// Exported for the reason services/review.ts exports VERDICTS: the tool description names these
// words in prose and the schema no longer names them at all, so a test is what ties the two
// together. Nothing in src/ imports it.
export const CRYPTIC_VERDICTS = new Set(['drop', 'fix', 'keep'])

// Reads the CLUE through a span, never a second copy of the text. One helper because every slice
// below is the same operation and a hand-written `.slice(span.start, span.end)` per device is three
// chances to transpose the two.
const sliceOf = (clue: string, span: ClueSpan): string => clue.slice(span.start, span.end)

/**
 * WHAT THE REVIEWER SEES, and it is deliberately NOT the VerifiedClue.
 *
 * SHAPED PER DEVICE, because the three devices do not have the same parts and a union of every field
 * any of them carries would send a double definition an empty `parts` and a charade a `removal` it
 * has no use for. The prompt asks a different question of each -- three worked examples, one per
 * device -- so the payload names exactly what that device's question is about:
 *
 *   charade          -- `definition`, and `parts` as {cue, text}: does each cue yield those letters?
 *   deletion         -- `definition`, `removal`, and `source` as {cue, text}: does the cue mean the
 *                       longer word the removal was proved to run on?
 *   doubledefinition -- `definitions`, both halves, and nothing else. No definition, no parts, no
 *                       indicator: the device has no wordplay half, so there is no cue to judge and
 *                       neither half is "the" definition.
 *
 * `text` IS THE PROVED LETTERS AND IS NOT A SLICE, and that asymmetry with `cue` is the whole reason
 * this call got harder. A cue is clue words, so it has a span; `text` appears NOWHERE in the clue --
 * that is what makes these devices under-determined and what makes the cue-to-text link the only
 * unprovable step. It is copied from VerifiedClue, where verify step 9 stored it normalized, so the
 * string the reviewer judges is byte-identical to the one the letter arithmetic ran on.
 *
 * THE SPANS ARE WITHHELD because they are this repo's proof, not the reviewer's business -- it is
 * asked whether a cue MEANS a word, and an offset cannot help it answer that.
 *
 * CUES AND DEFINITIONS ARE SENT AS SLICES of the proved clue, never as the model's original part
 * strings, which verify step 9 threw away: the reviewer must judge the decomposition that was proved,
 * never a second copy of it. That was true when the fodder was the thing being sliced and it did not
 * die with the fodder -- it is now true once per cue, so there are more places for a second copy to
 * disagree rather than fewer.
 *
 * `gloss` ARRIVES PRE-GATED AND MAY BE ABSENT. generator.ts's `accept` replaces it with its gated
 * value before this module is reached, so what is copied here is exactly the rung the player would
 * have seen -- and a gloss the gates dropped is `undefined`, which JSON.stringify OMITS. The
 * reviewer therefore receives a clue object with no `gloss` key at all rather than a null or an
 * empty string, which is the shape the prompt's ABSENT bullet is written against and the reason its
 * `fix` can CREATE the rung instead of only replacing one. Sending `gloss: clue.gloss ?? ''` here
 * would satisfy the type and quietly turn that bullet into a description of something the model
 * never sees.
 */
const clueContext = (clue: VerifiedClue, index: number): Record<string, unknown> => {
  const base = { answer: clue.answer, clue: clue.clue, device: clue.device, gloss: clue.gloss, index }

  if (clue.device === 'charade') {
    return {
      ...base,
      definition: sliceOf(clue.clue, clue.definitionSpan),
      parts: clue.parts.map((part) => ({ cue: sliceOf(clue.clue, part.cueSpan), text: part.text })),
    }
  }

  if (clue.device === 'deletion') {
    return {
      ...base,
      definition: sliceOf(clue.clue, clue.definitionSpan),
      // THE REMOVAL TRAVELS THOUGH THE REVIEWER DOES NOT JUDGE IT. It is a closed union verify.ts
      // proved by running applyRemoval, so re-checking it is the re-checking the prompt's overview
      // forbids. It is here because `source.text` is the word BEFORE the removal, and without which
      // end came off, "does `spirit` mean BRANDY" is being asked about a word the reviewer cannot
      // reconstruct from the answer it is shown.
      //
      // The INDICATOR is NOT sent, and that is the same rule read the other way: which words signal
      // the removal is a committed-list membership verify step 8 decided, and the reviewer is told it
      // may not rewrite it precisely because it has no business forming a view. `indicatorSpan` is
      // not a wire field either -- endpoints.rest says so -- and this is not the place it becomes one.
      removal: clue.removal,
      source: { cue: sliceOf(clue.clue, clue.source.cueSpan), text: clue.source.text },
    }
  }

  return { ...base, definitions: clue.definitionSpans.map((span) => sliceOf(clue.clue, span)) }
}

const getModelContext = (clues: VerifiedClue[]): Record<string, unknown> => ({
  clues: clues.map(clueContext),
})

// Addressed by index, never by clue text: matching on text is fragile the moment a model re-cases or
// re-punctuates it, and this clue's text is the one string in the repo that must not be re-cased.
const indexVerdicts = (clues: VerifiedClue[], verdicts: CrypticVerdict[]): Map<number, CrypticVerdict> => {
  const byIndex = new Map<number, CrypticVerdict>()
  for (const verdict of verdicts ?? []) {
    const isAddressable =
      Number.isInteger(verdict?.index) &&
      verdict.index >= 0 &&
      verdict.index < clues.length &&
      !byIndex.has(verdict.index) &&
      // The verdict WORD, checked here because the schema no longer checks it. Without this an
      // unrecognized or non-string verdict falls through into a silent keep -- a reviewer's `drop`
      // arriving as `"DROP"` would quietly ship a clue it judged unsolvable.
      typeof verdict.verdict === 'string' &&
      CRYPTIC_VERDICTS.has(verdict.verdict)
    if (isAddressable) {
      byIndex.set(verdict.index, verdict)
      continue
    }
    log('Ignored an unusable cryptic verdict', { index: verdict?.index, verdict: verdict?.verdict })
  }
  return byIndex
}

/**
 * A fix replaces the GLOSS AND NOTHING ELSE.
 *
 * `clue` is byte-identical to the string the verifier proved and EVERY span on the clue indexes it --
 * a definition span, a cue span per part, a deletion's indicator span -- so a reviewer edit anywhere
 * in it silently invalidates a set of offsets that still typecheck and still render SOMETHING. The
 * count of them grew with the device set; the argument did not change. The prompt says so; this is
 * what makes it true regardless of what the prompt says.
 *
 * THE GATE RUNS OVER EVERY DEFINITION THE DEVICE HAS. gatedGloss's restatement check splits its
 * `definition` argument on spaces and drops connectives, so a double definition's two halves joined
 * by a space give it exactly the union of both halves' substantive tokens -- which is what the
 * prompt's "on a doubledefinition this applies to BOTH halves: the gloss may restate neither"
 * requires. Passing one half would gate the replacement against half the words already on screen.
 *
 * The replacement re-runs gatedGloss -- the same gates the original FACED, which is not the same as
 * the gates it passed. Since generator.ts gates before this module reads the clue, the original may
 * have FAILED them and arrived `undefined`, and that is the case a fix is most worth having: it
 * creates the type's only semantic rung rather than replacing one. A reviewer that correctly spots a
 * weak gloss and then writes a worse one must not be able to ship it either way, and a replacement
 * that fails falls back to whatever the clue already had -- a gloss or none -- rather than dropping
 * the clue: the reviewer kept the clue, and only the gloss was in question.
 *
 * LOGGED ON SUCCESS, for the reason services/review.ts gives at its own fix: a third of
 * review-cryptic-clues.txt is gloss instruction, and without this line a night where the reviewer
 * rewrote every gloss and a night where it rewrote none produce identical logs -- so the instruction
 * costs tokens and buys nothing measurable. The reason travels because it is the only record of WHY
 * a shipped rung is not the one the generator wrote.
 *
 * ONE MESSAGE NAME, `Applied a cryptic fix`, WITH THE OUTCOME IN `outcome` -- the rule
 * services/model-batch.ts states for `Rejected an item` and gives the query for: an Insights lookup
 * is `filter message = "Applied a cryptic fix" | stats count() by outcome` rather than a union of
 * three strings that drift apart. This function decides ONE thing three ways, so it is one line.
 * `created` is called out separately from `replaced` because the prompt calls the create case the
 * most valuable fix available and it is the only outcome that ADDS a rung -- counting it inside
 * `replaced` would make the number the prompt is tuned against unreadable, and the word "replaced"
 * is literally false when there was nothing to replace.
 */
const applyFix = (clue: VerifiedClue, verdict: CrypticVerdict): VerifiedClue => {
  if (typeof verdict.gloss !== 'string') {
    log('Applied a cryptic fix', { answer: clue.answer, outcome: 'no-replacement' })
    return clue
  }
  const definitions =
    clue.device === 'doubledefinition'
      ? clue.definitionSpans.map((span) => sliceOf(clue.clue, span))
      : [sliceOf(clue.clue, clue.definitionSpan)]
  const replacement = gatedGloss(verdict.gloss.trim(), clue.answer, definitions.join(' '), 'review')
  if (replacement === undefined) {
    // `fallback` because there is not always an original to keep. `none` is the case the gate move
    // made reachable -- the clue's own gloss was dropped, the reviewer's replacement fails too, and
    // the ladder ships with no semantic rung at all. Reporting that as a gloss "kept" described a
    // string that does not exist and hid the outcome most worth counting.
    log('Applied a cryptic fix', {
      answer: clue.answer,
      fallback: clue.gloss === undefined ? 'none' : 'original',
      outcome: 'rejected',
    })
    return clue
  }
  // A REPLACEMENT EQUAL TO THE ORIGINAL IS NOT A FIX, and this is the arm where that is decided.
  // `gatedGloss` returns its input on success and applyFix spreads unconditionally, so a reviewer
  // returning the gloss it was already shown -- or one differing only in the whitespace `.trim()`
  // collapses -- yields a NEW OBJECT holding the SAME string. An identity test upstream counts that
  // as a fix and logs one, while generator.ts's rebuild guard compares gloss VALUES and correctly
  // ships nothing new: a night reported as "the gloss instruction is working" in which no shipped
  // byte differs.
  if (replacement === clue.gloss) {
    log('Applied a cryptic fix', { answer: clue.answer, outcome: 'unchanged' })
    return clue
  }
  log('Applied a cryptic fix', {
    answer: clue.answer,
    outcome: clue.gloss === undefined ? 'created' : 'replaced',
    reason: loggableReason(verdict.reason),
  })
  return { ...clue, gloss: replacement }
}

// Returns the count alongside the clues rather than letting reviewClues recompute it. applyFix
// returns the clue it was handed on every arm that changed nothing -- including a replacement equal
// to the original -- so identity here means exactly "the gloss that will ship is not the one the
// generator wrote", which is the same question generator.ts's rebuild guard asks of the gloss VALUE.
// The two agree because applyFix, not this line, is where value equality is decided.
const applyVerdicts = (
  clues: VerifiedClue[],
  verdicts: CrypticVerdict[],
): { fixed: number; kept: VerifiedClue[]; unjudged: number } => {
  const byIndex = indexVerdicts(clues, verdicts)
  const kept: VerifiedClue[] = []
  let fixed = 0
  let unjudged = 0

  for (const [index, clue] of clues.entries()) {
    const verdict = byIndex.get(index)
    if (verdict === undefined) {
      unjudged += 1
      kept.push(clue)
      continue
    }
    if (verdict.verdict === 'drop') {
      // The line this whole call exists to produce. A dropped clue is one the reviewer judged
      // unsolvable -- a definition that does not mean the answer, a cue that does not mean its
      // letters, a double definition written twice in one sense -- and the reason is the only record
      // of WHICH -- which is what turns "cryptics are hard" into a prompt change. The reason matters
      // more per device than it did: three devices fail three different ways and the counts are
      // identical without it.
      log('Reviewer dropped a cryptic clue', {
        answer: clue.answer,
        clue: clue.clue,
        reason: loggableReason(verdict.reason),
      })
      continue
    }
    if (verdict.verdict === 'fix') {
      const applied = applyFix(clue, verdict)
      // COUNTS WHAT WAS APPLIED, not what the reviewer asked for. A fix that arrives with no
      // replacement, or whose replacement fails re-gating, leaves the ladder exactly as the
      // generator wrote it -- and a `fixed` figure that counted those would report the gloss
      // instruction working on nights it did nothing, which is the reading this line exists to make
      // impossible.
      fixed += applied === clue ? 0 : 1
      kept.push(applied)
      continue
    }
    kept.push(clue)
  }

  if (unjudged > 0) {
    log('Kept cryptic clues the reviewer returned no verdict for', { count: unjudged })
  }
  return { fixed, kept, unjudged }
}

/**
 * Audits verified clues and returns the ones worth shipping.
 *
 * Catches its own errors and returns its input unchanged, exactly as reviewPhrases does. The caller
 * gets no signal distinguishing "reviewed and kept everything" from "review threw" -- deliberately,
 * because its behavior is identical either way and the logError is what raises the alarm.
 */
export const reviewClues = async (clues: VerifiedClue[]): Promise<VerifiedClue[]> => {
  if (clues.length === 0) {
    return []
  }

  try {
    const prompt = await getPromptById(llmCrypticReviewPromptId)
    const { verdicts } = await invokeModel<CrypticReviewResponse>(prompt, crypticReviewTool, getModelContext(clues))

    const { fixed, kept: reviewed, unjudged } = applyVerdicts(clues, verdicts)
    // THE SYMMETRIC CASE TO THE ALL-DROPPED GUARD BELOW, and without it the more likely of the two
    // failures was the silent one. `indexVerdicts` correctly ignores a verdict it cannot address --
    // a model keying them `clueIndex`, returning 1-based indices, or returning bare strings, all of
    // which the opaque `items: {}` schema admits -- but every clue then falls through to `unjudged`,
    // is kept, and the line below prints `dropped: 0, fixed: 0`, which is what a healthy night where
    // the reviewer approved everything also prints. The MEANING check -- every one of it, since
    // nothing else in the repo makes one -- would have stopped running and the only alarm in this
    // stack, a level="ERROR" subscription, would never have fired.
    //
    // NOT A GUARANTEE AGAINST A MISADDRESSED BATCH. A 1-based reviewer produces indices 1..N-1 that
    // ARE in range, so those verdicts apply to the wrong clue and this counter never rises. That is
    // unfixable from here without guessing at the model's intent; it is named so the next reader
    // knows this guard covers the unaddressable case and not the misaddressed one.
    if (unjudged === clues.length) {
      logError('Reviewer judged no cryptic clue; keeping the batch unreviewed', { count: clues.length })
      return clues
    }
    // A UNANIMOUS DROP IS ONLY SUSPICIOUS ON A BATCH BIG ENOUGH FOR UNANIMITY TO BE SURPRISING, and
    // the first version of this guard had no floor at all -- which made it fire on exactly the batch
    // size this type actually produces and ship every clue the reviewer had condemned. The second
    // version had a floor of 4, derived against an `asked` of 8 that had already become 16.
    //
    // THE FLOOR AND ITS DERIVATION LIVE ON MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP, from today's
    // constants rather than from the ones that were true when it was first written. The short of it:
    // `asked` is 16, the real bound is SHORTLIST_SIZE rather than `asked`, the verified batch is
    // about five or fewer, and what reaches THIS branch is always a set of well-formed addressable
    // verdicts -- the garbage case is caught by the `unjudged` guard above without overriding
    // anything. So the floor is the over-ask ratio, 8.
    //
    // At N=1 "the reviewer dropped everything" and "the reviewer dropped the one clue whose cue does
    // not mean its letters" are the same event, and overriding it makes the only meaning check in
    // this repo inoperative -- for the failures verify.ts names as unsolvable and undetectable, on a
    // device whose derivation arm is empty by design.
    //
    // Below the floor the drops are honored and the type ships nothing, which is a legal outcome for
    // a bestEffort type; the logError still raises the alarm either way, so the operator sees both
    // cases and only one of them overrides the reviewer.
    if (reviewed.length === 0 && clues.length >= MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP) {
      logError('Reviewer dropped every cryptic clue; keeping the batch unreviewed', { count: clues.length })
      return clues
    }
    if (reviewed.length === 0) {
      logError('Reviewer dropped every cryptic clue; shipping none of them', { count: clues.length })
      return []
    }

    // `fixed` beside `dropped` and `kept` because the three are the whole verdict distribution, and
    // a gloss rewrite is the one outcome that changes what ships WITHOUT changing any count. Read
    // against the prompt's gloss section it is the cheap answer to whether that third of the
    // instruction is earning its tokens.
    // `unjudged` rides along because partial garbage is invisible without it: five clues, three
    // verdicts the reviewer could not address, and the other three counts still look ordinary.
    log('Reviewed cryptic clues', {
      dropped: clues.length - reviewed.length,
      fixed,
      kept: reviewed.length,
      unjudged,
    })
    return reviewed
  } catch (error: unknown) {
    // Not `log`: the caller otherwise returns normally, and shipping an unreviewed clue whose
    // definition nothing has checked is worth saying out loud. But the LEVEL follows the cause, as
    // it does in services/review.ts one lane over. A Bedrock 503 means the reviewer was never
    // reachable -- the degraded path this catch exists for, with every one of verify.ts's string
    // gates still run. A reviewer that failed for any other reason still pages.
    //
    // THE DEGRADE IS WORSE THAN IT WAS, and the level split is not the place to say so. Shipping
    // unreviewed once meant shipping a definition nothing had read; it now also means shipping a
    // charade whose `vehicle` may yield CAT and a double definition with no letter arithmetic behind
    // it at all. Still a WARN on a 503, because the alternative -- the type shipping nothing whenever
    // Bedrock throttles -- costs more days than it saves, and the audit script is the measurement.
    const write = isTransientModelFailure(error) ? logWarning : logError
    write('Could not review cryptic clues; shipping the batch unreviewed', { error })
    return clues
  }
}
