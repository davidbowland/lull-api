import { generators } from '../generators'
import { Difficulty, Generator, Pack, PackDate, Puzzle } from '../types'
import { log, logError } from '../utils/logging'
import { getPackByDate, setPackByDate } from './dynamodb'

// The request path runs inside GetPackByDateFunction's 15-second Lambda timeout, so it stops
// starting work at 10 seconds -- low enough that the guard actually fires rather than being
// pre-empted by the runtime. It cannot interrupt a generate() already running: this is a backstop
// against a future inRequest generator regressing, not a scheduler.
const ON_DEMAND_BUDGET_MS = 10_000

// Missing work is computed by comparing the difficulties already present against the generator's
// declared difficulties -- never by array index or length. This is why puzzle ids are opaque: an
// earlier design put an index in the id and used it to pick difficulty, which made the identifier a
// contract about content and left non-contiguous indices after a partial run.
const missingDifficulties = (generator: Generator, existing: Puzzle[]): Difficulty[] => {
  const present = new Set(
    existing.filter((puzzle) => puzzle.type === generator.type).map((puzzle) => puzzle.difficulty),
  )
  return generator.difficulties.filter((difficulty) => !present.has(difficulty))
}

// The catch is around each generate CALL, not around each generator. One failed call costs one
// puzzle; catching a level up would lose every goFigure in the pack to a single bad draw, which is
// the exact outcome the incomplete-pack design exists to prevent.
const generateMissing = async (
  generator: Generator,
  date: PackDate,
  existing: Puzzle[],
  isExhausted: () => boolean,
): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  for (const difficulty of missingDifficulties(generator, existing)) {
    if (isExhausted()) {
      log('Fill budget spent, stopping before this puzzle', { date, difficulty, type: generator.type })
      return generated
    }
    try {
      generated.push(await generator.generate(date, difficulty))
    } catch (error: unknown) {
      logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
    }
  }
  return generated
}

// >= rather than ===, and the difference is not cosmetic. Exact equality makes an over-full pack
// permanently incomplete: nothing is missing so nothing is generated, so nothing is written, so the
// flag can never clear -- while create-pack.ts logs an ERROR every single day with no code path
// able to fix it. An over-full pack is reachable the moment countPerDay shrinks, which the system
// design explicitly plans for ("goFigure's share drops" as the other Phase 1 types land): every
// already-stored future pack would be stuck on that deploy.
//
// Always the FULL registry, never the subset a caller chose to run. A fill that skipped the slow
// generators must not mark the day done, or the client stops refetching and the day stays short.
const isComplete = (puzzles: Puzzle[]): boolean =>
  generators.every(
    (generator) => puzzles.filter((puzzle) => puzzle.type === generator.type).length >= generator.countPerDay,
  )

// A failed write must not turn a readable pack into a 500. setPackByDate converts only a
// conditional-check failure into `false`; everything else throws, and before this wrapper that
// exception propagated out of buildPack to the handler's catch-all -- so a date that used to answer
// 200 from the stored pack answered 500 instead, purely because the request now also writes. The
// realistic trigger is AccessDeniedException: the write shipped one commit before the IAM grant, so
// any deploy of an intermediate commit, any template drift, or a partial rollback makes every
// cold-or-incomplete date a 500. `undefined` means "the write did not happen", distinct from
// `false`, which means "another run wrote first".
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
// different bank and goal -- and it would discard generation work that is already correct.
//
// No pre-read of the stored `complete` flag, by either caller. That flag was frozen at write time
// by the generator registry of THAT deploy, so the day a second type ships an already-written pack
// still claims to be complete and a top-up would skip it, silently serving a short day.
const buildPack = async (date: PackDate, generatorsToRun: Generator[], isExhausted: () => boolean): Promise<Pack> => {
  const existingPack = await getPackByDate(date)
  const existingPuzzles = existingPack?.puzzles ?? []

  const generated: Puzzle[] = []
  // Stop at the first generator the budget cannot pay for. `break` and `continue` are behaviorally
  // identical here and no test can tell them apart: the guard only ever goes from unspent to spent,
  // so every later generator would re-check it and skip anyway. The break is a logging choice, not
  // a correctness one -- this single line already names every remaining type, while continuing
  // would re-enter generateMissing for each of them to log another line about a puzzle it was never
  // going to start.
  for (const [index, generator] of generatorsToRun.entries()) {
    if (isExhausted()) {
      log('Fill budget spent, skipping the remaining generators', {
        date,
        skipped: generatorsToRun.slice(index).map((skipped) => skipped.type),
      })
      break
    }
    generated.push(...(await generateMissing(generator, date, existingPuzzles, isExhausted)))
  }

  const puzzles = [...existingPuzzles, ...generated]
  const pack: Pack = { complete: isComplete(puzzles), date, puzzles }

  if (generated.length === 0) {
    log('Nothing missing from pack, skipping write', { complete: pack.complete, date })
    return pack
  }

  log('Writing pack', { complete: pack.complete, date, generated: generated.length, puzzles: puzzles.length })
  // Conditional on the puzzle count we read. EventBridge delivers at least once, and two requests
  // can race the same cold date, so two runs can both see a partial pack, both generate the same
  // missing difficulties, and the second write would silently replace the first's puzzles with
  // different ids -- orphaning any lull:progress a player already stored against them.
  const written = await tryWrite(date, pack, existingPuzzles.length)
  if (written === undefined) {
    // The EXISTING PERSISTED puzzles, never `pack`. `pack` holds ids that reached no table, and
    // serving them orphans the lull:progress a client stores against them -- the same invariant the
    // lost-race path below exists to keep. On a cold date this collapses to an empty pack and the
    // handler answers 404, exactly as it did before the request path wrote anything at all.
    return { complete: isComplete(existingPuzzles), date, puzzles: existingPuzzles }
  }
  if (!written) {
    log('Another run wrote this pack first, returning the stored pack', { date })
    // Return what was PERSISTED, never the discarded copy: its ids exist nowhere else, and a
    // caller that serves them to a client orphans that client's stored progress. The fallback
    // cannot fire: the condition failed because an item is there, this read is strongly consistent
    // so it cannot miss an item that exists, and nothing in this codebase deletes a pack. It keeps
    // the return type total, and it is covered by a test rather than left to that argument.
    const stored = await getPackByDate(date)
    // complete is recomputed, never taken from the stored pack. That flag was frozen at write time
    // by the generator registry of whichever deploy wrote it, so an old deploy's full pack still
    // claims to be complete against a registry that has since grown a second type -- suppressing
    // create-pack.ts's incomplete-pack alarm and serving a short day the client stops refetching.
    // This is the one return path where that could happen; everywhere else the flag comes straight
    // from isComplete().
    return stored ? { ...stored, complete: isComplete(stored.puzzles) } : pack
  }
  return pack
}

// The nightly path: every generator, no time budget. It runs under a 900-second timeout and must
// not stop early.
export const createPack = (date: PackDate): Promise<Pack> => buildPack(date, generators, () => false)

// The request path: only the generators graded fast enough, bounded by the Lambda's timeout.
export const fillPack = (date: PackDate, now: () => number = Date.now): Promise<Pack> => {
  const start = now()
  return buildPack(
    date,
    generators.filter((generator) => generator.inRequest),
    () => now() - start >= ON_DEMAND_BUDGET_MS,
  )
}
