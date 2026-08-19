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
  for (const generator of generatorsToRun) {
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
  const written = await setPackByDate(date, pack, existingPuzzles.length)
  if (!written) {
    log('Another run wrote this pack first, returning the stored pack', { date })
    // Return what was PERSISTED, never the discarded copy: its ids exist nowhere else, and a
    // caller that serves them to a client orphans that client's stored progress. The ?? fallback
    // is unreachable in practice -- the condition failed because a pack is there -- and only keeps
    // the return type total.
    const stored = await getPackByDate(date)
    return stored ?? pack
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
