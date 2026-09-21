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
// STARTING work at 10 seconds. It cannot interrupt a generate() already running: a backstop
// against a future inRequest generator regressing, not a scheduler. Exported for the budget
// assertion in __tests__/unit/generators/index.test.ts.
export const ON_DEMAND_BUDGET_MS = 10_000

// Both are YYYY-MM-DD, so a lexical comparison is a chronological one. Inclusive: a type applies
// on the day it ships, not the day after.
const appliesTo = (contribution: PackContribution, date: PackDate): boolean => contribution.availableFrom <= date

// Missing work is the difficulties already present against the ones the contribution declares --
// never an array index or length, which is why puzzle ids are opaque. Returns [] for a
// contribution that does not apply to this date, so an old date is never topped up with a type
// that did not exist when it was played. Does NOT filter bestEffort: that flag suppresses the
// alarm, never the attempt.
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

// >= rather than ===. Exact equality makes an over-full pack permanently incomplete -- nothing is
// missing, so nothing is written and the flag can never clear -- and an over-full pack is
// reachable the moment countPerDay shrinks.
const isSatisfied = (contribution: PackContribution, puzzles: Puzzle[]): boolean =>
  countOfType(puzzles, contribution) >= contribution.countPerDay

// isComplete answers "should the client refetch this pack"; hasWorkRemaining below answers "is
// anything here still worth attempting". They differ on exactly one input, a best-effort
// contribution, which is why both exist. Always the full registry, never the subset a caller
// chose to run, or a build that produced only the self-contained puzzles marks the day done; and
// both are dated, or the day a PuzzleType ships the whole archive becomes eligible at once.
const isComplete = (date: PackDate, puzzles: Puzzle[]): boolean =>
  allContributions
    // bestEffort is filtered here and nowhere else: missingDifficulties still asks for it, and
    // hasWorkRemaining below still counts it.
    .filter((contribution) => appliesTo(contribution, date) && contribution.bestEffort !== true)
    // Vacuously true over a date no contribution applies to, deliberately: complete: false would
    // put such a date into a permanent client refetch, and an empty pack answers 404 anyway.
    // buildPack logs the vacuous case by name so it does not pass unremarked.
    .every((contribution) => isSatisfied(contribution, puzzles))

/**
 * Whether anything in the registry still owes this date a puzzle -- the only question that may
 * gate an async builder invocation. Never `complete`: a date whose only gap is a bestEffort type
 * reads complete: true, so gating on that means no builder is ever invoked and the type ships
 * zero puzzles on every date. `some` rather than a negated `every`, so a date no contribution
 * applies to reports false and nothing is invoked for it.
 */
export const hasWorkRemaining = (date: PackDate, puzzles: Puzzle[]): boolean =>
  allContributions
    .filter((contribution) => appliesTo(contribution, date))
    .some((contribution) => !isSatisfied(contribution, puzzles))

// Everything the `complete` flag is entitled to hide, once per pack build, since each case is
// silent by construction. Every line is gated on the thing it reports, or all three fire on every
// buildPack with an empty payload, and the best-effort line reports outcome rather than which
// types are ALLOWED to be short, which would read the same on a good night.
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

// A failed write must not turn a readable pack into a 500, now that the request path also writes.
// setPackByDate converts only a conditional-check failure into `false` and throws on everything
// else. `undefined` means the write did not happen; `false` means another run wrote first.
const tryWrite = async (date: PackDate, pack: Pack, expectedPuzzleCount: number): Promise<boolean | undefined> => {
  try {
    return await setPackByDate(date, pack, expectedPuzzleCount)
  } catch (error: unknown) {
    logError('Could not write the pack, falling back to what is already stored', { date, error })
    return undefined
  }
}

// A retry tops a pack up; it never replaces an existing puzzle, because ids are stable while
// content is not and regenerating wholesale would orphan a player's stored lull:progress. No
// caller pre-reads the stored `complete` flag either: it was frozen against that deploy's
// registry, so a top-up would skip a pack written before a new type shipped.
/**
 * What the write did, which `Pack` alone cannot say. `Model type produced nothing` fires whenever
 * a type ends at zero, and three things reach it: no candidates (supply), every selected
 * candidate failed to build (a generator defect), or the conditional write lost its race (not a
 * failure). The latter two are logged below the ERROR the subscription matches.
 */
export type PackWriteOutcome = 'lost-race' | 'nothing-generated' | 'write-failed' | 'written'

interface BuiltPack {
  outcome: PackWriteOutcome
  pack: Pack
}

const buildPackWithOutcome = async (
  date: PackDate,
  produce: (existing: Puzzle[]) => Promise<Puzzle[]>,
): Promise<BuiltPack> => {
  const existingPack = await getPackByDate(date)
  const existingPuzzles = existingPack?.puzzles ?? []

  const generated = await produce(existingPuzzles)

  const puzzles = [...existingPuzzles, ...generated]
  logWhatTheFlagHides(date, puzzles)
  const pack: Pack = { complete: isComplete(date, puzzles), date, puzzles }

  if (generated.length === 0) {
    log('Nothing to add to pack, skipping write', { complete: pack.complete, date })
    return { outcome: 'nothing-generated', pack }
  }

  log('Writing pack', { complete: pack.complete, date, generated: generated.length, puzzles: puzzles.length })
  // Conditional on the puzzle count we read. EventBridge delivers at least once and the async
  // builder can land while a request is in flight, so two runs can both see a partial pack and
  // generate the same difficulties -- and the second write would replace the first's puzzles with
  // different ids, orphaning a player's stored lull:progress.
  const written = await tryWrite(date, pack, existingPuzzles.length)
  if (written === undefined) {
    // The existing PERSISTED puzzles, never `pack`, whose ids reached no table. On a cold date
    // this collapses to an empty pack and the handler answers 404.
    return {
      outcome: 'write-failed',
      pack: { complete: isComplete(date, existingPuzzles), date, puzzles: existingPuzzles },
    }
  }
  if (!written) {
    log('Another run wrote this pack first, returning the stored pack', { date })
    // What was PERSISTED, never the discarded copy, whose ids exist nowhere else. `complete` is
    // recomputed rather than taken from it, for the same reason there is no pre-read above.
    const stored = await getPackByDate(date)
    return {
      outcome: 'lost-race',
      pack: stored ? { ...stored, complete: isComplete(date, stored.puzzles) } : pack,
    }
  }
  return { outcome: 'written', pack }
}

const buildPack = async (date: PackDate, produce: (existing: Puzzle[]) => Promise<Puzzle[]>): Promise<Pack> =>
  (await buildPackWithOutcome(date, produce)).pack

// Two calls per puzzle: the draw and one retry, never a loop. Most of what these generators throw
// is a bad DRAW off Math.random, so a second call usually lands, while a redraw that failed twice
// is far more likely to be a property of the INPUT and fails identically however often it is
// asked. Not exponential or delayed: nothing here does I/O, so a sleep waits for nothing.
const ATTEMPTS_PER_PUZZLE = 2

/**
 * Runs `attempt` up to ATTEMPTS_PER_PUZZLE times, returning the first success and rethrowing the
 * last failure. The bound is structural rather than a counter to trust: the loop runs only the
 * attempts that get a catch and the final attempt sits outside it, so its throw reaches the
 * caller with no branch deciding whether to give up. `canRetry` is how the request path declines
 * one, since a redraw after the budget is gone is latency a waiting client is already out of.
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
      // Logged rather than swallowed: a type needing two calls for every puzzle is a generator
      // defect a silent rescue would hide.
      log('Retrying a puzzle that failed to generate', { ...context, attempt: tries, error })
    }
  }
  return attempt()
}

// The catch is around each generate CALL, not around each generator: one failed call costs one
// puzzle, where catching a level up loses every puzzle of a type to a single bad draw.
// Sequential, deliberately -- these generators are pure CPU, so Promise.all measured slower for
// the microtask overhead alone and there is no I/O to overlap.
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
            // The retry answers to the same budget the puzzle did: on the request path declining
            // is the difference between one slow response and two.
            () => !isExhausted(),
          ),
        )
      } catch (error: unknown) {
        // The one per-puzzle catch in this file that stays a logError. The phrase and model lanes
        // are `log` because a handler counts their types against countPerDay afterwards and pages
        // on zero; nothing counts the self-contained lane, so a generator that threw on every band
        // would be invisible if this line were quiet.
        logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
  return generated
}

/** How many phrases a full pack needs, so the async builder knows what to ask the model for. */
export const phrasesNeeded = (): number =>
  phraseGenerators.reduce((total, generator) => total + generator.countPerDay, 0)

// How many of the given difficulties could use this phrase; the narrower, the more expensive it
// is to spend anywhere else.
const breadthOf = (generator: PhraseGenerator, phrase: Phrase, difficulties: Difficulty[]): number =>
  difficulties.filter((candidate) => generator.isUsablePhrase(phrase, candidate)).length

// Most-constrained-first, not first-fit, which is what lets two phrase generators share one pool:
// under a tolerance band a middling phrase suits every difficulty a generator declares, so
// first-fit drains the middle and leaves the extremes with nothing. The primary key is breadth
// over the difficulties STILL TO FILL, because declared breadth counts demand already satisfied
// and lets an earlier difficulty spend the only phrase a later one could have used; declared
// breadth is the second key, for the last missing difficulty where everything ties at 1; pool
// order is the third, via strictly-less-than.
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

// What the pool left could still serve, per declared difficulty, for the moment a band finds
// nothing: that alone cannot tell an EMPTY pool from a pool of the wrong shape.
const poolBreadth = (generator: PhraseGenerator, remaining: Phrase[]): Record<number, number> =>
  Object.fromEntries(
    generator.difficulties.map((candidate) => [
      candidate,
      remaining.filter((phrase) => generator.isUsablePhrase(phrase, candidate)).length,
    ]),
  )

// One phrase per puzzle, never reused within a pack, which stops one day shipping the same answer
// twice. Running short is not an error: the pack is written incomplete and the next request tops
// it up.
const generateFromPhrases = async (date: PackDate, phrases: Phrase[], existing: Puzzle[]): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  const remaining = [...phrases]

  for (const generator of phraseGenerators) {
    const missing = missingDifficulties(generator, existing, date)
    for (const [position, difficulty] of missing.entries()) {
      // The tail of the list, so `pending` is the difficulty being filled plus every one still to
      // come. A difficulty skipped for want of a usable phrase is not retried.
      const index = bestFitIndex(generator, difficulty, remaining, missing.slice(position))
      if (index === -1) {
        // Continue, never return and never break. Returning costs zero puzzles of every later
        // type, and breaking is not enough either: -1 means "no remaining phrase suits THIS
        // difficulty", not "the pool is empty", so a batch of nothing but hard phrases would
        // abandon the difficulties that could use them. The declared list is finite, so
        // continuing cannot spin.
        log('No usable phrase for this difficulty, trying the next', {
          date,
          difficulty,
          remaining: remaining.length,
          type: generator.type,
          // A zero against this difficulty beside healthy counts elsewhere is a supply problem in
          // the batch; zeroes across the board are simply an empty pool.
          usableByDifficulty: poolBreadth(generator, remaining),
        })
        continue
      }
      const [phrase] = remaining.splice(index, 1)
      try {
        // The retry hands back the SAME phrase: reaching for a different one would re-enter
        // bestFitIndex, which is a selection decision rather than a retry.
        generated.push(
          await withRetry({ date, difficulty, type: generator.type }, () =>
            generator.generate(date, difficulty, phrase),
          ),
        )
      } catch (error: unknown) {
        // Per call, and a `log` rather than a logError because this is recovered: one puzzle is
        // lost and the next GET re-triggers the builder. The alarm for this lane is
        // create-phrase-puzzles.ts's per-type check, the only place the count against countPerDay
        // is knowable.
        log('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
  // The pool accounting, once, whether or not anything starved: without the unused count a run
  // that turns twenty-one phrases into six puzzles reads as a scarce batch rather than an
  // unspendable one.
  log('Phrase pool spent', { date, generated: generated.length, pool: phrases.length, unused: remaining.length })
  return generated
}

/**
 * The nightly path: every self-contained generator, no time budget. It makes no model call and
 * never will -- anything needing a phrase is added afterwards by the async builder.
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
 * The async builder's path: turn already-generated phrases into the puzzles that need them. Takes
 * phrases rather than fetching them, so this module never reaches a model and the phrases exist
 * only in the invocation that generated them.
 */
export const addPhrasePuzzles = (date: PackDate, phrases: Phrase[]): Promise<Pack> =>
  buildPack(date, (existing) => generateFromPhrases(date, phrases, existing))

// First fit in the order the generator returned them, marking each draft spent so one can never
// fill two slots. Not most-constrained-first: bestFitIndex exists to stop several generators
// competing over one shared pool, while a ModelGenerator allocates from a pool it asked for
// itself, so a starved band is a prompt change rather than an allocator.
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
 * The catch is around each build() call, never the generator or the candidate list. A
 * ModelGenerator makes one fetchCandidates call for the whole type, so it never reaches
 * generateSelfContained's per-generate catch, and a throw at that level would cost every declared
 * difficulty rather than one puzzle. Nothing propagates out. A code-defect gate is a
 * logError-with-reason rejection at runtime and a throwing assertion in a test, never a throw on
 * the nightly path, where every seam turns it back into the quiet drop it was meant to avoid.
 *
 * `missing` is a parameter rather than re-derived: the handler computes it against a pack read
 * BEFORE the model call, buildPack reads the pack again inside its produce, and the two can
 * disagree. The candidate list was drawn against the handler's number and no other.
 *
 * The fill is still filtered against buildPack's read, which is a different decision. Nothing on
 * this path dedupes -- the merge is [...existingPuzzles, ...generated] and no id is compared,
 * here or in setPackByDate -- so rebuilding a band that filled in the meantime writes two puzzles
 * under one id, isSatisfied's `>=` grades the type satisfied one distinct puzzle short, the pack
 * is written complete: true, and the band that was missing is never built. It is reachable: only
 * get-pack-by-date.ts takes claimPackGeneration, so a nightly and a request-path invocation for
 * the same date overlap freely.
 *
 * Takes the whole ModelGenerator though it reads only `type`: narrowing it would make this look
 * callable from the phrase lane, which would silently skip generateFromPhrases' allocator.
 */
export const addModelPuzzles = (
  date: PackDate,
  generator: ModelGenerator,
  missing: Difficulty[],
  candidates: Candidate[],
): Promise<BuiltPack> =>
  buildPackWithOutcome(date, async (existing) => {
    const generated: Puzzle[] = []
    // missingDifficulties over `existing` would ADD bands the handler never asked for, which is
    // the re-derivation the docstring above rejects. This only ever removes from the ask.
    const present = new Set(
      existing.filter((puzzle) => puzzle.type === generator.type).map((puzzle) => puzzle.difficulty),
    )
    const unfilled = missing.filter((difficulty) => !present.has(difficulty))
    if (unfilled.length < missing.length) {
      // Gated, so a run that raced nobody says nothing. It is the only visible sign that two
      // builders overlapped on one date.
      log('Some bands filled between the ask and the read, skipping them', {
        date,
        skipped: missing.filter((difficulty) => present.has(difficulty)),
        type: generator.type,
      })
    }
    for (const { candidate, difficulty } of selectCandidates(unfilled, candidates)) {
      if (candidate === undefined) {
        // A logged shortfall, never a throw: exhausting a band is normal and the other bands are
        // untouched. The per-type ERROR belongs to the handler, where the count is knowable.
        log('No usable candidate for this difficulty', { date, difficulty, type: generator.type })
        continue
      }
      try {
        // Rebuilds the SAME candidate, which is cheap by construction: fetchCandidates ran once
        // for the whole type, so nothing here reaches a model and a retry costs no tokens.
        generated.push(
          await withRetry({ date, difficulty, type: generator.type }, () => candidate.build(date, difficulty)),
        )
      } catch (error: unknown) {
        // Per call, and a `log` for the reason the arm above gives. The candidate is already
        // spent, so the next difficulty does not retry the same failing draft.
        log('Could not build a model puzzle', { date, difficulty, error, type: generator.type })
      }
    }
    return generated
  })
