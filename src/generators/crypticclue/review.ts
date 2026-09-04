import { llmCrypticReviewPromptId } from '../../config'
import { invokeModel } from '../../services/bedrock'
import { getPromptById } from '../../services/dynamodb'
import { ToolSchema } from '../../types'
import { log, logError, logWarning } from '../../utils/logging'
import { isTransientModelFailure } from '../../utils/model-errors'
import { gatedGloss } from './hints'
import { VerifiedClue } from './verify'

/**
 * The second model call this type makes, and the FIRST check in this repo on whether a cryptic clue
 * means anything.
 *
 * IT IS NOT FOR THE GLOSS, whatever the gloss's arrival date suggests. verify.ts opens by naming the
 * hole this closes: "Nothing in this repo proves the definition means the answer. A clue whose
 * wordplay decomposes perfectly and whose definition points elsewhere is unsolvable by the intended
 * route and indistinguishable from a correct puzzle to every check here." Every one of the thirteen
 * verifier steps is a property of STRINGS. This is the only reader that can say whether "Bird"
 * defines PENGUIN, and shipping a clue whose definition does not is the worst failure this type has.
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
 * That matters because it is the premise of this call's token budget. review-cryptic-clues.txt is
 * sized at 8000 tokens against the eight-ish clues a normal night produces, not against forty. A run
 * that returned forty verifiable clues would truncate the response, and the degrade is the loud one:
 * bedrock.ts promotes a max_tokens stop reason to logError, extractModelPayload throws, and
 * reviewClues catches into 'Could not review cryptic clues; shipping the batch unreviewed'. So the
 * worst case is an unreviewed night with an ERROR line naming it, never a silently truncated review.
 * Slicing `itemsOf` to `asked` would make the bound real; it is NOT done here, because that changes
 * what the decomposition sees and belongs in a branch that says so.
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
    'alone, fix sets ONLY its gloss, drop removes it. Never rewrite the clue, the definition, the ' +
    'indicator, the fodder or the answer.',
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

// The floor below which a unanimous drop is taken at face value rather than treated as a malfunction.
// See the guard in reviewClues: this type reaches the reviewer with one to three clues on a normal
// night, so a no-floor guard overrode the reviewer precisely when it was most likely to be right.
const MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP = 4

const loggableReason = (reason: unknown): string | undefined =>
  typeof reason === 'string' ? reason.slice(0, MAX_REASON_LENGTH) : undefined

interface CrypticReviewResponse {
  verdicts: CrypticVerdict[]
}

// Exported for the reason services/review.ts exports VERDICTS: the tool description names these
// words in prose and the schema no longer names them at all, so a test is what ties the two
// together. Nothing in src/ imports it.
export const CRYPTIC_VERDICTS = new Set(['drop', 'fix', 'keep'])

/**
 * What the reviewer sees, and it is deliberately NOT the VerifiedClue.
 *
 * The spans are withheld because they are this repo's proof, not the reviewer's business -- it is
 * asked whether the definition MEANS the answer, and an offset cannot help it answer that. The
 * definition and fodder are sent as SLICES rather than as the model's original part strings, which
 * verify step 9 threw away: the reviewer must judge the decomposition that was proved, never a
 * second copy of it.
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
const getModelContext = (clues: VerifiedClue[]): Record<string, unknown> => ({
  clues: clues.map((clue, index) => ({
    answer: clue.answer,
    clue: clue.clue,
    definition: clue.clue.slice(clue.definitionSpan.start, clue.definitionSpan.end),
    device: clue.device,
    fodder: clue.clue.slice(clue.fodderSpan.start, clue.fodderSpan.end),
    gloss: clue.gloss,
    index,
  })),
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
 * `clue` is byte-identical to the string the verifier proved and both spans index it, so a reviewer
 * edit anywhere in it silently invalidates two offsets that still typecheck and still render
 * SOMETHING. The prompt says so; this is what makes it true regardless of what the prompt says.
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
  const definition = clue.clue.slice(clue.definitionSpan.start, clue.definitionSpan.end)
  const replacement = gatedGloss(verdict.gloss.trim(), clue.answer, definition, 'review')
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
      // unsolvable, and the reason is the only record of WHY -- which is what turns "cryptics are
      // hard" into a prompt change.
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
    // the reviewer approved everything also prints. The definition check would have stopped running
    // and the only alarm in this stack, a level="ERROR" subscription, would never have fired.
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
    // size this type actually produces and ship every clue the reviewer had condemned.
    //
    // The arithmetic: asked is count * CANDIDATES_PER_PUZZLE = 8, generator.ts opens by saying this
    // type has the lowest pass rate in the catalog and will reject more than two thirds, so a normal
    // night reaches the reviewer with ONE to THREE clues. At N=1 "the reviewer dropped everything" and
    // "the reviewer dropped the one clue whose definition does not mean its answer" are the same
    // event, and overriding it made the only semantic check in this repo inoperative at its most
    // common batch size -- for the one failure verify.ts names as unsolvable and undetectable.
    //
    // FOUR is where unanimity stops being ordinary. Below it the drops are honored and the type ships
    // nothing, which is a legal outcome for a bestEffort type; the logError still raises the alarm
    // either way, so the operator sees both cases and only one of them overrides the reviewer.
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
    // reachable -- the degraded path this catch exists for, with verify.ts's thirteen string gates
    // all still run. A reviewer that failed for any other reason still pages.
    const write = isTransientModelFailure(error) ? logWarning : logError
    write('Could not review cryptic clues; shipping the batch unreviewed', { error })
    return clues
  }
}
