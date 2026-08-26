import { allContributions, phraseGenerators, selfContainedGenerators } from '../generators'
import {
  Candidate,
  Difficulty,
  Generator,
  ModelGenerator,
  Pack,
  PackContribution,
  PackDate,
  Phrase,
  PhraseGenerator,
  Puzzle,
} from '../types'
import { log, logError } from '../utils/logging'
import { getPackByDate, setPackByDate } from './dynamodb'

// The request path runs inside GetPackByDateFunction's 15-second Lambda timeout, so it stops
// starting work at 10 seconds -- low enough that the guard actually fires rather than being
// pre-empted by the runtime. It cannot interrupt a generate() already running: this is a backstop
// against a future inRequest generator regressing, not a scheduler.
//
// EXPORTED for the budget assertion in __tests__/unit/generators/index.test.ts, which is what
// finally gives this number an owner. Today it is a budget for the WHOLE registry that every
// generator grades itself against in isolation, and at one in-request generator the sum is trivially
// met and nobody notices there is a sum.
export const ON_DEMAND_BUDGET_MS = 10_000

// Both are YYYY-MM-DD, so a lexical comparison is a chronological one -- the same property
// isValidPackDate relies on. Inclusive: a type applies on the day it ships, not the day after.
const appliesTo = (contribution: PackContribution, date: PackDate): boolean => contribution.availableFrom <= date

// Missing work is computed by comparing the difficulties already present against the generator's
// declared difficulties -- never by array index or length. This is why puzzle ids are opaque: an
// earlier design put an index in the id and used it to pick difficulty, which made the identifier a
// contract about content and left non-contiguous indices after a partial run.
//
// Takes a PackContribution rather than a generator union: it reads `type` and `difficulties` and
// nothing else, so narrowing the parameter to what it actually touches is what lets a caller hand it
// a contribution whose implementation lives in a module this file may not import.
//
// EXPORTED, because the async model builder computes what is missing BEFORE its model call. It is
// the whole of the "new helper" that handler appears to need -- there is no missingDifficultiesFor
// and no countOfType.
//
// It returns [] for a contribution that does not apply to this date, so the same filter reaches all
// three produce paths and an old date is never topped up with a type that did not exist when it was
// played. It does NOT filter bestEffort: that flag suppresses the ALARM, never the attempt, so a
// good night still fills a best-effort type. The only readers of the flag are isComplete and the
// log line naming what came up short -- hasWorkRemaining deliberately ignores it.
export const missingDifficulties = (
  contribution: PackContribution,
  existing: Puzzle[],
  date: PackDate,
): Difficulty[] => {
  if (!appliesTo(contribution, date)) {
    return []
  }
  const present = new Set(
    existing.filter((puzzle) => puzzle.type === contribution.type).map((puzzle) => puzzle.difficulty),
  )
  return contribution.difficulties.filter((difficulty) => !present.has(difficulty))
}

const countOfType = (puzzles: Puzzle[], contribution: PackContribution): number =>
  puzzles.filter((puzzle) => puzzle.type === contribution.type).length

// >= rather than ===, and the difference is not cosmetic. Exact equality makes an over-full pack
// permanently incomplete: nothing is missing so nothing is generated, so nothing is written, so the
// flag can never clear -- while create-pack.ts logs an ERROR every single day with no code path
// able to fix it. An over-full pack is reachable the moment countPerDay shrinks, which the system
// design explicitly plans for: every already-stored future pack would be stuck on that deploy.
const isSatisfied = (contribution: PackContribution, puzzles: Puzzle[]): boolean =>
  countOfType(puzzles, contribution) >= contribution.countPerDay

// TWO QUESTIONS, and they are not the same question. isComplete answers "should the client refetch
// this pack"; hasWorkRemaining answers "is there anything here still worth attempting". They differ
// on exactly one input -- a best-effort contribution -- and that difference is the whole reason both
// exist.
//
// Always the FULL registry, never the subset a caller chose to run. A build that produced only the
// self-contained puzzles must not mark the day done, or the client stops refetching and the day
// stays short.
//
// Both are dated. Without the date filter, the day a PuzzleType ships every pack ever written starts
// reporting complete: false and work remaining, so the whole archive becomes eligible for the model
// builder at once.
const isComplete = (date: PackDate, puzzles: Puzzle[]): boolean =>
  allContributions
    // Not yet shipped on that date, or short by design -- neither is a pack the client should
    // refetch. bestEffort is filtered HERE and NOWHERE else: missingDifficulties still asks for it,
    // and hasWorkRemaining below still counts it.
    .filter((contribution) => appliesTo(contribution, date) && contribution.bestEffort !== true)
    // VACUOUSLY TRUE over a date no contribution applies to, and that is a decision rather than an
    // oversight: complete: false would put such a date into a permanent client refetch, while an
    // empty pack never reaches the wire at all (get-pack-by-date answers 404 on zero puzzles).
    // What the vacuous case must NOT do is pass unremarked, so buildPack logs it by name.
    .every((contribution) => isSatisfied(contribution, puzzles))

/**
 * Whether anything in the registry still owes this date a puzzle -- the ONLY question that may gate
 * an async builder invocation.
 *
 * NOT `complete`, which is the client's refetch signal and skips a best-effort contribution
 * entirely. Both invocation sites used to read `complete`, which made the two questions one: the
 * moment a type declares bestEffort: true, a date whose only gap is that type reads complete: true
 * and no builder is ever invoked for it. It would ship zero puzzles of that type, and the request
 * path -- now the only thing that repairs a short day -- could never reach it either. That it works
 * today is an accident of the phrase types being incomplete at the nightly check, so the hand-off
 * fires as a side effect of somebody else's gap.
 *
 * `some` rather than a negated `every`, so a date no contribution applies to reports FALSE and
 * nothing is invoked for it.
 */
export const hasWorkRemaining = (date: PackDate, puzzles: Puzzle[]): boolean =>
  allContributions
    .filter((contribution) => appliesTo(contribution, date))
    .some((contribution) => !isSatisfied(contribution, puzzles))

// Everything the `complete` flag is entitled to hide, said out loud once per pack build. Each of
// these is SILENT by construction: a contribution dated into the future never runs and isComplete
// never asks for it; a best-effort type that produces nothing for a month raises no pack-level
// alarm, which is the point; and a date no contribution applies to grades complete over zero
// puzzles because [].every() is true. So each gets a line naming itself.
//
// EVERY LINE IS GATED on the thing it reports actually having happened. Ungated, all three fire on
// every buildPack -- including every GET, which walks eight dates per cold client -- and today they
// would carry an empty payload every single time, which is an INFO line with no information in the
// only state the system is currently in.
//
// The best-effort line reports OUTCOME, never permission. A line naming which types are ALLOWED to
// be short is byte-identical on a perfect night and on the one night worth logging, so this one
// names what came up short and what it owed.
//
// Here rather than in isComplete, which every build calls up to three times over.
const logWhatTheFlagHides = (date: PackDate, puzzles: Puzzle[]): void => {
  const applicable = allContributions.filter((contribution) => appliesTo(contribution, date))
  const notYetAvailable = allContributions.filter((contribution) => !appliesTo(contribution, date))
  const shortBestEffort = applicable
    .filter((contribution) => contribution.bestEffort === true)
    .filter((contribution) => !isSatisfied(contribution, puzzles))

  if (notYetAvailable.length > 0) {
    log('Contributions not yet available for this date', { date, types: notYetAvailable.map((c) => c.type) })
  }
  if (shortBestEffort.length > 0) {
    log('Best-effort contributions came up short', {
      date,
      short: shortBestEffort.map((c) => ({ present: countOfType(puzzles, c), type: c.type, wanted: c.countPerDay })),
    })
  }
  if (applicable.length === 0) {
    log('No contribution applies to this date, so an empty pack grades complete', { date })
  }
}

// A failed write must not turn a readable pack into a 500. setPackByDate converts only a
// conditional-check failure into `false`; everything else throws, and before this wrapper that
// exception propagated out to the handler's catch-all -- so a date that used to answer 200 from the
// stored pack answered 500 instead, purely because the request now also writes. `undefined` means
// "the write did not happen", distinct from `false`, which means "another run wrote first".
const tryWrite = async (date: PackDate, pack: Pack, expectedPuzzleCount: number): Promise<boolean | undefined> => {
  try {
    return await setPackByDate(date, pack, expectedPuzzleCount)
  } catch (error: unknown) {
    logError('Could not write the pack, falling back to what is already stored', { date, error })
    return undefined
  }
}

// A retry tops a pack up; it never replaces an existing puzzle. Ids are stable while content is
// not, so regenerating wholesale would leave a player's stored lull:progress attached to a
// different puzzle -- and it would discard generation work that is already correct.
//
// No pre-read of the stored `complete` flag, by any caller. That flag was frozen at write time by
// the generator registry of THAT deploy, so the day a new type ships an already-written pack still
// claims to be complete and a top-up would skip it, silently serving a short day.
//
// The caller supplies HOW to produce the missing puzzles; everything around that -- reading,
// merging, recomputing completeness, and the conditional write -- is identical whether the puzzles
// came from self-contained generators or from a model call, so it lives here once.
const buildPack = async (date: PackDate, produce: (existing: Puzzle[]) => Promise<Puzzle[]>): Promise<Pack> => {
  const existingPack = await getPackByDate(date)
  const existingPuzzles = existingPack?.puzzles ?? []

  const generated = await produce(existingPuzzles)

  const puzzles = [...existingPuzzles, ...generated]
  logWhatTheFlagHides(date, puzzles)
  const pack: Pack = { complete: isComplete(date, puzzles), date, puzzles }

  if (generated.length === 0) {
    log('Nothing to add to pack, skipping write', { complete: pack.complete, date })
    return pack
  }

  log('Writing pack', { complete: pack.complete, date, generated: generated.length, puzzles: puzzles.length })
  // Conditional on the puzzle count we read. EventBridge delivers at least once, two requests can
  // race the same cold date, and the async builder can land while a request is in flight -- so two
  // runs can both see a partial pack, both generate the same missing difficulties, and the second
  // write would silently replace the first's puzzles with different ids, orphaning any
  // lull:progress a player already stored against them.
  const written = await tryWrite(date, pack, existingPuzzles.length)
  if (written === undefined) {
    // The EXISTING PERSISTED puzzles, never `pack`. `pack` holds ids that reached no table, and
    // serving them orphans the lull:progress a client stores against them. On a cold date this
    // collapses to an empty pack and the handler answers 404, exactly as it did before the request
    // path wrote anything at all.
    return { complete: isComplete(date, existingPuzzles), date, puzzles: existingPuzzles }
  }
  if (!written) {
    log('Another run wrote this pack first, returning the stored pack', { date })
    // Return what was PERSISTED, never the discarded copy: its ids exist nowhere else. The fallback
    // cannot fire -- the condition failed because an item is there, this read is strongly
    // consistent, and nothing in this codebase deletes a pack -- but it keeps the return type total
    // and is covered by a test rather than left to that argument.
    const stored = await getPackByDate(date)
    // complete is recomputed, never taken from the stored pack, for the same reason there is no
    // pre-read above.
    return stored ? { ...stored, complete: isComplete(date, stored.puzzles) } : pack
  }
  return pack
}

// TWO calls per puzzle: the draw and one retry. Not three, and never a loop.
//
// Most of what these generators throw is a bad DRAW rather than a broken generator -- goFigure
// gives up after its own bounded search for a bank reaching the difficulty, cryptogram cannot find
// a derangement, missingvowels cannot respace a phrase away from its word boundaries -- and every
// one of those reads Math.random, so a second call draws again and usually lands. One retry is
// where the value is: a redraw that failed twice is far more likely to be a property of the INPUT
// (a Phrazle answer that will not mark all-green against itself) than a third unlucky draw, and
// those fail identically however many times they are asked.
//
// It is deliberately not exponential, jittered, or delayed. Nothing here does I/O -- there is no
// remote to back off from -- so a redraw is CPU the invocation already has, and a sleep would be
// latency spent waiting for nothing to change.
const ATTEMPTS_PER_PUZZLE = 2

/**
 * Runs `attempt` up to ATTEMPTS_PER_PUZZLE times, returning the first success and rethrowing the
 * last failure.
 *
 * The bound is STRUCTURAL rather than a counter to trust: the loop runs only the attempts that get
 * a catch, and the final attempt sits outside it, so its throw reaches the caller with no branch
 * deciding whether to give up. Per the project rule, a retry that cannot be talked into spinning is
 * the only kind that belongs in a Lambda.
 *
 * `canRetry` is how the request path declines one. fillPack checks its clock before each puzzle;
 * a redraw started after the budget is gone is latency a waiting client is already out of, so
 * generateSelfContained passes the same predicate here and the band is simply lost instead.
 */
const withRetry = async <T>(
  context: Record<string, unknown>,
  attempt: () => Promise<T>,
  canRetry: () => boolean = () => true,
): Promise<T> => {
  for (let tries = 1; tries < ATTEMPTS_PER_PUZZLE; tries++) {
    try {
      return await attempt()
    } catch (error: unknown) {
      if (!canRetry()) {
        throw error
      }
      // Logged rather than swallowed, because "how often does a redraw save us" is the only reading
      // that says whether the retry earns its keep -- and a type that needs two calls for every
      // puzzle is a generator defect a silent rescue would hide completely.
      log('Retrying a puzzle that failed to generate', { ...context, attempt: tries, error })
    }
  }
  return attempt()
}

// The catch is around each generate CALL, not around each generator. One failed call costs one
// puzzle; catching a level up would lose every puzzle of a type to a single bad draw, which is the
// exact outcome the incomplete-pack design exists to prevent.
//
// Sequential, deliberately. goFigure is pure CPU, so Promise.all measured SLOWER over the same
// trials for the microtask overhead alone. Nothing here does I/O for concurrency to overlap.
const generateSelfContained = async (
  generators: Generator[],
  date: PackDate,
  existing: Puzzle[],
  isExhausted: () => boolean,
): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  for (const [index, generator] of generators.entries()) {
    if (isExhausted()) {
      log('Fill budget spent, skipping the remaining generators', {
        date,
        skipped: generators.slice(index).map((skipped) => skipped.type),
      })
      break
    }
    for (const difficulty of missingDifficulties(generator, existing, date)) {
      if (isExhausted()) {
        log('Fill budget spent, stopping before this puzzle', { date, difficulty, type: generator.type })
        break
      }
      try {
        generated.push(
          await withRetry(
            { date, difficulty, type: generator.type },
            () => generator.generate(date, difficulty),
            // The retry answers to the SAME budget the puzzle did. On the nightly path this is
            // `() => false` inverted to always-true and costs nothing; on the request path it is
            // the clock, and declining is the difference between one slow response and two.
            () => !isExhausted(),
          ),
        )
      } catch (error: unknown) {
        // The ONE per-puzzle catch in this file that stays a logError, and the asymmetry is
        // deliberate rather than an oversight. The phrase and model lanes downgraded to `log`
        // because a handler counts each of their types against countPerDay afterwards and pages on
        // zero; NOTHING counts the self-contained lane. create-pack.ts logs the pack and hands off,
        // create-model-puzzles.ts calls createPack again as a repair and alarms only on what
        // escapes this catch, so a self-contained generator that threw on every band would be
        // invisible if this line were quiet. Downgrade it the day a per-type check exists to
        // replace it, and not before.
        logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
  return generated
}

/** How many phrases a full pack needs, so the async builder knows what to ask the model for. */
export const phrasesNeeded = (): number =>
  phraseGenerators.reduce((total, generator) => total + generator.countPerDay, 0)

// How many of the given difficulties could use this phrase. The narrower that number, the more
// expensive the phrase is to spend anywhere else.
const breadthOf = (generator: PhraseGenerator, phrase: Phrase, difficulties: Difficulty[]): number =>
  difficulties.filter((candidate) => generator.isUsablePhrase(phrase, candidate)).length

// Most-constrained-first, not first-fit, and the difference is the whole reason two phrase
// generators can share one pool. Under a tolerance band a middling phrase is acceptable to every
// difficulty a generator declares, so first-fit lets whichever difficulty ran first drain the
// middle and leaves the extremes with nothing. This takes the phrase the FEWEST of the generator's
// difficulties can use, so a phrase that only difficulty 4 can play is spent on difficulty 4.
//
// The primary key is breadth over the difficulties this generator has STILL to fill, not over every
// difficulty it declares. Declared breadth counts demand that is already satisfied, so an earlier
// difficulty spends the only phrase a later one could have used: with [2, 3, 4] and a pool of one
// derived-4 phrase and two derived-2 phrases, all three score breadth 2 against the declared set,
// pool order hands difficulty 3 the derived-4 phrase, and difficulty 4 is left with a derived 2 it
// cannot use -- zero difficulty-4 puzzles from a pool that could have served all three.
//
// Declared breadth stays on as the SECOND key, which is not a leftover. Once a generator reaches its
// last missing difficulty every usable phrase scores 1 on the primary key, and without the second
// key pool order would hand difficulty 4 a middling phrase while the one phrase only difficulty 4
// can play goes to the next generator. Pool order is the third and final tiebreak, which is what
// strictly-less-than gives.
const bestFitIndex = (
  generator: PhraseGenerator,
  difficulty: Difficulty,
  remaining: Phrase[],
  pending: Difficulty[],
): number => {
  let best = -1
  let narrowest = Number.POSITIVE_INFINITY
  let narrowestDeclared = Number.POSITIVE_INFINITY

  for (const [index, phrase] of remaining.entries()) {
    if (!generator.isUsablePhrase(phrase, difficulty)) continue
    const breadth = breadthOf(generator, phrase, pending)
    const declared = breadthOf(generator, phrase, generator.difficulties)
    if (breadth < narrowest || (breadth === narrowest && declared < narrowestDeclared)) {
      best = index
      narrowest = breadth
      narrowestDeclared = declared
    }
  }
  return best
}

// What the pool left could still serve, counted per declared difficulty. Logged only when a band
// finds nothing, which is the moment the number is worth having.
//
// "No usable phrase for this difficulty" cannot distinguish an EMPTY pool from a pool of the wrong
// shape, and the shape is what actually goes wrong: a batch of twenty-one phrases that serves
// difficulties 2 and 3 several times over and difficulty 4 not at all is a starved band, not a
// starved run, and the two want opposite fixes. Generic over the generator -- this reads nothing but
// the predicate the generator already declares, so it says nothing about familiarity, ciphers or
// vowels and works for a phrase type this deploy has never heard of.
const poolBreadth = (generator: PhraseGenerator, remaining: Phrase[]): Record<number, number> =>
  Object.fromEntries(
    generator.difficulties.map((candidate) => [
      candidate,
      remaining.filter((phrase) => generator.isUsablePhrase(phrase, candidate)).length,
    ]),
  )

// One phrase per puzzle, never reused within a pack -- which is what stops a single day shipping
// the same answer twice. Running short is not an error: the pack is written incomplete and the
// next retry or request tops it up.
const generateFromPhrases = async (date: PackDate, phrases: Phrase[], existing: Puzzle[]): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  const remaining = [...phrases]

  for (const generator of phraseGenerators) {
    const missing = missingDifficulties(generator, existing, date)
    for (const [position, difficulty] of missing.entries()) {
      // The tail of the list, so `pending` is the difficulty being filled plus every one still to
      // come -- never the ones already handled. A difficulty this run skipped for want of a usable
      // phrase is not retried, so dropping it from the count is right rather than merely convenient.
      const index = bestFitIndex(generator, difficulty, remaining, missing.slice(position))
      if (index === -1) {
        // CONTINUE, never return and never break. This used to `return generated`, which was
        // harmless while there was one phrase generator and means ZERO puzzles of every later type
        // the moment there are two.
        //
        // `break` was the first fix and does not go far enough: bestFitIndex returns -1 for "no
        // remaining phrase suits THIS difficulty", not for "the pool is empty". A batch of nothing
        // but hard phrases finds nothing for difficulty 2 and would abandon difficulties 3 and 4,
        // which could have used them -- the same starvation the selection rule exists to prevent,
        // one level down. The loop is over a finite declared list, so continuing cannot spin.
        log('No usable phrase for this difficulty, trying the next', {
          date,
          difficulty,
          remaining: remaining.length,
          type: generator.type,
          // The line that turns "a band starved" into "and here is the shape of the pool that
          // starved it". A zero against this difficulty beside healthy counts against the others is
          // a supply problem in the phrase batch; zeroes across the board are simply an empty pool.
          usableByDifficulty: poolBreadth(generator, remaining),
        })
        continue
      }
      const [phrase] = remaining.splice(index, 1)
      try {
        // The retry hands back the SAME phrase. Reaching for a different one would re-enter
        // bestFitIndex, which is a selection decision rather than a retry -- and the phrase is
        // already spliced out of `remaining`, so the allocator has moved on. A failure that is a
        // property of the phrase costs one wasted CPU call; a bad draw inside the generator is
        // rescued, which is the trade this makes.
        generated.push(
          await withRetry({ date, difficulty, type: generator.type }, () =>
            generator.generate(date, difficulty, phrase),
          ),
        )
      } catch (error: unknown) {
        // Per call, as above. A phrase that cannot be respaced costs one puzzle, not the type. The
        // phrase is already spent, so the next difficulty does not retry the same failing input.
        //
        // A `log`, NOT a logError, for the reason stated three lines up: this is RECOVERED. The
        // other bands are untouched, the pack reads incomplete, and the next GET re-triggers the
        // builder through hasWorkRemaining. The alarm for this lane is create-phrase-puzzles.ts's
        // per-type check, which is the only place the count against countPerDay is knowable -- and
        // this stack's one alarm channel is a level="ERROR" subscription, so paging here means a
        // type that shipped two of three puzzles wakes someone at the same volume as one that
        // shipped none. The `error` stays on the line: the reading is kept, only the page is not.
        log('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
  // The pool accounting, once, whether or not anything starved. A run that turns twenty-one phrases
  // into six puzzles and discards fifteen used to log the twenty-one and the six in different lines
  // and never the fifteen, which reads as a scarce batch when it was in fact an unspendable one.
  log('Phrase pool spent', { date, generated: generated.length, pool: phrases.length, unused: remaining.length })
  return generated
}

/**
 * The nightly path: every self-contained generator, no time budget.
 *
 * It makes no model call and never will. Anything needing a phrase is added afterwards by the
 * async builder, which is the only thing in this stack that reaches Bedrock.
 */
export const createPack = (date: PackDate): Promise<Pack> =>
  buildPack(date, (existing) => generateSelfContained(selfContainedGenerators, date, existing, () => false))

/**
 * The request path: only the self-contained generators graded fast enough, bounded by the Lambda's
 * timeout.
 */
export const fillPack = (date: PackDate, now: () => number = Date.now): Promise<Pack> => {
  const start = now()
  return buildPack(date, (existing) =>
    generateSelfContained(
      selfContainedGenerators.filter((generator) => generator.inRequest),
      date,
      existing,
      () => now() - start >= ON_DEMAND_BUDGET_MS,
    ),
  )
}

/**
 * The async builder's path: turn already-generated phrases into the puzzles that need them.
 *
 * Takes phrases rather than fetching them, so this module never reaches a model and the phrases are
 * never stored -- they exist only in the invocation that generated them.
 */
export const addPhrasePuzzles = (date: PackDate, phrases: Phrase[]): Promise<Pack> =>
  buildPack(date, (existing) => generateFromPhrases(date, phrases, existing))

// First fit in the order the generator returned them, marking each draft spent so one can never fill
// two slots -- the same rule generateFromPhrases applies to a phrase, one lane over.
//
// NOT most-constrained-first. bestFitIndex exists to stop several generators competing over ONE
// exhaustible shared pool, and a ModelGenerator allocates from a pool it asked for itself -- so when
// a band starves the fix is to ask for more of that band in the same call, which is a prompt change
// rather than an allocator. Candidate.usableAt carries the breadth information if a type ever wants
// to sort locally before handing the list over.
const selectCandidates = (
  missing: Difficulty[],
  candidates: Candidate[],
): { candidate: Candidate | undefined; difficulty: Difficulty }[] => {
  const spent = new Set<Candidate>()
  return missing.map((difficulty) => {
    const candidate = candidates.find((entry) => !spent.has(entry) && entry.usableAt.includes(difficulty))
    if (candidate !== undefined) {
      spent.add(candidate)
    }
    return { candidate, difficulty }
  })
}

/**
 * The model lane's path: turn one type's gated candidates into the puzzles a pack is missing.
 *
 * THE CATCH IS AROUND EACH build() CALL, never around the generator and never around the candidate
 * list -- the same rule stated above generateSelfContained, reaching this lane from a direction that
 * rule's own wording does not cover. A ModelGenerator makes exactly ONE fetchCandidates call for the
 * whole type, so it never reaches generateSelfContained's per-generate catch at all, and a throw at
 * that level would cost every declared difficulty rather than one puzzle -- the outcome the
 * per-puzzle isolation rule exists to prevent. A build that throws, for ANY reason including a
 * transform's own round-trip check, costs one puzzle out of countPerDay. Nothing propagates out.
 *
 * A code-defect gate is a logError-with-reason rejection at runtime and a throwing assertion in a
 * test. It is NEVER a throw on the nightly path, because there is no seam on that path where a throw
 * stays a throw: every one of them converts the throw back into the quiet drop throwing was proposed
 * to avoid.
 *
 * `missing` is a PARAMETER rather than something this function re-derives, and that closes a real
 * seam. The handler computes it against a pack it read BEFORE the model call; buildPack reads the
 * pack AGAIN, later, inside its own produce, and the two can disagree -- a sibling generator or a
 * racing request may have written in between. Re-deriving inside the produce makes the ask and the
 * fill answer to different reads: more bands than asked for means a short candidate list and a
 * shortfall the type did not have to have, fewer means spent candidates silently discarded. So the
 * handler's ask stays authoritative for THE ASK -- the candidate list was drawn against that number
 * and no other.
 *
 * THE FILL IS FILTERED against buildPack's read all the same, and that is not the same decision.
 * NOTHING ON THIS PATH DEDUPES: the merge is [...existingPuzzles, ...generated] and no id is ever
 * compared, here or in setPackByDate. Rebuilding a band that filled in the meantime therefore writes
 * two puzzles under one id -- countOfType counts both, isSatisfied's `>=` grades the type satisfied
 * on one fewer distinct puzzle than it owes, the pack is written complete: true, and the band that
 * genuinely was missing is never built. hasWorkRemaining then reports false, so no builder is
 * invoked for that date again and the client stops refetching a short day. It is reachable: only
 * get-pack-by-date.ts takes claimPackGeneration, so a nightly and a request-path invocation for the
 * same date overlap freely, and EventBridge delivers at least once.
 *
 * This is the only produce that needs the filter written out. generateSelfContained and
 * generateFromPhrases both derive their own work from buildPack's `existing` and cannot ask for a
 * band it already holds.
 *
 * It takes the whole ModelGenerator rather than a PackContribution even though it reads only `type`.
 * This is the model LANE's function and its log lines say so; narrowing the parameter would make it
 * look callable from the phrase lane, which would silently skip generateFromPhrases' allocator.
 */
export const addModelPuzzles = (
  date: PackDate,
  generator: ModelGenerator,
  missing: Difficulty[],
  candidates: Candidate[],
): Promise<Pack> =>
  buildPack(date, async (existing) => {
    const generated: Puzzle[] = []
    // missingDifficulties over `existing` would answer a different question -- it would ADD bands the
    // handler never asked for, which is the re-derivation the docstring above rejects. This only ever
    // removes from the ask.
    const present = new Set(
      existing.filter((puzzle) => puzzle.type === generator.type).map((puzzle) => puzzle.difficulty),
    )
    const unfilled = missing.filter((difficulty) => !present.has(difficulty))
    if (unfilled.length < missing.length) {
      // GATED, so a run that raced nobody says nothing. Worth a line when it does fire: it is the
      // only visible sign that two builders overlapped on one date, and the candidates it frees are
      // spent on a band that still needs one rather than discarded.
      log('Some bands filled between the ask and the read, skipping them', {
        date,
        skipped: missing.filter((difficulty) => present.has(difficulty)),
        type: generator.type,
      })
    }
    for (const { candidate, difficulty } of selectCandidates(unfilled, candidates)) {
      if (candidate === undefined) {
        // A logged shortfall, never a throw. Exhaustion of a band is a normal property of a draw --
        // no remaining candidate lists that difficulty in usableAt -- and the other bands are
        // untouched. The per-type ERROR when the TYPE ends short is the handler's, which is where
        // the count against countPerDay is knowable.
        log('No usable candidate for this difficulty', { date, difficulty, type: generator.type })
        continue
      }
      try {
        // Rebuilds the SAME candidate, and that is cheap by construction: fetchCandidates ran once
        // for the whole type, so nothing here reaches a model and a retry costs no tokens.
        generated.push(
          await withRetry({ date, difficulty, type: generator.type }, () => candidate.build(date, difficulty)),
        )
      } catch (error: unknown) {
        // Per CALL. The candidate is already spent, so the next difficulty does not retry the same
        // failing draft -- the same rule generateFromPhrases applies to a spent phrase.
        //
        // A `log`, matching the `No usable candidate` arm right above it, which already states the
        // rule: the per-type ERROR belongs to the handler, and create-model-puzzles.ts raises it
        // when a required type ends at zero. One spent draft that would not build is recovered --
        // the remaining bands still draw -- so it is a reading, not a page.
        log('Could not build a model puzzle', { date, difficulty, error, type: generator.type })
      }
    }
    return generated
  })
