import { allGenerators, phraseGenerators, selfContainedGenerators } from '../generators'
import { Difficulty, Generator, Pack, PackDate, Phrase, PhraseGenerator, Puzzle } from '../types'
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
const missingDifficulties = (generator: Generator | PhraseGenerator, existing: Puzzle[]): Difficulty[] => {
  const present = new Set(
    existing.filter((puzzle) => puzzle.type === generator.type).map((puzzle) => puzzle.difficulty),
  )
  return generator.difficulties.filter((difficulty) => !present.has(difficulty))
}

// >= rather than ===, and the difference is not cosmetic. Exact equality makes an over-full pack
// permanently incomplete: nothing is missing so nothing is generated, so nothing is written, so the
// flag can never clear -- while create-pack.ts logs an ERROR every single day with no code path
// able to fix it. An over-full pack is reachable the moment countPerDay shrinks, which the system
// design explicitly plans for: every already-stored future pack would be stuck on that deploy.
//
// Always the FULL registry, never the subset a caller chose to run. A build that produced only the
// self-contained puzzles must not mark the day done, or the client stops refetching and the day
// stays short.
const isComplete = (puzzles: Puzzle[]): boolean =>
  allGenerators.every(
    (generator) => puzzles.filter((puzzle) => puzzle.type === generator.type).length >= generator.countPerDay,
  )

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
  const pack: Pack = { complete: isComplete(puzzles), date, puzzles }

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
    return { complete: isComplete(existingPuzzles), date, puzzles: existingPuzzles }
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
    return stored ? { ...stored, complete: isComplete(stored.puzzles) } : pack
  }
  return pack
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
    for (const difficulty of missingDifficulties(generator, existing)) {
      if (isExhausted()) {
        log('Fill budget spent, stopping before this puzzle', { date, difficulty, type: generator.type })
        break
      }
      try {
        generated.push(await generator.generate(date, difficulty))
      } catch (error: unknown) {
        logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
  return generated
}

/** How many phrases a full pack needs, so the async builder knows what to ask the model for. */
export const phrasesNeeded = (): number =>
  phraseGenerators.reduce((total, generator) => total + generator.countPerDay, 0)

// Which of this generator's OWN difficulties could use this phrase. The narrower that number, the
// more expensive the phrase is to spend anywhere else.
const breadthOf = (generator: PhraseGenerator, phrase: Phrase): number =>
  generator.difficulties.filter((candidate) => generator.isUsablePhrase(phrase, candidate)).length

// Most-constrained-first, not first-fit, and the difference is the whole reason two phrase
// generators can share one pool. Under a tolerance band a middling phrase is acceptable to every
// difficulty a generator declares, so first-fit lets whichever difficulty ran first drain the
// middle and leaves the extremes with nothing. This takes the phrase the FEWEST of the generator's
// difficulties can use, so a phrase that only difficulty 4 can play is spent on difficulty 4.
//
// Strictly less-than, so ties fall to the earlier index: pool order is the tiebreak and there is no
// second criterion.
const bestFitIndex = (generator: PhraseGenerator, difficulty: Difficulty, remaining: Phrase[]): number => {
  let best = -1
  let narrowest = Number.POSITIVE_INFINITY

  for (const [index, phrase] of remaining.entries()) {
    if (!generator.isUsablePhrase(phrase, difficulty)) continue
    const breadth = breadthOf(generator, phrase)
    if (breadth < narrowest) {
      best = index
      narrowest = breadth
    }
  }
  return best
}

// One phrase per puzzle, never reused within a pack -- which is what stops a single day shipping
// the same answer twice. Running short is not an error: the pack is written incomplete and the
// next retry or request tops it up.
const generateFromPhrases = async (date: PackDate, phrases: Phrase[], existing: Puzzle[]): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  const remaining = [...phrases]

  for (const generator of phraseGenerators) {
    for (const difficulty of missingDifficulties(generator, existing)) {
      const index = bestFitIndex(generator, difficulty, remaining)
      if (index === -1) {
        // BREAK, never return. This used to `return generated`, which was harmless while there was
        // one phrase generator and means ZERO puzzles of every later type the moment there are two
        // -- an exhausted or unsuitable pool would abandon the rest of the registry rather than
        // costing this generator its remaining difficulties.
        log('No usable phrase left for this generator, moving on', { date, difficulty, type: generator.type })
        break
      }
      const [phrase] = remaining.splice(index, 1)
      try {
        generated.push(await generator.generate(date, difficulty, phrase))
      } catch (error: unknown) {
        // Per call, as above. A phrase that cannot be respaced costs one puzzle, not the type. The
        // phrase is already spent, so the next difficulty does not retry the same failing input.
        logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
      }
    }
  }
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
