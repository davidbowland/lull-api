import { generators } from '../generators'
import { Difficulty, Generator, Pack, PackDate, Puzzle } from '../types'
import { log, logError } from '../utils/logging'
import { getPackByDate, setPackByDate } from './dynamodb'

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
const generateMissing = async (generator: Generator, date: PackDate, existing: Puzzle[]): Promise<Puzzle[]> => {
  const generated: Puzzle[] = []
  for (const difficulty of missingDifficulties(generator, existing)) {
    try {
      generated.push(await generator.generate(date, difficulty))
    } catch (error: unknown) {
      logError('Puzzle generation failed', { date, difficulty, error, type: generator.type })
    }
  }
  return generated
}

const isComplete = (puzzles: Puzzle[]): boolean =>
  generators.every(
    (generator) => puzzles.filter((puzzle) => puzzle.type === generator.type).length === generator.countPerDay,
  )

// A retry tops a pack up; it never replaces an existing puzzle. Ids are stable while content is
// not, so regenerating wholesale would leave a player's stored lull:progress attached to a
// different bank and goal -- and it would discard generation work that is already correct.
export const createPack = async (date: PackDate): Promise<Pack> => {
  const existingPack = await getPackByDate(date)
  const existingPuzzles = existingPack?.puzzles ?? []

  const generated: Puzzle[] = []
  for (const generator of generators) {
    generated.push(...(await generateMissing(generator, date, existingPuzzles)))
  }

  const puzzles = [...existingPuzzles, ...generated]
  const pack: Pack = { complete: isComplete(puzzles), date, puzzles }

  if (generated.length === 0) {
    log('Nothing missing from pack, skipping write', { complete: pack.complete, date })
    return pack
  }

  log('Writing pack', { complete: pack.complete, date, generated: generated.length, puzzles: puzzles.length })
  await setPackByDate(date, pack)
  return pack
}
