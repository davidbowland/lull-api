import { ensureCorpus, generateCorpus } from '../services/corpus'
import { setCorpus } from '../services/dynamodb'
import { invokeCreatePack } from '../services/lambda'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, nextPackDate } from '../utils/pack-date'

interface CreateCorpusEvent {
  date?: string
  // Set by the request path. On demand an existing corpus of any age is enough; the nightly run
  // deliberately makes a fresh one.
  ifMissing?: boolean
}

/**
 * The ONLY function in this stack that calls a model.
 *
 * That is the whole point of it being separate. A Bedrock call cannot fit inside a request, and it
 * has no business inside the pack builder either -- pack assembly is pure, fast, and per-date,
 * while a corpus is one expensive call whose output is shared across three puzzle types and many
 * days. Keeping them apart is what holds `bedrock:*` and the prompts-table grant to one role.
 *
 * Two triggers, one job:
 *
 *   03:03 UTC on a schedule, targeting tomorrow, generating a fresh corpus.
 *   Fire-and-forget from `GET /packs/{date}`, generating one only if none exists at all.
 */
export const createCorpusHandler = async (event: ScheduledEvent | CreateCorpusEvent): Promise<void> => {
  log('Received event', { event })

  const corpusEvent = event as CreateCorpusEvent

  // Format only, not isValidPackDate. The date here names which corpus to write and which pack to
  // rebuild afterwards, and both are legitimately in the past on a manual replay. An unvalidated
  // event field reaching a DynamoDB key is still an unbounded key, so the shape is checked.
  if (corpusEvent.date !== undefined && !isPackDateFormat(corpusEvent.date)) {
    logError('Invalid corpus date, refusing to generate', { date: corpusEvent.date })
    return
  }
  const date: PackDate = corpusEvent.date ?? nextPackDate()

  try {
    if (corpusEvent.ifMissing) {
      // ensureCorpus is a no-op when any corpus is stored, and claim-guarded when it is not, so
      // the eight dates usePrefetch walks cannot become eight concurrent model calls.
      const available = await ensureCorpus(date)
      if (!available) {
        log('Another run is generating a corpus, leaving this date to it', { date })
        return
      }
      // The puzzles the corpus unblocks are fast to make, so ask for them now rather than waiting
      // for a client to refetch or for the 03:33 run. This carries no model call.
      await invokeCreatePack(date)
      return
    }

    // The nightly path. A fresh corpus on purpose -- variety is the reason this runs every night,
    // so it must not be skipped merely because an older corpus exists.
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
    // fallback exists for -- the consumers keep drawing from the most recent stored corpus, so the
    // night degrades instead of taking three puzzle types down with it.
    logError('Corpus generation failed, consumers will fall back to the most recent stored corpus', { date, error })
  }
}
