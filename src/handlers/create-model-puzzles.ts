import { phraseHistoryDays } from '../config'
import { modelGenerators } from '../generators/model'
import { getPackByDate, getRecentPacks } from '../services/dynamodb'
import { addModelPuzzles, createPack, missingDifficulties } from '../services/packs'
import { PackDate, ScheduledEvent } from '../types'
import { log, logError, logWarning } from '../utils/logging'
import { isTransientModelFailure } from '../utils/model-errors'
import { isPackDateFormat, packDateWindow } from '../utils/pack-date'

// Declared HERE and not in src/types.ts, matching create-pack.ts's own CreatePackEvent. One field,
// the same isPackDateFormat validation, the same reason.
interface CreateModelPuzzlesEvent {
  date?: string
}

// Stop STARTING A WRITE past 890 seconds, leaving 10 of the 900 for the write already in flight.
//
// IT BOUNDED THE FETCHES AND IT NO LONGER CAN. The loop below fetches every generator CONCURRENTLY,
// so there is no sequential work left in front of a fetch for a clock reading to stand in: by the
// time the first reading is taken every fetchCandidates has already started. What is still
// sequential is the WRITE LOOP, and that is the whole of what this number now bounds.
//
// THE NUMBER HAD TO MOVE WITH THE MEANING, and leaving 300_000 in place would have lost the night
// rather than merely read oddly. The write loop begins when the SLOWEST fetch settles;
// crypticClueGenerator's fetchCandidates is TWO SERIAL CALLS, create-cryptic-clues then
// review-cryptic-clues, estimated at ~614s together; so on a normal night the FIRST reading in the
// write loop is already past a 300s bound, every type breaks on it, and finished candidates that
// cost 600 seconds of Opus are dropped unwritten.
//
// The ~614s is bedrock.ts's one measured figure extrapolated -- 16000 tokens took 204s, so
// create-cryptic-clues at 32000 lands near 410s and review-cryptic-clues at 16000 near 204s. THE
// 204s WAS MEASURED ON create-phrases, NOT ON EITHER OF THESE PROMPTS, and it is being extrapolated
// linearly to 2x on one and 1x on the other; tokens-per-second is not linear in maxTokens and
// thinkingEffort differs across all three, so treat 614 as an order of magnitude. It no longer sizes
// this constant -- concurrency did that job -- but it is still what says whether the fetches fit
// inside 900s at all, so re-measure it against a real nightly run rather than trusting it.
//
// IT WAS ~510s, AND THE 100 SECONDS CAME FROM review-cryptic-clues MOVING BACK TO 16000. That cap
// was cut to 8000 by ab70a10 as half of a timeout fix whose other half -- a 300_000 budget reserving
// 600s for this generator -- this file replaced with concurrency. See the derivation on
// generators/crypticclue/review.ts, which owns that number: the short of it is that the cut's stated
// premise ("at most eight short verdicts, so the rest was tail risk") described a call that judged
// only the definition, and the call now judges a synonym per cue on devices where it IS the
// verification. AND A CAP IS NOT A SPEND: a healthy review finishes in the same wall clock at either
// number, so ~614 is a worst case that a good night does not pay.
//
// 890 IS 900 MINUS ONE WRITE. addModelPuzzles is a GetItem, the local candidate.build work, and one
// conditional UpdateItem -- seconds, not minutes; the two writes this handler makes are ~4s of wall
// clock together. The 10 is ~2.5x that, and it is per ITERATION because the reading is taken per
// iteration: each pass needs one write's worth of reserve, never every remaining write's.
//
// IT WAS 30, AND 30 WAS NOT CONSERVATIVE, IT WAS DESTRUCTIVE. The reserve was nominally sized for
// the SDK retrying a throttled conditional write, and that retry is not 30 seconds long:
// dynamodb.ts constructs `new DynamoDB()` with no maxAttempts override, so it runs the SDK's default
// standard retry mode -- 3 attempts, DEFAULT_RETRY_DELAY_BASE 100ms, exponential -- which is under a
// second of added backoff. A 30-second reserve was ~50x the thing it claimed to cover.
//
// THE ASYMMETRY IS THE WHOLE REASON THE NUMBER MOVED, and it must stay written down because the
// instinct that raises a reserve "to be safe" is exactly wrong on THIS guard. Enumerate the bands
// against T_fetch, the wall clock when the slowest fetch settles -- which is essentially the write
// loop's FIRST reading, since nothing sequential precedes it:
//
//   * T_fetch < BUDGET                -- the guard never fires and the value is irrelevant.
//   * BUDGET <= T_fetch < ~896s       -- the guard fires on the FIRST entry and breaks, so NOTHING
//                                        is written: every type's candidates are discarded after the
//                                        Opus tokens were already spent, on a night where both
//                                        writes (~4s) would have fit inside the 900.
//   * T_fetch >= ~896s                -- the writes genuinely do not fit; the guard's ERROR is
//                                        strictly better than the kill that would replace it.
//
// At 870_000 the middle band is ~26 seconds wide and the useful one ~4, so the guard was NET
// NEGATIVE over six times the window it was net positive over. At 890_000 those are ~6 and ~4. THE
// RESERVE IS NOT A SAFETY MARGIN: every second added to it is a second in which the guard throws
// away completed, paid-for work that would otherwise have landed. Anyone tempted to raise it again
// is trading a certain loss for a hypothetical one, and needs a MEASURED write cost to justify it.
//
// WHAT THE GUARD BUYS, AND -- SINCE THE FETCHES WENT CONCURRENT -- WHAT IT NOW COSTS. An uncaught
// 900-second timeout is the ONE failure the per-type catch below cannot contain: MaximumRetryAttempts
// is 0, so nothing runs again and the funnel line never prints. The guard turns that into an
// invocation that returns with an ERROR naming what it dropped. On the serial base that was nearly
// free, because firing meant the skipped type's tokens were NEVER BOUGHT -- the guard declined to
// spend. It fires now strictly AFTER every fetch has settled, so firing means the tokens were bought
// and the results thrown away. Same line in the log, opposite price, and that inversion is why the
// number is derived from a write rather than from a fetch.
//
// SO STATE THE TWO HALVES PLAINLY, because "acceptable" was recorded here where "correct" was not,
// and the difference is what somebody re-reading this needs. Mechanically: `start` is taken on the
// first line of createModelPuzzles and the NEXT reading of the clock is inside the write loop, after
// the fetch phase has settled. There is no reading in between, and there is nowhere to put one that
// would mean anything -- every fetchCandidates is already in flight by the time the map returns.
//
//   * WHAT IT STILL DOES: it bounds the INVOCATION against the 900-second Lambda timeout. A night
//     whose fetches ran long returns with an ERROR naming the types it dropped instead of being
//     killed mid-write, and a killed invocation leaves no record and no retry.
//   * WHAT IT NO LONGER DOES: it does not prevent a single token of Bedrock spend. Not "less often"
//     -- never. Every reading it can take happens after every model call has been paid for. On master
//     the clock was read before each fetchCandidates, and the suite held that with
//     `expect(mockFetchSecond).not.toHaveBeenCalled()`; that row was deleted with the property, and
//     the row that replaced it asserts the opposite -- mockFetchSecond WAS called -- so the loss is
//     pinned rather than merely written down here.
//
// This is deliberate and it is not being restored: the spend it used to decline was itself the
// starvation bug -- the budget one type spent was a budget the other type never got -- and buying it
// back means putting the types back in a queue. It is recorded as a cost paid, not as a cost avoided.
//
// A RETRY STILL BLOWS THIS RESERVE AND NO BUDGET HERE CAN STOP IT. bedrock.ts sets maxAttempts 4,
// and an attempt re-runs the call rather than resuming it, so a single retried create-cryptic-clues
// is ~820s of fetch on its own -- past this bound before a write is ever reached, and past the 900
// shortly after.
//
// CONCURRENCY DOES NOT MAKE THAT WORSE. The earlier reading here -- "two retry storms now overlap
// where they used to queue" -- had the arithmetic backwards, and is corrected rather than deleted
// because it is the intuitive answer and it is wrong. Overlapping is max() and queueing is sum(): a
// retried call that costs 820s costs the INVOCATION 820s beside its sibling, and 820s PLUS the
// sibling's ~250s behind it. Concurrency strictly REDUCES what a retry costs this loop. What it
// cannot do is make a retry cheaper than the retried call, which is the whole reason it is not the
// fix.
//
// WHAT DID NARROW is review-cryptic-clues moving 8000 -> 16000, and that is a separate and real
// point. The fetch estimate went ~510s -> ~614s, so headroom under the 900 went ~386s -> ~282s: one
// retried review call (~614 + ~204 = ~818s) still fits, two (~1022s) do not, and at 8000 the second
// nearly did. That is a genuine narrowing of an already-unbounded risk and the reason to watch this;
// it is not a reason to shrink the number below, which bounds writes and not fetches.
//
// Either way it is a property of the CLIENT, not of this loop -- a bound checked before work starts
// cannot bound what that work does after it starts -- and the fix, if the logs ever show one, is a
// client with its own maxAttempts for 900s generators, not a smaller number here.
//
// The same distinction ON_DEMAND_BUDGET_MS draws: this bounds when the last WRITE may START, not
// when the invocation ends, and it cannot interrupt anything already in flight.
//
// A budget for the WHOLE LOOP, not 890 seconds per type. It is checked once per iteration against a
// single `start`, two model types share it, and Phase 2's types arrive into the same handler and the
// same number.
//
// THREADING A DEADLINE into fetchCandidates was considered and rejected. It changes the
// ModelGenerator interface for one type's benefit, and a number checked once per iteration bounds the
// same risk from outside the generator -- where the loop, not the call, is what has to be stopped.
//
// THE RESIDUAL THIS REPLACED was "when Themed Anagrams runs past 300s, Cryptic Clue is skipped",
// which the concurrent fetch removes outright: total fetch wall time is max() rather than sum(), and
// neither independent generator can starve the other of a budget it no longer shares. What takes its
// place is RARER AND STRICTLY LARGER, and the earlier reading of this paragraph -- that the
// replacement was "smaller" -- was wrong and is corrected here rather than deleted. The old residual
// was GRADUATED: it cost the LAST type in registry order, deliberately the bestEffort one, so a slow
// night shipped a pack that isComplete still called full. The new one is ALL-OR-NOTHING: the types
// finish together, so the first reading skips EVERY write, themedanagrams included -- a genuinely
// incomplete pack rather than a best-effort shortfall. It needs an 890-second fetch to happen at all
// where the old one needed a 300-second one, so it is far less likely; when it does happen it takes
// more. An ERROR naming them still beats a kill.
//
// EXPORTED FOR ONE REASON: to be asserted against template.yaml's createModelPuzzlesTimeout of 900.
// At 300_000 this guard survived a timeout drop to 600 and still worked; at 890_000 it is 98.9% of
// the ceiling, so the same drop makes it silently UNREACHABLE -- no test red, no log line, just a
// guard that never fires again and a function that gets killed instead. ON_DEMAND_BUDGET_MS is
// exported for the same reason and asserted the same way; __tests__/unit/generators/index.test.ts
// holds both.
export const GENERATOR_BUDGET_MS = 890_000

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
 * fetchCandidates that HANGS -- as distinct from throwing -- is still unbounded, and the
 * per-generator catch does not help against a hang. Concurrency changes its SHAPE and not its
 * existence. A hang no longer delays a sibling's CALL, because both calls are already in flight; it
 * does hold the allSettled that gates every write -- allSettled waits for a hang exactly as all does,
 * since neither can settle on a promise that never settles -- so a hang now costs the sibling's finished
 * candidates as well as its own. That is not a loss the serial loop avoided -- a hang ran to the
 * 900s kill there too, and killed the hung type's write with it -- but it is one more type's work
 * riding on one type's call, and the honest version of this handler's guarantee is that a hang ends
 * the night. Only a client-side timeout can bound it; the budget guard bounds the write loop.
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

    // FETCH CONCURRENTLY, WRITE ONE AT A TIME, and the split is the whole of what this loop is.
    //
    // The generators are INDEPENDENT: each reads the pack it was handed and the same recent window,
    // and neither can see the other's output until a write lands. Nothing sequenced them but the
    // `for` loop, and a 300-second budget checked inside that loop turned "themedanagrams was slow"
    // into "crypticclue did not run" -- see GENERATOR_BUDGET_MS above, where that residual used to be
    // recorded as the design. Total fetch wall clock is now max() over the types rather than sum(),
    // which is what removes it rather than merely widening it.
    //
    // THROUGHPUT IS NOT THE CONSTRAINT and it is worth saying so before someone adds a semaphore.
    // The quota, with its provenance because every other number here carries one: AWS Service
    // Quotas console, 2026-09-07, `[bedrock-mantle endpoint]` for Claude Opus 5 -- 20,000,000 input
    // tokens/minute and 2,000,000 output tokens/minute, both sitting at the AWS default. Against a
    // 32000-token call, two concurrent generator calls are noise; the ceiling this loop lives under
    // is the 900-second Lambda timeout, not a rate limit.
    //
    // WHAT CONCURRENCY ACTUALLY MOVED, stated so the next person adding a fan-out knows the running
    // total: services/lambda.ts invokes both slow builders at once and services/phrases.ts runs a
    // 3-way Promise.all of Opus calls inside one of them, so peak concurrent Opus invocations
    // against a single inference profile went from 4 to 5 on this change. Still far under the quota
    // above, and worth watching rather than guarding, because THROTTLING HERE IS INVISIBLE:
    // isTransientModelFailure classifies 429 as transient (utils/model-errors.ts), so a throttled
    // generator degrades to logWarning and a short pack, and the level="ERROR" subscription filter
    // -- the only alarm in this stack -- never sees it.
    //
    // What concurrency does NOT bound is bedrock.ts's maxAttempts of 4 -- two overlapping retry
    // storms are worse than two queued ones -- which is stated at the constant and is a property of
    // the client rather than of this loop.
    //
    // EACH ARM CATCHES ITS OWN FAILURE and that is load-bearing, not tidiness: an uncaught throw in
    // one generator would discard a sibling's completed work -- the whole-night loss this split exists
    // to remove, rebuilt one level up. services/phrases.ts states the same rule at its own Promise.all,
    // for the same reason.
    //
    // allSettled AND NOT all, WHICH IS THE SAME INVARIANT MADE STRUCTURAL. Promise.all rejects on the
    // FIRST rejection and abandons the rest, so under `all` the guarantee above held only as long as
    // EVERY LINE INSIDE the arm's catch was itself throw-free -- and two of those lines are a logger
    // call. That is not a hypothetical shape: a structured logger meeting a circular AWS SDK error
    // (`error.$response` holding a socket that references the request) throws inside the handler for
    // the throw, the arm rejects, `all` discards a sibling's completed ~410s of Opus output, and the
    // only line printed is the outer catch's. `allSettled` never rejects, so the sibling's value is
    // returned no matter what the neighbor's catch does, and "each arm catches its own failure" stops
    // being a claim about the code inside the catch.
    //
    // THE PRICE IS ONE UNWRAP, and it is paid here rather than in the write loop so the loop keeps
    // reading a plain `(settled | undefined)[]`. The `undefined` a rejected arm collapses to is the
    // same hole a skipped or failed type leaves, which is exactly what the budget guard's `skipped`
    // list already means by it.
    //
    // THE REJECTED ARM STILL GETS A LINE, and it deliberately does NOT carry the error object.
    // Whatever reached here got past a catch whose own logger call is the leading suspect, so passing
    // the same value to the same logger is how this line throws too -- and this one is outside every
    // per-type try, so it would land on the outer catch and cost the writes anyway. `String(reason)`
    // is Error.prototype.toString, which reads `name: message` without walking a single property, so
    // it survives the circular case that motivates the whole paragraph. A DIFFERENT MESSAGE from the
    // arm's own, because this is a different event: not "the model call failed" but "the code that
    // reports a failed model call failed", which is always a defect and never transient.
    //
    // THE `try` ENCLOSES THE WHOLE MAPPED BODY, missingDifficulties and its log included, and that is
    // the difference between the claim above being true and being nearly true. It shipped with the
    // skip OUTSIDE the try, where a throw from missingDifficulties rejects the mapped promise rather
    // than being logged, and the concrete path is not exotic: a pack row whose stored Data
    // deserializes with `puzzles` as an object rather than an array survives `?.puzzles ?? []`, and
    // `existing.filter` inside missingDifficulties then throws a TypeError for modelGenerators[0]
    // while modelGenerators[1]'s Opus call is already in flight. Under Promise.all that rejected the
    // whole phase, the handler returned through the outer catch, the container froze with a pending
    // Bedrock call, and NOTHING was written; on the serial loop the same throw cost ZERO tokens.
    //
    // allSettled BELOW MAKES THAT SURVIVABLE AND NOT CORRECT, which is why this paragraph stays. The
    // sibling's write now lands either way -- that is the point of allSettled -- but a throw hoisted
    // out of this try is reported as `A generator arm failed outside its own catch`, a line whose
    // whole subject is that the reporting path broke, rather than as this type's own failure with its
    // error attached. Any cheap, local, "obviously safe" line moved out of this try downgrades a named
    // per-type failure into that.
    const settledArms = await Promise.allSettled(
      modelGenerators.map(async (generator) => {
        try {
          // BEFORE the model call, and still before it now that the call is concurrent -- the skip is
          // inside the mapped function precisely so no arrangement of the fetches can move it after
          // one. With two builders behind one flag, "the pack is incomplete" no longer means "your
          // type is missing", so an invocation that fetches first burns Opus tokens to add nothing.
          // bestEffort makes this load-bearing rather than merely thrifty: a best-effort type is
          // skipped by isComplete, so its absence never re-triggers the builder, and the only thing
          // deciding whether it runs tonight is missingDifficulties reading the pack it already has.
          const missing = missingDifficulties(generator, existing, date)
          if (missing.length === 0) {
            log('Nothing missing for this type, skipping the model call', { date, type: generator.type })
            return undefined
          }

          return { candidates: await generator.fetchCandidates(missing.length, recent, date), generator, missing }
        } catch (error: unknown) {
          // THE SAME LINE THE WRITE ARM BELOW WRITES, deliberately, and not two messages for what
          // was one. This catch is the half of the old per-type arm that carries a raw Bedrock error
          // out of fetchCandidates; splitting the arm in two to fetch concurrently must not split the
          // log query that reads it, or a subscription filter written against the old handler goes
          // half blind on the day this shipped. The `type` field is what says which type it was, and
          // it was already there.
          //
          // Level by CAUSE. A 503 here is the model service being unavailable after four SDK
          // attempts: the type is short, the pack stays incomplete, and the next GET for this date
          // re-reads what is missing -- there is nothing for a person to do. Anything else is a
          // defect and still pages, which is what a throw out of missingDifficulties gets.
          const write = isTransientModelFailure(error) ? logWarning : logError
          write('Could not add puzzles for this type', { date, error, type: generator.type })
          return undefined
        }
      }),
    )

    const fetched = settledArms.map((arm, index) => {
      if (arm.status === 'fulfilled') {
        return arm.value
      }

      logError('A generator arm failed outside its own catch', {
        date,
        reason: String(arm.reason),
        type: modelGenerators[index].type,
      })

      return undefined
    })

    // SERIAL, and this is the property the concurrency above must not reach. addModelPuzzles is
    // read-merge-conditional-write and its put is conditional on the puzzle count it read, so two
    // concurrent writes are two racers on one condition: the loser's puzzles are discarded, and
    // discarded QUIETLY -- services/packs.ts logs a lost race below ERROR, because a lost race
    // against another INVOCATION is normal. Fetching is the expensive half and writing is not, so
    // running the writes one at a time costs a few hundred milliseconds and buys both types' output.
    for (const [index, settled] of fetched.entries()) {
      // A type that had nothing missing, or one whose fetch failed and has already logged why.
      // BEFORE the clock reading, which is what keeps a full pack from spending budget readings it
      // never earned -- and, more to the point, from raising the ERROR below over types with no work.
      if (settled === undefined) {
        continue
      }

      // AFTER the skip above, and the order is the difference between an alarm and a page nobody
      // owes an answer to. The level="ERROR" subscription filter is the only alarm in this stack, so
      // this line wakes somebody up; ahead of the skip it fired on a slow night over types whose
      // work was already done, which is an alarm about a pack that was full.
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
      // `>=`, not `>`. This bounds when the last WRITE may START, leaving 10s of the 900 for it. `>=`
      // rather than `>` because the 10 is a LOWER bound on a conditional write the SDK may retry, so
      // the boundary reading is spent by choice rather than because a write starting exactly at it
      // would have no reserve -- it would have exactly all of it. It read 30 while the constant above
      // still did; the constant's own note is where 890 -- 900 minus one ~4s write, reserved per
      // ITERATION -- is derived, and why a LARGER reserve is destructive here rather than safe.
      //
      // `skipped` names the types that HAD A WRITE TO LOSE -- this one and every later entry that
      // came back with candidates -- and it is read off `fetched` rather than off modelGenerators for
      // exactly that reason.
      //
      // It was read off modelGenerators, sliced from this generator's index, and that made the alarm
      // LIE the moment the fetches went concurrent. `skipped` then named every later type in registry
      // order including ones with nothing to skip: a night where themedanagrams fetched fine, then
      // crypticclue 503'd and logged its own WARN, then the budget was spent on iteration 0, printed
      // `skipped: ['themedanagrams', 'crypticclue']` -- attributing to a spent budget a type that had
      // already failed for an unrelated reason and never had a write to lose. The undefined holes in
      // `fetched` are precisely the types with nothing outstanding (nothing missing, or a fetch that
      // failed and already logged why), so filtering them out is the whole correction.
      //
      // flatMap rather than filter-then-map because it narrows away the undefined without a type
      // predicate; the list is types, never array holes.
      if (now() - start >= GENERATOR_BUDGET_MS) {
        logError('Model budget spent, skipping the remaining types', {
          date,
          skipped: fetched
            .slice(index)
            .flatMap((remaining) => (remaining === undefined ? [] : [remaining.generator.type])),
        })
        break
      }

      const { candidates, generator, missing } = settled

      // Swallowed PER TYPE and never rethrown out of the handler, for the same reason
      // create-phrase-puzzles.ts swallows: a Lambda retry re-runs every type including the ones that
      // succeeded. The retry, at the right granularity, is the next GET for this date -- it re-reads
      // what is missing and hands off only that, under claimPackGeneration.
      try {
        // `missing` is passed through rather than re-derived -- see addModelPuzzles.
        const { outcome, pack } = await addModelPuzzles(date, generator, missing, candidates)
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
            /*
             * WHICH ZERO IT WAS, on the line that pages, because three different failures reach it
             * and the alert used to name none of them.
             *
             * `candidates` separates a SUPPLY failure from everything else: zero means
             * fetchCandidates came back empty and the per-type pool line is where the reason is.
             * `outcome` separates the other two: 'nothing-generated' is a pool that had candidates
             * and could not build one of them, and 'lost-race' means this run DID build them and
             * the conditional write lost -- which is not a failure at all, and was the reading
             * hardest to reach because services/packs.ts logs both of those below ERROR, so the
             * email carried no trace of either.
             *
             * The per-type pool counters deliberately do NOT come up here. setsReturned,
             * droppedByGate and the rest are themedanagrams' shape, ModelGenerator returns a bare
             * Candidate[] on purpose, and widening that so one type can put a histogram on a shared
             * line is the thing generators/themedanagrams/generator.ts already refuses for the same
             * reason. `candidates` is the handler-level quantity; the breakdown stays in
             * `Anagram set pool spent`.
             */
            logError('Model type produced nothing', {
              candidates: candidates.length,
              date,
              outcome,
              type: generator.type,
              wanted: generator.countPerDay,
            })
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
        // Level by CAUSE, the same selector the fetch arm above uses and the same message. This half
        // of the old per-type arm carries what addModelPuzzles can throw -- a gate that threw, a
        // payload ajv refused, a DynamoDB failure the service did not swallow -- which is a defect
        // and pages. isTransientModelFailure is kept here anyway rather than reduced to logError:
        // candidate.build runs inside addModelPuzzles, a type whose build calls a model would raise a
        // 503 on this side of the split, and the level would silently be wrong for it.
        //
        // `Model type produced nothing` above is deliberately NOT given the same treatment. It fires
        // only when addModelPuzzles RETURNED and added none, so no upstream failure reached it, and
        // it is the page that caught themedanagrams coming back empty on the prod nightly.
        const write = isTransientModelFailure(error) ? logWarning : logError
        write('Could not add puzzles for this type', { date, error, type: generator.type })
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
