#!/usr/bin/env ts-node
import { DynamoDB } from '@aws-sdk/client-dynamodb'

import { normalizeAnswer } from '../src/rules/normalize-answer'
import { Pack, PackDate, PhrasePuzzleData, Puzzle, PuzzleType } from '../src/types'
import { isPackDateFormat, recentPackDates, todayPackDate } from '../src/utils/pack-date'

// An ANSWER-WITHHELD SOLVE ATTEMPT, run by a person, on demand. Never on the nightly path.
//
// Neither prompt can measure hint leakage, because both models hold the answer: the generator wrote
// the rung knowing it, and the reviewer is sent `text` in the same turn as the checks
// (src/services/review.ts:74-82). So the measurement is a third call whose context genuinely lacks
// the answer, and this script is the only thing that makes it.
//
// See docs/superpowers/specs/2026-08-20-lull-phrase-ladder-calibration-design.md, decisions 6 and 8.

// Its own client, deliberately NOT src/services/dynamodb.ts. That module reads its table name at
// import time from a Lambda-only env var (undefined here), constructs its client with no region,
// and -- the dangerous one -- getRecentPacks swallows every error and returns [] (dynamodb.ts:195).
// Correct for a generation path that must not fail a pack over a failed read; catastrophic for an
// audit, where expired credentials would print one stderr line and then zero rows, and an operator
// would read an empty audit as "no leakage".
//
// Region hardcoded, matching scripts/deploy-prompts.ts:6 and src/services/bedrock.ts:18.
//
// Exported only so it is not an unused module-scope binding while the IO shell that sends on it is
// still to come; nothing outside this file should reach for it.
export const dynamodb = new DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' })

// The TEST table, matching scripts/deploy-prompts.ts:88. Auditing production is opt-in and costs a
// positional argument; a bare run can only ever read test data.
const DEFAULT_TABLE_NAME = 'lull-api-packs-test'

// Matching PHRASE_HISTORY_DAYS, so the audit window and the anti-repetition window are the same
// window and a phrase cannot be audited twice under two different pack dates.
const DEFAULT_DAYS = 20

// One BatchGetItem carries at most 100 keys and returns at most 1MB. A pack is roughly 15KB, so 60
// dates is ~900KB -- the last whole window that fits in one call without an UnprocessedKeys retry
// loop. A --days that reached the key list unvalidated would be an unbounded key list.
const MAX_DAYS = 60

const MS_PER_DAY = 24 * 60 * 60 * 1000

// BY TYPE, never by the presence of `answer`. Duck-typing on `answer` is the exact hazard
// src/handlers/create-phrase-puzzles.ts:37-40 warns about: goFigure's `hints` is three OBJECTS while
// PhrasePuzzleData's is three strings, and this script reads `hints`. A new phrase type joins this
// audit by being added here, and an unrecognized type is skipped and counted rather than guessed at.
const PHRASE_PUZZLE_TYPES = new Set<PuzzleType>(['cryptogram', 'missingvowels'])

export interface AuditOptions {
  days: number
  since?: PackDate
  tableName: string
  useModel: boolean
}

// What the blind reader may be shown, plus the two fields only the local comparison uses. Rung 3 is
// already gone: `hints` is a PAIR, not a ladder, because it is built by dropping rung 3 at selection.
export interface AuditRow {
  answer: string
  // Optional because difficulty hides it (src/generators/category-visibility.ts). Reported
  // separately rather than filled in -- for those puzzles rung 1 narrows something the player was
  // never shown, and whether that changes the leak rate is an open question the audit can answer.
  category?: string
  date: PackDate
  hints: [string, string]
  // The position in the pack's `puzzles` array, so two runs line up. Packs are only ever appended
  // to -- createPack fills missing difficulties (src/services/packs.ts:266) -- so an index does not
  // shift under a top-up.
  index: number
  type: PuzzleType
}

// answer named FIRST -- rung 2 is solvable, the failure this change targets.
// answer named at all -- rung 2 is leaky.
// answer absent      -- the ladder held.
export type Outcome = 'named-first' | 'named' | 'absent'

export interface Result {
  outcome: Outcome
  row: AuditRow
}

export interface Summary {
  absent: number
  leakRate: number
  named: number
  namedFirst: number
  total: number
}

const parseDays = (value: string | undefined): number => {
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`--days must be a whole number from 1 to ${MAX_DAYS}, got ${value}`)
  }
  return days
}

const parseSince = (value: string | undefined): PackDate => {
  // Format AND calendar validity: '2026-02-30' is not NaN, it rolls forward to March 2nd, and only
  // isPackDateFormat's round trip catches that.
  if (value === undefined || !isPackDateFormat(value)) {
    throw new Error(`--since must be a YYYY-MM-DD calendar date, got ${value}`)
  }
  return value
}

/**
 * The audit's arguments: one optional positional table name and three flags.
 *
 * Every unrecognized argument throws. An audit that silently ignored `--dayz 1` would read a
 * 20-day window and report a number the operator would attribute to one day.
 */
export const parseArgs = (argv: string[]): AuditOptions => {
  let days = DEFAULT_DAYS
  let since: PackDate | undefined = undefined
  let tableName = DEFAULT_TABLE_NAME
  let useModel = true
  let sawTableName = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--no-model') {
      useModel = false
    } else if (arg === '--days') {
      index += 1
      days = parseDays(argv[index])
    } else if (arg === '--since') {
      index += 1
      since = parseSince(argv[index])
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`)
    } else if (sawTableName) {
      throw new Error(`Unexpected argument: ${arg}`)
    } else {
      tableName = arg
      sawTableName = true
    }
  }

  return { days, since, tableName, useModel }
}

/**
 * The pack dates to read, newest first.
 *
 * recentPackDates, NOT getPackDates: the latter is a full-table Scan of an archive whose cost grows
 * forever (src/services/dynamodb.ts:137-141), and it returns future dates, because the nightly
 * builds tomorrow. These are computed keys and cost nothing to derive.
 *
 * The window ends the day BEFORE today -- recentPackDates' contract, and the right one here: today's
 * pack may still be topped up and tomorrow's has not been played by anyone.
 */
export const auditDates = (options: AuditOptions, now: () => number = Date.now): PackDate[] => {
  const today = todayPackDate(now)
  if (options.since === undefined) {
    return recentPackDates(today, options.days)
  }

  // Whole days, both bounds parsed as UTC midnight, so this is calendar arithmetic and not a local
  // one-hour drift across a DST boundary.
  const span = Math.round(
    (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${options.since}T00:00:00.000Z`)) / MS_PER_DAY,
  )
  if (span < 1) {
    throw new Error(`--since must be earlier than today (${today}), got ${options.since}`)
  }
  if (span > MAX_DAYS) {
    throw new Error(`--since ${options.since} spans ${span} days; the maximum is ${MAX_DAYS}`)
  }
  return recentPackDates(today, span)
}

const toRow = (pack: Pack, puzzle: Puzzle, index: number): AuditRow => {
  const data = puzzle.data as Partial<PhrasePuzzleData> | null
  const hints = data?.hints
  if (typeof data?.answer !== 'string' || !Array.isArray(hints) || hints.length !== 3) {
    // Loudly, and it stops the run. Quietly dropping an unreadable puzzle would shrink the
    // denominator and make the leak rate look better than it is.
    throw new Error(
      `Malformed phrase puzzle at ${pack.date} #${index} (${puzzle.type}); refusing to audit a partial window`,
    )
  }
  // Rung 3 is dropped HERE, at the boundary. Nothing downstream holds it, so nothing downstream can
  // send it.
  return {
    answer: data.answer,
    category: data.category,
    date: pack.date,
    hints: [hints[0], hints[1]],
    index,
    type: puzzle.type,
  }
}

/** Every phrase-backed puzzle in one pack, addressed by its position in that pack. */
export const selectRows = (pack: Pack): AuditRow[] =>
  pack.puzzles
    .map((puzzle, index) => ({ index, puzzle }))
    .filter(({ puzzle }) => PHRASE_PUZZLE_TYPES.has(puzzle.type))
    .map(({ index, puzzle }) => toRow(pack, puzzle, index))

/**
 * EXACTLY what the blind reader is shown, and nothing else.
 *
 * Never `answer`, never rung 3, never `displayed`, never `ciphertext`. This is the whole
 * measurement: a blind test that leaks the answer measures nothing and does so silently -- every row
 * would come back "named first" and the audit would read as a total failure of the ladder rather
 * than as a broken instrument. The unit test asserting these absences is the most important test in
 * this change.
 *
 * The category key is omitted rather than nulled when the puzzle hides it, because that is what the
 * player got.
 */
export const withheldContext = (row: AuditRow): Record<string, unknown> => ({
  ...(row.category === undefined ? {} : { category: row.category }),
  hints: row.hints,
})

/**
 * Where the real answer sits in the model's candidate list.
 *
 * Through normalizeAnswer, so "TO BE OR NOT TO BE" and "to be, or not to be" are the same answer. A
 * raw string comparison would score most genuine hits as `absent` and report a ladder that held.
 */
export const classify = (answer: string, candidates: string[]): Outcome => {
  const target = normalizeAnswer(answer)
  const normalized = candidates.map((candidate) => normalizeAnswer(candidate))
  if (normalized[0] === target) {
    return 'named-first'
  }
  return normalized.includes(target) ? 'named' : 'absent'
}

/** The leak rate is the share of rows in the first two buckets. */
export const summarize = (results: Result[]): Summary => {
  const namedFirst = results.filter((result) => result.outcome === 'named-first').length
  const named = results.filter((result) => result.outcome === 'named').length
  const absent = results.filter((result) => result.outcome === 'absent').length
  const total = results.length
  // The hidden-category subset is legitimately empty, and summarize is called on it. 0/0 is NaN.
  return { absent, leakRate: total === 0 ? 0 : (namedFirst + named) / total, named, namedFirst, total }
}
