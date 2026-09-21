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
 * means anything. Every step of verify.ts is a property of STRINGS: nothing there proves the
 * definition means the answer, or that `vehicle` means CAR.
 *
 * It answers three questions code cannot: does the definition mean the answer, does every cue mean
 * the letters it was proved to yield, and on a double definition are the two halves genuinely
 * different senses.
 *
 * Type-local rather than an extension of services/review.ts, which is Phrase-shaped end to end and
 * runs in a different Lambda (CreatePhrasePuzzlesFunction, invoked concurrently with this one).
 *
 * AFTER verifyClue, never before: reviewing candidates the decomposition already rejected spends
 * Opus tokens on strings that will never ship.
 *
 * `asked` DOES NOT BOUND THE BATCH. crypticTool's schema carries no maxItems and requestBatch never
 * truncates to `count`; the real ceiling is its dedupe on normalized answer, so SHORTLIST_SIZE.
 *
 * review-cryptic-clues.txt carries maxTokens 16000, and `thinking: { type: 'adaptive' }` makes
 * thinking and the tool call share it, so the cap bounds REASONING -- up to five judgments per
 * clue. The cost is asymmetric: too high costs wall clock, too low returns no tool_use block and
 * an unreviewed batch, on devices where this call IS the verification. On bedrock.ts's one
 * measurement (16000 tokens in 204s), two serial calls put the ceiling at ~614s against
 * GENERATOR_BUDGET_MS of 890 and a Lambda timeout of 900, and maxAttempts of 4 re-runs rather than
 * resumes, so two retried reviews exceed the timeout. Before moving this, read
 * thinkingTokens / maxTokens off logModelUsage: a request needing 78% of its ceiling on a good run
 * is one bad run from returning nothing.
 */

// One call per batch, not per clue: cheaper, and only a batch-wide view catches two clues leaning
// on the same trick. The per-verdict fields are described here rather than in the schema because an
// element is opaque to ajv, and any keyword below the batch key fails the whole review over one
// malformed verdict.
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
      // Opaque, exactly as in crypticTool and for the same reason.
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
  // `unknown`, not `string`: `items: {}` is opaque to ajv, so a model returning an object or a
  // four-kilobyte essay here typechecks. It is bounded at its log sites instead.
  reason?: unknown
  verdict: 'keep' | 'fix' | 'drop'
}

// A CloudWatch field is still a destination. Bounded at the two sites that log it rather than at
// the boundary, because a reason that fails this is not worth rejecting a verdict over.
const MAX_REASON_LENGTH = 200

/**
 * The floor below which a unanimous drop is taken at face value rather than treated as a
 * malfunction. Above it, the guard OVERRIDES the reviewer and ships every clue it condemned, on
 * devices where this call is the entire verification -- so the floor has to sit above the batch
 * sizes this type routinely produces.
 *
 * It is CANDIDATES_PER_PUZZLE, the over-ask ratio, so it tracks the batch instead of going stale:
 * `asked` is 16, more than two thirds is rejected, and a verified batch is about five or fewer, so
 * reaching 8 means the pass rate cleared 50% on a type that expects far worse.
 *
 * Not imported from generator.ts, which imports this module -- that would be a cycle.
 * review.test.ts holds it from the other end, a row per batch size from 1 to 7 asserting the drops
 * are HONORED. Below the floor the type ships nothing, which is legal for a bestEffort type.
 */
const MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP = 8

const loggableReason = (reason: unknown): string | undefined =>
  typeof reason === 'string' ? reason.slice(0, MAX_REASON_LENGTH) : undefined

interface CrypticReviewResponse {
  verdicts: CrypticVerdict[]
}

// Exported so a test can tie these words to the tool description, which names them in prose where
// the schema names them nowhere. Nothing in src/ imports it.
export const CRYPTIC_VERDICTS = new Set(['drop', 'fix', 'keep'])

// Reads the CLUE through a span, never a second copy of the text.
const sliceOf = (clue: string, span: ClueSpan): string => clue.slice(span.start, span.end)

/**
 * What the reviewer sees, deliberately not the VerifiedClue. Shaped per device, because the prompt
 * asks a different question of each and a union of every field would send a double definition an
 * empty `parts` and a charade a `removal` it cannot use.
 *
 * Cues and definitions are sent as SLICES of the proved clue, never the model's original part
 * strings, which verify step 9 threw away: the reviewer must judge the decomposition that was
 * proved. `text` is not a slice, appearing nowhere in the clue, but it is copied from the
 * normalized form step 9 stored. The spans are withheld; an offset cannot help decide whether a
 * cue MEANS a word.
 *
 * `gloss` arrives pre-gated from generator.ts's `accept` and may be absent. A dropped gloss is
 * `undefined`, which JSON.stringify OMITS, so the reviewer receives no `gloss` key at all -- the
 * shape the prompt's ABSENT bullet is written against, and what lets a `fix` CREATE the rung.
 * Sending `gloss: clue.gloss ?? ''` would typecheck and quietly retire that bullet.
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
      // The removal travels though the reviewer does not judge it, because `source.text` is the
      // word BEFORE the removal and without knowing which end came off the reviewer cannot
      // reconstruct what it is being asked about. The INDICATOR is not sent: which words signal the
      // removal is committed-list membership verify step 8 decided.
      removal: clue.removal,
      source: { cue: sliceOf(clue.clue, clue.source.cueSpan), text: clue.source.text },
    }
  }

  return { ...base, definitions: clue.definitionSpans.map((span) => sliceOf(clue.clue, span)) }
}

const getModelContext = (clues: VerifiedClue[]): Record<string, unknown> => ({
  clues: clues.map(clueContext),
})

// Addressed by index, never by clue text: matching on text breaks the moment a model re-cases or
// re-punctuates it, and this clue's text is one string that must not be re-cased.
const indexVerdicts = (clues: VerifiedClue[], verdicts: CrypticVerdict[]): Map<number, CrypticVerdict> => {
  const byIndex = new Map<number, CrypticVerdict>()
  for (const verdict of verdicts ?? []) {
    const isAddressable =
      Number.isInteger(verdict?.index) &&
      verdict.index >= 0 &&
      verdict.index < clues.length &&
      !byIndex.has(verdict.index) &&
      // The verdict WORD, checked here because the schema does not. Without this an unrecognized or
      // non-string verdict falls through into a silent keep: a `drop` arriving as `"DROP"` would
      // ship a clue the reviewer judged unsolvable.
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
 * `clue` is byte-identical to the string the verifier proved and every span indexes it, so a
 * reviewer edit anywhere in it silently invalidates offsets that still typecheck and still render
 * something. The prompt says so; this is what makes it true regardless of what the prompt says.
 *
 * The gate runs over EVERY definition the device has: gatedGloss splits its `definition` argument
 * on spaces, so joining a double definition's halves gives it the union of their substantive
 * tokens, where passing one half would gate against half the printed words.
 *
 * The replacement re-runs gatedGloss -- the gates the original FACED, not the ones it passed, since
 * generator.ts may have dropped the original to `undefined`. That is the case a fix is most worth
 * having: it creates the type's only semantic rung. A failing replacement falls back to whatever
 * the clue already had rather than dropping the clue.
 *
 * One message name with the outcome in `outcome`, so an Insights lookup is
 * `filter message = "Applied a cryptic fix" | stats count() by outcome`. `created` is separate from
 * `replaced` because it is the only outcome that ADDS a rung, and the prompt is tuned against it.
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
    // `fallback` because there is not always an original to keep: `none` means the clue's own gloss
    // was dropped, the replacement failed too, and the ladder ships with no semantic rung at all.
    log('Applied a cryptic fix', {
      answer: clue.answer,
      fallback: clue.gloss === undefined ? 'none' : 'original',
      outcome: 'rejected',
    })
    return clue
  }
  // A replacement equal to the original is not a fix. Without this arm a reviewer returning the
  // gloss it was already shown yields a new object holding the same string, the identity test
  // upstream counts a fix, and generator.ts's rebuild guard correctly ships nothing -- a night
  // reported as "the gloss instruction is working" with no byte changed.
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

// Returns the count alongside the clues. applyFix returns the clue it was handed on every arm that
// changed nothing, so identity here means exactly "the gloss that will ship is not the one the
// generator wrote" -- the same question generator.ts's rebuild guard asks of the gloss value.
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
      // The line this whole call exists to produce. Three devices fail three different ways, and
      // the reason is the only record of which.
      log('Reviewer dropped a cryptic clue', {
        answer: clue.answer,
        clue: clue.clue,
        reason: loggableReason(verdict.reason),
      })
      continue
    }
    if (verdict.verdict === 'fix') {
      const applied = applyFix(clue, verdict)
      // Counts what was applied, not what the reviewer asked for: a fix with no replacement, or one
      // whose replacement fails re-gating, leaves the ladder as the generator wrote it.
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
 * Catches its own errors and returns its input unchanged, as reviewPhrases does. The caller gets no
 * signal distinguishing "reviewed and kept everything" from "review threw": its behavior is
 * identical either way, and the logError is what raises the alarm.
 */
export const reviewClues = async (clues: VerifiedClue[]): Promise<VerifiedClue[]> => {
  if (clues.length === 0) {
    return []
  }

  try {
    const prompt = await getPromptById(llmCrypticReviewPromptId)
    const { verdicts } = await invokeModel<CrypticReviewResponse>(prompt, crypticReviewTool, getModelContext(clues))

    const { fixed, kept: reviewed, unjudged } = applyVerdicts(clues, verdicts)
    // Without this, a reviewer whose verdicts indexVerdicts cannot address -- keyed `clueIndex`,
    // bare strings, anything the opaque `items: {}` schema admits -- leaves every clue unjudged and
    // kept, and the line below prints `dropped: 0, fixed: 0`, exactly as a healthy night does. It
    // does NOT cover a MISADDRESSED batch: a 1-based reviewer produces in-range indices, so those
    // verdicts apply to the wrong clue and this counter never rises.
    if (unjudged === clues.length) {
      logError('Reviewer judged no cryptic clue; keeping the batch unreviewed', { count: clues.length })
      return clues
    }
    // A unanimous drop is only suspicious on a batch big enough for unanimity to be surprising. At
    // N=1 "the reviewer dropped everything" and "the reviewer dropped the one bad clue" are the
    // same event, and overriding it makes the repo's only meaning check inoperative.
    if (reviewed.length === 0 && clues.length >= MIN_BATCH_TO_DOUBT_A_UNANIMOUS_DROP) {
      logError('Reviewer dropped every cryptic clue; keeping the batch unreviewed', { count: clues.length })
      return clues
    }
    if (reviewed.length === 0) {
      logError('Reviewer dropped every cryptic clue; shipping none of them', { count: clues.length })
      return []
    }

    // `fixed` because a gloss rewrite changes what ships without changing any other count, and
    // `unjudged` because partial garbage is otherwise invisible.
    log('Reviewed cryptic clues', {
      dropped: clues.length - reviewed.length,
      fixed,
      kept: reviewed.length,
      unjudged,
    })
    return reviewed
  } catch (error: unknown) {
    // Not `log`: the caller otherwise returns normally, and shipping a clue whose meaning nothing
    // has checked is worth saying out loud. The LEVEL follows the cause -- a Bedrock 503 is the
    // degraded path this catch exists for, with verify.ts's string gates still run, and anything
    // else pages. WARN on a 503 because shipping nothing whenever Bedrock throttles costs more.
    const write = isTransientModelFailure(error) ? logWarning : logError
    write('Could not review cryptic clues; shipping the batch unreviewed', { error })
    return clues
  }
}
