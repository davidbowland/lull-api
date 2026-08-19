import { generateCorpus } from '../services/corpus'
import { setCorpus } from '../services/dynamodb'
import { ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { nextPackDate } from '../utils/pack-date'

/**
 * The one place in this codebase that calls a model.
 *
 * It runs on its own schedule at 03:03 UTC, half an hour ahead of the 03:33 pack run, and both
 * target tomorrow -- so the corpus a pack draws from is written before that pack is built. Keeping
 * it in its own Lambda is what holds `bedrock:InvokeModel*` and the prompts-table grant off
 * CreatePackFunction and off the request path, where a model call cannot fit at all.
 */
export const createCorpusHandler = async (event: ScheduledEvent): Promise<void> => {
  log('Received event', { event })

  const date = nextPackDate()

  try {
    const entries = await generateCorpus()

    // False means another run wrote this date's corpus first, which is an expected outcome of
    // at-least-once schedule delivery rather than a failure. The condition exists to stop that
    // second run from resetting the used-id set, so losing is exactly what should happen.
    const written = await setCorpus(date, entries)
    if (!written) {
      log('A corpus already exists for this date, discarding this one', { date })
      return
    }

    log('Corpus created', { date, entries: entries.length })
  } catch (error: unknown) {
    // logError, not log: the CloudWatch subscription filters on level="ERROR" and this handler
    // otherwise returns normally, so a silently skipped corpus night would raise no alarm.
    //
    // Deliberately swallowed rather than rethrown. A failed model call is precisely the case the
    // fallback exists for -- the three consumers keep drawing from the most recent stored corpus,
    // so the night degrades instead of taking three puzzle types down with it.
    logError('Corpus generation failed, consumers will fall back to the most recent stored corpus', { date, error })
  }
}
