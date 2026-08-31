import { phraseHistoryDays } from '../config'
import { modelGenerators } from '../generators/model'
import { getPackByDate, getRecentPacks } from '../services/dynamodb'
import { addModelPuzzles, createPack, missingDifficulties } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError } from '../utils/logging'
import { isPackDateFormat, packDateWindow } from '../utils/pack-date'

// Declared HERE and not in src/types.ts, matching create-pack.ts's own CreatePackEvent. One field,
// the same isPackDateFormat validation, the same reason.
interface CreateModelPuzzlesEvent {
  date?: string
}

// Stop STARTING a generator past five minutes, leaving 600s of the 900 for the slowest GENERATOR
// plus its write -- the slowest generator, not the slowest CALL, which is what this number reserved
// for when every fetchCandidates was one Bedrock call and is what made it wrong the day one stopped
// being. crypticClueGenerator's fetchCandidates is TWO SERIAL CALLS, create-cryptic-clues then
// review-cryptic-clues, and it runs LAST, so it is the generator this reserve has to cover.
//
// Derived from bedrock.ts's one measured figure -- 16000 tokens took 204s: create-cryptic-clues at
// 32000 lands near 410s, review-cryptic-clues at 8000 near 100s, so the pair is ~510s. 600 is that
// plus NINETY SECONDS, and that 90s is the entire margin -- named as a number rather than as "some
// margin" because it is what the next person is spending when they raise either prompt's cap.
//
// THE 204s WAS MEASURED ON create-phrases, NOT ON EITHER OF THESE PROMPTS, and it is being
// extrapolated linearly to 2x on one and 0.5x on the other. Tokens-per-second is not linear in
// maxTokens and thinkingEffort differs across all three, so treat 510 as an order of magnitude. If
// it is 20% low the margin is gone -- which is the argument for re-measuring against a real nightly
// run rather than for shaving the number further here.
//
// At the old 600_000 a cryptic start at t=599s finished past the 900s Timeout, and an uncaught
// Lambda timeout is the ONE failure the per-type catch below cannot contain: MaximumRetryAttempts is
// 0, so nothing runs again, and the funnel line never prints. Cutting review-cryptic-clues from
// 16000 tokens to 8000 is half of this fix; moving the bound is the other half, because the estimate
// is the thing that would have to be wrong twice.
//
// A RETRY STILL BLOWS THIS RESERVE AND NO BUDGET HERE CAN STOP IT. bedrock.ts sets maxAttempts 4,
// and an attempt re-runs the call rather than resuming it, so a single retried create-cryptic-clues
// is ~820s against a 600s reserve. That is a property of the CLIENT, not of this loop -- a bound
// checked before a call starts cannot bound what the call does after it starts -- and the honest
// statement is that this number bounds the common case and a retried 32000-token call is outside it.
// The fix, if the logs ever show one, is a client with its own maxAttempts for 900s generators, not
// a smaller number here.
//
// The same distinction ON_DEMAND_BUDGET_MS draws: this bounds when the last call may START, not when
// the invocation ends, and it cannot interrupt a call already in flight.
//
// A budget for the WHOLE LOOP, not 300 seconds per type. It is checked once per iteration against a
// single `start`, two model types share it, and Phase 2's types arrive into the same handler and the
// same number.
//
// THREADING A DEADLINE into fetchCandidates was considered and rejected. It changes the
// ModelGenerator interface for one type's benefit, and a number checked once per iteration bounds the
// same risk from outside the generator -- where the loop, not the call, is what has to be stopped.
//
// THE ACCEPTED RESIDUAL, stated rather than discovered on a slow night: when Themed Anagrams runs
// past 300s, Cryptic Clue is skipped. That is the DESIGNED outcome and not the price of it --
// generators/model.ts orders the bestEffort type last precisely so it is the one that goes, and a
// skipped clue with an ERROR line naming it beats a killed invocation that explains nothing.
const GENERATOR_BUDGET_MS = 300_000

/**
 * The second of exactly two functions in this stack that call a model.
 *
 * One fetchCandidates call per type per pack, never one per puzzle, and a WRITE PER GENERATOR --
 * buildPack is read-merge-conditional-write and its put is conditional on the puzzle count it read,
 * so one write after 800 seconds is a single condition a racing GET can invalidate, discarding every
 * type's model output. Three conditional writes a night on a PAY_PER_REQUEST table is nothing.
 *
 * NOT folded into create-phrase-puzzles.ts. That function already makes two serial Opus calls inside
 * the same 900-second ceiling, and a TIMEOUT is the one failure mode a per-call catch cannot contain:
 * the phrase handler catches everything the code can throw, and nothing catches the runtime killing
 * the invocation. Sharing one would put an experimental puzzle in front of the six phrases the pack
 * depends on.
 *
 * NO SCHEDULE OF ITS OWN, for the reason CreatePhrasePuzzlesFunction already carries: a separate
 * cron would fire before the pack it is filling exists. It is invoked only by whoever built the
 * self-contained half and found work outstanding.
 *
 * THE ACCEPTED RESIDUAL, stated rather than discovered later: one handler for several types means a
 * fetchCandidates that HANGS -- as distinct from throwing -- can still eat the budget of everything
 * after it, and the per-generator catch does not help against a hang. The budget guard turns that
 * into a short pack rather than a killed invocation, which is the outcome that matters.
 */
export const createModelPuzzles = async (date: PackDate, now: () => number = Date.now): Promise<void> => {
  const start = now()

  // The non-inRequest self-contained lane, which nothing else repairs. fillPack filters on
  // inRequest; createPack runs every self-contained generator but is invoked only by the 03:33
  // nightly and a manual invoke; and the async builders never touched
  // selfContainedGenerators at all. So a pack more than a day past the nightly window that is short
  // of an inRequest: false self-contained type was short PERMANENTLY -- nothing ran the generator
  // again, isComplete recomputed false on every response, and the client refetched forever.
  //
  // Phase 1 ships no such generator, which is stated rather than dressed up: the reason the hole is
  // empty right now is that the one self-contained generator happens to be graded true, nothing
  // asserts that as an invariant, and no test could. It is one line, it is idempotent, and on the
  // nightly path create-pack.ts has just run createPack itself, so this is the no-op it is designed
  // to be.
  //
  // It goes BEFORE the loop so a budget-exhausted night still repairs the cheap lane, and it is
  // caught for the same reason every arm below is: createPack walks generators that can throw, and a
  // broken cheap lane must not cost the model lane its night. Its own per-type failures are already
  // logged inside generateSelfContained; this catches only what escapes that.
  //
  // It is in THIS builder and not in both. Two builders each calling createPack is two racers added
  // to a conditional write that already has several, for one repair -- and the fan-out invokes both,
  // so the model handler running it covers every hand-off the request path makes.
  try {
    await createPack(date)
  } catch (error: unknown) {
    logError('Could not repair the self-contained lane', { date, error })
  }

  try {
    // Read AFTER the repair, so what the repair wrote counts. One strongly-consistent read of one
    // item, which dynamodb.ts already argues is worth paying for a smaller reason.
    const existing = (await getPackByDate(date))?.puzzles ?? []
    // packDateWindow, NOT recentPackDates: that one looks only BACKWARD, so a backfill cannot see
    // the packs that already shipped after its target date. Same bug, same fix, same reason as
    // create-phrase-puzzles.ts -- a theme or an anagram word repeats just as visibly as a phrase.
    const recent = await getRecentPacks(packDateWindow(date, phraseHistoryDays))

    for (const generator of modelGenerators) {
      // BEFORE the model call. With two builders behind one flag, "the pack is incomplete" no longer
      // means "your type is missing", so an invocation that fetches first burns Opus tokens to add
      // nothing. bestEffort makes this load-bearing rather than merely thrifty: a best-effort type is
      // skipped by isComplete, so its absence never re-triggers the builder, and the only thing
      // deciding whether it runs tonight is missingDifficulties reading the pack it already has.
      const missing = missingDifficulties(generator, existing, date)
      if (missing.length === 0) {
        log('Nothing missing for this type, skipping the model call', { date, type: generator.type })
        continue
      }

      // AFTER the skip above, and the order is the difference between an alarm and a page nobody
      // owes an answer to. The level="ERROR" subscription filter is the only alarm in this stack, so
      // this line wakes somebody up; ahead of the skip it fired on a slow night over types whose
      // work was already done, which is an alarm about a pack that was full. Reading the clock only
      // for a type that has work also stops a full pack consuming budget readings it never spent.
      //
      // An uncaught 900-second timeout is a FUNCTION ERROR, and NOTHING RUNS AGAIN:
      // template.yaml sets EventInvokeConfig MaximumRetryAttempts to 0 and services/lambda.ts
      // invokes with InvocationType 'Event', so a killed invocation is the end of the night. That is
      // what makes returning under budget with a short pack strictly better than being killed -- a
      // short pack leaves a record and the next GET for that date re-reads what is missing, where a
      // kill leaves neither. ERROR rather than log, because a night that ran out of budget is a
      // night somebody should see.
      //
      // This paragraph said "an async invocation retries" until 2026-08-24, which was false and was
      // the assumption the budget above was originally sized under.
      //
      // `>=`, not `>`. This bounds when the last GENERATOR may START, leaving 600s of the 900 for its
      // calls plus its write. `>=` rather than `>` because the 600 is a LOWER bound derived from an
      // extrapolated estimate, so the boundary reading is spent by choice rather than because a
      // generator starting exactly at it would have no reserve -- it would have exactly all of it.
      if (now() - start >= GENERATOR_BUDGET_MS) {
        logError('Model budget spent, skipping the remaining types', {
          date,
          skipped: modelGenerators.slice(modelGenerators.indexOf(generator)).map((skipped) => skipped.type),
        })
        break
      }

      // Swallowed PER TYPE and never rethrown out of the handler, for the same reason
      // create-phrase-puzzles.ts swallows: a Lambda retry re-runs every type including the ones that
      // succeeded. The retry, at the right granularity, is the next GET for this date -- it re-reads
      // what is missing and hands off only that, under claimPackGeneration.
      try {
        const candidates = await generator.fetchCandidates(missing.length, recent, date)
        // `missing` is passed through rather than re-derived -- see addModelPuzzles.
        const pack = await addModelPuzzles(date, generator, missing, candidates)
        /*
         * SHORT AND EMPTY ARE DIFFERENT PAGES, and the level is what says which one this is. Same
         * rule as create-phrase-puzzles.ts, deliberately identical so one query covers both builders.
         *
         * A type that wanted three and got two leaves the pack incomplete, the next GET re-triggers
         * this builder through hasWorkRemaining, and it often fills. Paging for it is how the
         * level="ERROR" subscription -- the only alarm in this stack -- becomes a filter people mute,
         * and a muted alarm still looks like coverage. 2026-08-26 is the case in hand: themedanagrams
         * came back one short, the pack shipped twelve of thirteen, and that woke somebody with the
         * same line a total failure uses.
         *
         * A required type at ZERO is a pipeline that returned nothing, and no retry has been observed
         * to fix one on its own. That is the page.
         *
         * A BEST-EFFORT type is still COUNTED and never alarmed, at zero or anywhere else -- being
         * short by design is the input to the kill criteria that type's spec declares, and the flag's
         * whole documented job (services/packs.ts) is to suppress the alarm and never the attempt.
         */
        const produced = pack.puzzles.filter((puzzle) => puzzle.type === generator.type).length
        if (produced < generator.countPerDay) {
          if (produced === 0 && generator.bestEffort !== true) {
            logError('Model type produced nothing', { date, type: generator.type, wanted: generator.countPerDay })
          } else {
            log('Model type is short after its call', {
              date,
              produced,
              type: generator.type,
              wanted: generator.countPerDay,
            })
          }
        }
      } catch (error: unknown) {
        logError('Could not add puzzles for this type', { date, error, type: generator.type })
      }
    }
  } catch (error: unknown) {
    // The reads above, which are outside the per-type arms. Swallowed for the same reason.
    logError('Could not add model puzzles', { date, error })
  }
}

/**
 * The Lambda entry point, and NOTHING BUT the entry point: validate the event, then delegate.
 *
 * The work above takes the clock, and this does not, because the runtime calls a handler as
 * `handler(event, context, callback)`. An injectable clock in ANY positional slot of an exported
 * handler is therefore never defaulted in production -- it is bound to the context object, and the
 * first `now()` throws "is not a function" before a single puzzle is built. That is not theoretical:
 * it shipped, it killed every model puzzle on every date, and because a pack that stays incomplete is
 * re-requested it turned each app open into another invocation and another alarm.
 *
 * So the rule the CLAUDE.md non-determinism standard implies but does not spell out: an exported
 * Lambda handler takes the event and only the event. Anything needing an injectable clock, id or
 * random source is a function BELOW the handler, which is what tests drive.
 */
export const createModelPuzzlesHandler = async (event: ScheduledEvent | CreateModelPuzzlesEvent): Promise<void> => {
  log('Received event', { event })

  const puzzleEvent = event as CreateModelPuzzlesEvent
  // An unvalidated event field reaching a DynamoDB key is an unbounded key. Format only, not
  // isValidPackDate: a manual replay legitimately targets a date in the past.
  if (puzzleEvent.date === undefined || !isPackDateFormat(puzzleEvent.date)) {
    logError('Invalid date, refusing to generate', { date: puzzleEvent.date })
    return
  }

  await createModelPuzzles(puzzleEvent.date)
}
