#!/usr/bin/env ts-node
// Removes one type's puzzles from stored packs, so a later run regenerates them. Nothing else can:
// every builder only tops a pack up, never replaces a puzzle. Dry run unless --apply.
//
//   npm run drop-puzzles -- --type themedanagrams --difficulty 4 2026-10-26
//   npm run drop-puzzles -- --type cryptogram 2026-10-22..2026-10-30 --apply
//
// Then refill with CreateModelPuzzlesFunction or `npm run generate-packs` for the same dates.
import { parseArgs } from 'util'

import { allContributions } from '../src/generators'
import { getPackByDate, setPackByDate } from '../src/services/dynamodb'
import { expandPackDates } from '../src/services/local-generation'
import { isComplete } from '../src/services/packs'
import { Pack, PackDate, Puzzle, PuzzleType } from '../src/types'
import { nextPackDate } from '../src/utils/pack-date'

const USAGE =
  'Usage: npm run drop-puzzles -- --type <type> [--difficulty <n>]... <YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD>... ' +
  '[--apply] [--allow-served]'

export interface DropRequest {
  allowServed: boolean
  apply: boolean
  dates: PackDate[]
  // Empty means every difficulty of the type.
  difficulties: number[]
  type: PuzzleType
}

const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const isPuzzleType = (value: string): value is PuzzleType =>
  allContributions.some((contribution) => contribution.type === value)

/** Throws with a message fit to print above USAGE. */
export const parseRequest = (args: string[]): DropRequest => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args,
    options: {
      'allow-served': { default: false, type: 'boolean' },
      apply: { default: false, type: 'boolean' },
      difficulty: { default: [], multiple: true, type: 'string' },
      type: { type: 'string' },
    },
  })
  if (values.type === undefined || !isPuzzleType(values.type)) {
    const known = allContributions.map((contribution) => contribution.type).join(', ')
    throw new Error(`--type must be one of: ${known}`)
  }
  const difficulties = values.difficulty.map(Number)
  if (difficulties.some((difficulty) => !Number.isInteger(difficulty))) {
    throw new Error('--difficulty must be an integer')
  }
  return {
    allowServed: values['allow-served'],
    apply: values.apply,
    dates: expandPackDates(positionals),
    difficulties,
    type: values.type,
  }
}

/**
 * Dates the API has already handed out. A device keeps a complete pack forever, so replacing its
 * puzzles changes nothing a player sees except for a player who restarts the day, whose saved
 * progress is keyed to the old puzzle ids and is lost.
 */
export const servedDates = (dates: PackDate[], now = Date.now): PackDate[] =>
  dates.filter((date) => date <= nextPackDate(now))

const matches = (puzzle: Puzzle, request: Pick<DropRequest, 'difficulties' | 'type'>): boolean =>
  puzzle.type === request.type &&
  (request.difficulties.length === 0 || request.difficulties.includes(puzzle.difficulty))

/** The pack with the matching puzzles gone and `complete` recomputed, plus what was removed. */
export const dropFromPack = (
  pack: Pack,
  request: Pick<DropRequest, 'difficulties' | 'type'>,
): { dropped: Puzzle[]; pack: Pack } => {
  const kept = pack.puzzles.filter((puzzle) => !matches(puzzle, request))
  return {
    dropped: pack.puzzles.filter((puzzle) => matches(puzzle, request)),
    pack: { ...pack, complete: isComplete(pack.date, kept), puzzles: kept },
  }
}

// The one field that tells a reader which puzzle this was; ids are random.
const describePuzzle = (puzzle: Puzzle): string => {
  const data = puzzle.data as { theme?: string }
  return `${puzzle.id} difficulty ${puzzle.difficulty}${data.theme ? ` "${data.theme}"` : ''}`
}

const dropDate = async (date: PackDate, request: DropRequest): Promise<boolean> => {
  const stored = await getPackByDate(date)
  if (stored === undefined) {
    print(`${date}: no pack`)
    return true
  }
  const { dropped, pack } = dropFromPack(stored, request)
  if (dropped.length === 0) {
    print(`${date}: nothing matches`)
    return true
  }
  dropped.forEach((puzzle) => print(`${date}: ${request.apply ? 'dropping' : 'would drop'} ${describePuzzle(puzzle)}`))
  if (!request.apply) {
    return true
  }
  // Conditional on the count just read, through the same write the builders use, so a builder
  // writing this row meanwhile makes this a no-op rather than erasing its puzzles.
  if (!(await setPackByDate(date, pack, stored.puzzles.length))) {
    print(`${date}: another writer changed the pack first; nothing dropped, rerun this date`)
    return false
  }
  return true
}

const main = async (): Promise<number> => {
  if (!process.env.DYNAMODB_PACKS_TABLE_NAME) {
    print('DYNAMODB_PACKS_TABLE_NAME is not set (see README, Generating Packs Locally)')
    return 1
  }
  let request: DropRequest
  try {
    request = parseRequest(process.argv.slice(2))
  } catch (error) {
    print((error as Error).message)
    print(USAGE)
    return 1
  }
  const served = servedDates(request.dates)
  if (served.length > 0 && !request.allowServed) {
    print(`Already served, so devices may hold them: ${served.join(' ')}. Pass --allow-served to drop them anyway.`)
    return 1
  }

  print(`${request.apply ? 'Writing to' : 'Dry run against'} table ${process.env.DYNAMODB_PACKS_TABLE_NAME}`)
  let ok = true
  for (const date of request.dates) {
    ok = (await dropDate(date, request)) && ok
  }
  if (!request.apply) {
    print('Dry run: pass --apply to write.')
  }
  return ok ? 0 : 1
}

if (require.main === module) {
  main().then(
    (code) => process.stdout.write('', () => process.exit(code)),
    (error: unknown) => {
      print(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
      process.stdout.write('', () => process.exit(1))
    },
  )
}
