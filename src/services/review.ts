import { llmReviewPromptId } from '../config'
import { Familiarity, Phrase, PhraseHints, ToolSchema } from '../types'
import { log, logError, logWarning } from '../utils/logging'
import { isTransientModelFailure } from '../utils/model-errors'
import { DEFAULT_FAMILIARITY, passesProseGates, toFamiliarity } from '../utils/phrase-checks'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

// A filter, not a gate. The verdict is per phrase and a drop costs one puzzle at worst, because
// generation already over-asks. There is no retry loop behind this call, so a whole-batch reject
// on one bad phrase would cost a night of content and buy nothing.
//
// One call per batch, not per phrase: cheaper, and only a batch-wide view can catch two
// near-duplicate phrases or a batch that has drifted onto one shape.
export const reviewTool: ToolSchema = {
  // Per-verdict fields described here rather than in the schema, for the reason phraseTool gives:
  // an element is opaque to ajv, and any keyword below the batch key fails the whole review over
  // one bad verdict.
  description:
    'Return one verdict per phrase, addressed by its 0-based index. Each element is an object with: ' +
    '`index`, the 0-based position of the phrase this verdict addresses; `verdict`, one of "keep", ' +
    '"fix" or "drop"; optionally `category` and `hints` (an array of exactly three strings) as ' +
    'replacements on a fix; optionally `familiarity`, how widely known the phrase is as a whole ' +
    'number from 1 to 5; and optionally `reason`. keep leaves the phrase alone, fix replaces its ' +
    'category and/or hints, drop removes it. Never rewrite text or shape.',
  input_schema: {
    properties: {
      // items: {} -- opaque, exactly as in phraseTool and for the same reason.
      verdicts: { items: {}, type: 'array' },
    },
    required: ['verdicts'],
    type: 'object',
  },
  name: 'submit_review',
}

interface ReviewVerdict {
  category?: string
  familiarity?: unknown
  hints?: string[]
  index: number
  // Optional because the schema no longer requires it: a reason only ever reaches a log line.
  reason?: string
  verdict: 'keep' | 'fix' | 'drop'
}

interface ReviewResponse {
  batchNotes?: string
  verdicts: ReviewVerdict[]
}

// The reviewer sees the phrases and nothing else -- not the inspiration words, not the used-phrase
// list. Narrow context keeps a reviewer from re-deriving the generator's reasoning instead of
// judging its output. `familiarity` is withheld because the reviewer sets it.
const getModelContext = (phrases: Phrase[]): Record<string, unknown> => ({
  phrases: phrases.map((phrase, index) => ({
    category: phrase.category,
    hints: phrase.hints,
    index,
    shape: phrase.shape,
    text: phrase.text,
  })),
})

// Review did not run, or ran and malfunctioned. Every phrase is stamped so Phrase.familiarity is
// total and no consumer has to handle an absent rating.
//
// The trade is only survivable because the middle rating derives to the middle band. Under
// difficulty thresholds where it does not, a default-stamped batch makes the hardest cryptogram of
// the day unfillable by construction whenever review fails, and nothing says so.
const stampDefault = (phrases: Phrase[]): Phrase[] =>
  phrases.map((phrase) => ({ ...phrase, familiarity: DEFAULT_FAMILIARITY }))

// How many kept phrases landed on each rating, with every band present so an EMPTY one is visible
// rather than absent. Cryptogram's derived difficulty is dominated by familiarity, so a batch
// rated 4 and 5 across the board cannot fill its hardest band -- and "No usable phrase for this
// difficulty" says a band starved without saying the pool was the wrong SHAPE.
const familiaritySpread = (phrases: Phrase[]): Record<Familiarity, number> => {
  const spread = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const phrase of phrases) {
    spread[phrase.familiarity] += 1
  }
  return spread
}

// Exported for the reason SHAPES is (services/phrases.ts): reviewTool.description names these
// words in prose, the schema does not name them at all, and tool-schemas.test.ts ties the two
// together.
export const VERDICTS = new Set(['drop', 'fix', 'keep'])

// Addressed by index, never by text: matching on text is fragile the moment a model re-cases or
// re-punctuates it.
const indexVerdicts = (phrases: Phrase[], verdicts: ReviewVerdict[]): Map<number, ReviewVerdict> => {
  const byIndex = new Map<number, ReviewVerdict>()
  for (const verdict of verdicts) {
    const isAddressable =
      Number.isInteger(verdict?.index) &&
      verdict.index >= 0 &&
      verdict.index < phrases.length &&
      !byIndex.has(verdict.index) &&
      // The verdict WORD, checked here because the schema does not. Without this an unrecognized
      // or non-string verdict falls through applyVerdicts' if-chain into a silent keep -- a
      // reviewer's `drop` arriving as `"DROP"` would quietly ship the phrase.
      typeof verdict.verdict === 'string' &&
      VERDICTS.has(verdict.verdict)
    if (isAddressable) {
      byIndex.set(verdict.index, verdict)
      continue
    }
    log('Ignored an unusable verdict', { index: verdict?.index, verdict: verdict?.verdict })
  }
  return byIndex
}

// A failed fix falls back to the original rather than dropping: a reviewer that correctly spots a
// weak ladder and then writes a bad replacement would otherwise cost more than one that stayed
// silent.
const applyFix = (phrase: Phrase, verdict: ReviewVerdict, familiarity: Familiarity): Phrase => {
  const hasReplacement = verdict.category !== undefined || verdict.hints !== undefined
  if (hasReplacement) {
    const category = verdict.category ?? phrase.category
    const hints = verdict.hints ?? phrase.hints
    if (passesProseGates({ category, hints, text: phrase.text })) {
      return { ...phrase, category, familiarity, hints: hints as PhraseHints }
    }
    log('Kept the original: the reviewer replacement failed re-gating', { text: phrase.text })
    return { ...phrase, familiarity }
  }
  log('Treated a fix with no replacement as a keep', { text: phrase.text })
  return { ...phrase, familiarity }
}

const applyVerdicts = (phrases: Phrase[], verdicts: ReviewVerdict[]): Phrase[] => {
  const byIndex = indexVerdicts(phrases, verdicts)
  const kept: Phrase[] = []
  let unjudged = 0

  for (const [index, phrase] of phrases.entries()) {
    const verdict = byIndex.get(index)
    if (verdict === undefined) {
      unjudged += 1
      kept.push({ ...phrase, familiarity: DEFAULT_FAMILIARITY })
      continue
    }
    if (verdict.verdict === 'drop') {
      log('Reviewer dropped a phrase', { reason: verdict.reason, text: phrase.text })
      continue
    }
    const familiarity = toFamiliarity(verdict.familiarity)
    if (verdict.verdict === 'fix') {
      // Logged on fix as well as on drop: a fix silently rewrites a phrase's ladder, and the
      // reason is the only record of whether the reviewer's batch-wide check was performed.
      //
      // "returned a fix", not "fixed": applyFix may still reject the replacement at the prose
      // gates or find none at all, and logs which on its own line. This records what the REVIEWER
      // said, not what was applied.
      log('Reviewer returned a fix', { reason: verdict.reason, text: phrase.text })
      kept.push(applyFix(phrase, verdict, familiarity))
      continue
    }
    kept.push({ ...phrase, familiarity })
  }

  if (unjudged > 0) {
    log('Kept phrases the reviewer returned no verdict for', { count: unjudged })
  }
  return kept
}

/**
 * Audits a generated batch and returns the phrases worth shipping.
 *
 * Catches its own errors and returns its input unchanged. The handler gets no signal
 * distinguishing "reviewed and kept everything" from "review threw" -- deliberately, because its
 * behavior is identical either way, and the logError is what raises the alarm.
 */
export const reviewPhrases = async (phrases: Phrase[]): Promise<Phrase[]> => {
  if (phrases.length === 0) {
    return []
  }

  try {
    const prompt = await getPromptById(llmReviewPromptId)
    const { batchNotes, verdicts } = await invokeModel<ReviewResponse>(prompt, reviewTool, getModelContext(phrases))

    if (batchNotes !== undefined) {
      log('Reviewer batch notes', { batchNotes })
    }

    const reviewed = applyVerdicts(phrases, verdicts)
    if (reviewed.length === 0) {
      // Far more likely a malfunction than ten genuinely unrecognizable phrases, so it gets the
      // same treatment as a thrown call.
      logError('Reviewer dropped every phrase; keeping the batch unreviewed', { count: phrases.length })
      return stampDefault(phrases)
    }

    log('Reviewed phrases', {
      dropped: phrases.length - reviewed.length,
      familiarity: familiaritySpread(reviewed),
      kept: reviewed.length,
    })
    return reviewed
  } catch (error: unknown) {
    // Not `log`: the handler otherwise returns normally, and shipping unreviewed player-visible
    // prose is worth saying out loud. The level follows the cause -- a Bedrock 503 means the
    // reviewer never ran, which is the degraded-but-correct path, and the load-bearing gates in
    // utils/phrase-checks.ts all still ran. A reviewer that FAILED rather than one that was
    // unreachable still pages.
    const write = isTransientModelFailure(error) ? logWarning : logError
    write('Could not review phrases; shipping the batch unreviewed', { error })
    return stampDefault(phrases)
  }
}
