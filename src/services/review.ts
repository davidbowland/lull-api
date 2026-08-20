import { llmReviewPromptId } from '../config'
import { Familiarity, HintLadder, Phrase, ToolSchema } from '../types'
import { log, logError } from '../utils/logging'
import { DEFAULT_FAMILIARITY, passesProseGates, toFamiliarity } from '../utils/phrase-checks'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

// A FILTER, not a gate. connections-api verifies one game and can throw the whole thing away,
// because there is exactly one and a self-invoke retries it. Lull generates a batch, already asks
// for double what it needs, and already drops rejects -- so the verdict is per-phrase and a drop
// costs a puzzle at worst. There is no whole-batch failure and no retry loop.
//
// One call per batch, not per phrase: it is cheaper, and only a batch-wide view can catch two
// near-duplicate phrases or a batch that has drifted onto one shape.
export const reviewTool: ToolSchema = {
  description:
    'Return one verdict per phrase, addressed by its 0-based index. keep leaves the phrase alone, fix replaces its category and/or hints, drop removes it. Never rewrite text or shape.',
  input_schema: {
    properties: {
      batchNotes: { type: 'string' },
      verdicts: {
        items: {
          properties: {
            category: { type: 'string' },
            // Untyped and not in `required`, both deliberately. ajv validates the WHOLE payload, so
            // every constraint here is a whole-review failure over one bad verdict: a drop
            // legitimately omits familiarity, and the prompt's "omit it on a drop" is answered with
            // `null` about as often as with an absent key. `3.5` and `"4"` are the same class of
            // drift. toFamiliarity takes any of them, defaults to 3 and logs, at a cost of nothing.
            familiarity: { description: 'How widely known the phrase is, as a whole number from 1 to 5.' },
            // No minItems/maxItems and no items, for the same ajv reason as the generator schema.
            // isHintLadder re-gates the replacement per phrase, where a bad ladder costs one fix.
            hints: { type: 'array' },
            // Untyped for the same reason: a fractional or stringy index is one unusable verdict,
            // and indexVerdicts already drops it with Number.isInteger. Typing it here would throw
            // away the other nine verdicts too.
            index: { description: 'The 0-based position of the phrase this verdict addresses.' },
            reason: { type: 'string' },
            verdict: { enum: ['keep', 'fix', 'drop'], type: 'string' },
          },
          // `reason` is not required: it only ever reaches a log line, and a verdict that omits it
          // is still fully actionable. Requiring it would discard the whole review over a missing
          // sentence.
          required: ['index', 'verdict'],
          type: 'object',
        },
        type: 'array',
      },
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

// The reviewer sees the phrases and NOTHING else -- not the inspiration words, not the used-phrase
// list. Narrow context is what keeps a reviewer from re-deriving the generator's reasoning instead
// of judging its output. `familiarity` is withheld deliberately: the reviewer sets it.
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
// total and no consumer has to handle an absent rating. Decision 7 already accepts shipping
// unreviewed prose; a middling default rating is the same trade.
//
// That trade is only survivable because the middle rating derives to the middle band. Under the
// absolute-count thresholds cryptogram's difficulty.ts used to carry, a default-stamped batch
// derived entirely to difficulty 2 and the hardest cryptogram of the day was unfillable BY
// CONSTRUCTION whenever review failed. Nothing said so; the pack simply came out short.
const stampDefault = (phrases: Phrase[]): Phrase[] =>
  phrases.map((phrase) => ({ ...phrase, familiarity: DEFAULT_FAMILIARITY }))

// How many kept phrases landed on each rating, with every band present so an EMPTY one is visible
// rather than absent.
//
// This is the number the whole pipeline turns on and nothing used to log it. Cryptogram's derived
// difficulty is dominated by familiarity, so a batch rated 4 and 5 across the board cannot fill its
// hardest band -- and the only signal that had ever reached CloudWatch was "No usable phrase for
// this difficulty", which says a band starved without saying that the pool was the wrong SHAPE.
// Diagnosing it meant reading three files and re-deriving the arithmetic by hand.
const familiaritySpread = (phrases: Phrase[]): Record<Familiarity, number> => {
  const spread = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const phrase of phrases) {
    spread[phrase.familiarity] += 1
  }
  return spread
}

// Addressed by index, never by text: matching on text is fragile the moment a model re-cases or
// re-punctuates it.
const indexVerdicts = (phrases: Phrase[], verdicts: ReviewVerdict[]): Map<number, ReviewVerdict> => {
  const byIndex = new Map<number, ReviewVerdict>()
  for (const verdict of verdicts) {
    const isAddressable =
      Number.isInteger(verdict.index) &&
      verdict.index >= 0 &&
      verdict.index < phrases.length &&
      !byIndex.has(verdict.index)
    if (isAddressable) {
      byIndex.set(verdict.index, verdict)
      continue
    }
    log('Ignored an unusable verdict', { index: verdict.index })
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
      return { ...phrase, category, familiarity, hints: hints as HintLadder }
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
    // logError, not log: the handler otherwise returns normally, and shipping unreviewed
    // player-visible prose is worth an alarm.
    logError('Could not review phrases; shipping the batch unreviewed', { error })
    return stampDefault(phrases)
  }
}
