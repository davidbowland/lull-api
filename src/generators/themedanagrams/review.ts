import { llmAnagramReviewPromptId } from '../../config'
import { normalizeAnswer } from '../../rules/normalize-answer'
import { AnagramSet } from '../../services/anagram-sets'
import { invokeModel } from '../../services/bedrock'
import { getPromptById } from '../../services/dynamodb'
import { ToolSchema } from '../../types'
import { log, logError, logWarning } from '../../utils/logging'
import { isTransientModelFailure } from '../../utils/model-errors'
import { WORDS_PER_PUZZLE } from './words'

/**
 * The second model call this type makes, and the only check on what code cannot see: whether every
 * word belongs to its theme, and whether the words agree in form and kind. The gates in words.ts
 * prove each word is a scramble-safe English word; nothing there can tell BURGLAR from ROBBERY.
 *
 * AFTER the word gates, never before, and over every admitted word rather than the four that would
 * ship: a set usually arrives with more than four, so removing the odd word out lets the next one
 * in rather than costing the set.
 *
 * Type-local, as crypticclue/review.ts is and for the same reason: services/review.ts is
 * Phrase-shaped and runs in another Lambda.
 */

// One call per batch: cheaper, and the review sees the sets side by side. Per-verdict fields are
// described here rather than in the schema because an element is opaque to ajv, and any keyword
// below the batch key fails the whole review over one malformed verdict.
export const anagramReviewTool: ToolSchema = {
  description:
    'Return one verdict per set, addressed by its 0-based index. Each element is an object with: ' +
    '`index`, the 0-based position of the set this verdict addresses; `verdict`, one of "keep", ' +
    '"trim" or "drop"; on a trim, `remove`, an array of the words from that set to take out; and ' +
    'optionally `reason`. keep leaves the set alone, trim removes only the named words, drop ' +
    'removes the whole set. Never add a word and never rewrite a word or a theme.',
  input_schema: {
    properties: {
      // Opaque, exactly as in anagramSetTool and for the same reason.
      verdicts: { items: {}, type: 'array' },
    },
    required: ['verdicts'],
    type: 'object',
  },
  name: 'submit_anagram_review',
}

// Exported so a test can tie these words to the tool description. Nothing in src/ imports it.
export const ANAGRAM_VERDICTS = new Set(['drop', 'keep', 'trim'])

interface AnagramVerdict {
  index: number
  // `unknown`: `items: {}` is opaque to ajv, so these typecheck whatever arrives.
  reason?: unknown
  remove?: unknown
  verdict: 'drop' | 'keep' | 'trim'
}

interface AnagramReviewResponse {
  verdicts: AnagramVerdict[]
}

const MAX_REASON_LENGTH = 200

const loggableReason = (reason: unknown): string | undefined =>
  typeof reason === 'string' ? reason.slice(0, MAX_REASON_LENGTH) : undefined

// The reviewer sees the theme, the stated form and the words, and nothing about how they were
// chosen. An absent form is omitted by JSON.stringify, which the prompt tells the reviewer to expect.
const getModelContext = (sets: AnagramSet[]): Record<string, unknown> => ({
  sets: sets.map((set, index) => ({ form: set.form, index, theme: set.theme, words: set.words })),
})

// Addressed by index, never by theme: a recased theme would no longer match.
const indexVerdicts = (sets: AnagramSet[], verdicts: AnagramVerdict[]): Map<number, AnagramVerdict> => {
  const byIndex = new Map<number, AnagramVerdict>()
  for (const verdict of verdicts ?? []) {
    const isAddressable =
      Number.isInteger(verdict?.index) &&
      verdict.index >= 0 &&
      verdict.index < sets.length &&
      !byIndex.has(verdict.index) &&
      // Checked here because the schema does not: an unrecognized verdict word would otherwise fall
      // through into a silent keep.
      typeof verdict.verdict === 'string' &&
      ANAGRAM_VERDICTS.has(verdict.verdict)
    if (isAddressable) {
      byIndex.set(verdict.index, verdict)
      continue
    }
    log('Ignored an unusable anagram verdict', { index: verdict?.index, verdict: verdict?.verdict })
  }
  return byIndex
}

type Outcome = 'dropped' | 'kept' | 'trimmed' | 'trimmedBelowFloor'

/**
 * Removal only, matched on the normalized word, so a recased echo still names its word and a word
 * the set never held removes nothing. Order is preserved: entriesAt ships the first four that
 * scramble, so the model's ranking still decides what replaces a removed word.
 */
const applyTrim = (set: AnagramSet, verdict: AnagramVerdict): { outcome: Outcome; set?: AnagramSet } => {
  const named = Array.isArray(verdict.remove) ? verdict.remove.filter((word) => typeof word === 'string') : []
  const remove = new Set(named.map((word: string) => normalizeAnswer(word)))
  const words = set.words.filter((word) => !remove.has(normalizeAnswer(word)))
  if (words.length === set.words.length) {
    log('Treated a trim that removed nothing as a keep', { theme: set.theme })
    return { outcome: 'kept', set }
  }
  const removed = set.words.filter((word) => remove.has(normalizeAnswer(word)))
  if (words.length < WORDS_PER_PUZZLE) {
    log('Reviewer trimmed an anagram set below the floor', {
      reason: loggableReason(verdict.reason),
      removed,
      theme: set.theme,
    })
    return { outcome: 'trimmedBelowFloor' }
  }
  log('Reviewer trimmed an anagram set', { reason: loggableReason(verdict.reason), removed, theme: set.theme })
  return { outcome: 'trimmed', set: { ...set, words } }
}

const applyVerdicts = (
  sets: AnagramSet[],
  verdicts: AnagramVerdict[],
): { counts: Record<Outcome, number>; kept: AnagramSet[]; unjudged: number } => {
  const byIndex = indexVerdicts(sets, verdicts)
  const counts: Record<Outcome, number> = { dropped: 0, kept: 0, trimmed: 0, trimmedBelowFloor: 0 }
  const kept: AnagramSet[] = []
  let unjudged = 0

  for (const [index, set] of sets.entries()) {
    const verdict = byIndex.get(index)
    if (verdict === undefined) {
      unjudged += 1
      kept.push(set)
      continue
    }
    if (verdict.verdict === 'drop') {
      log('Reviewer dropped an anagram set', { reason: loggableReason(verdict.reason), theme: set.theme })
      counts.dropped += 1
      continue
    }
    if (verdict.verdict === 'trim') {
      const result = applyTrim(set, verdict)
      counts[result.outcome] += 1
      if (result.set !== undefined) {
        kept.push(result.set)
      }
      continue
    }
    counts.kept += 1
    kept.push(set)
  }

  return { counts, kept, unjudged }
}

/**
 * Audits gated sets and returns the ones worth shipping, with off-form and off-theme words removed.
 *
 * Catches its own errors and returns its input unchanged, as reviewClues does: the word gates still
 * ran, and losing the night to an unreachable reviewer costs more than shipping unreviewed sets.
 */
export const reviewAnagramSets = async (sets: AnagramSet[]): Promise<AnagramSet[]> => {
  if (sets.length === 0) {
    return []
  }

  try {
    const prompt = await getPromptById(llmAnagramReviewPromptId)
    const { verdicts } = await invokeModel<AnagramReviewResponse>(prompt, anagramReviewTool, getModelContext(sets))

    const { counts, kept, unjudged } = applyVerdicts(sets, verdicts)
    // A reviewer whose verdicts cannot be addressed leaves every set unjudged and kept, which would
    // otherwise log exactly as a night with nothing to fix.
    if (unjudged === sets.length) {
      logError('Reviewer judged no anagram set; keeping the batch unreviewed', { count: sets.length })
      return sets
    }
    // This type is not best-effort, so a unanimous rejection costs the night its puzzles. Far more
    // likely a malfunction than a batch with no usable set.
    if (kept.length === 0) {
      logError('Reviewer removed every anagram set; keeping the batch unreviewed', { count: sets.length })
      return sets
    }

    log('Reviewed anagram sets', { ...counts, unjudged })
    return kept
  } catch (error: unknown) {
    const write = isTransientModelFailure(error) ? logWarning : logError
    write('Could not review anagram sets; shipping the batch unreviewed', { error })
    return sets
  }
}
