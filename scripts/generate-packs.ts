#!/usr/bin/env ts-node
// Generates packs locally: the Lambdas' own code does every step, and `claude -p` does every model
// call in place of Bedrock. Run through `npm run generate-packs`, which loads .env.local (the
// builders' environment from template.yaml) and sets TZ=UTC as the Lambda runtime does.
//
//   npm run generate-packs -- 2026-10-05 2026-10-07..2026-10-09
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { format } from 'util'

import { createClaudeBackend, runProcess } from '../src/services/claude-cli'
import {
  ChainResult,
  describeResult,
  exitCodeFor,
  expandPackDates,
  generatePacks,
  RunSummary,
} from '../src/services/local-generation'
import { PackDate } from '../src/types'

const ROOT = join(__dirname, '..')
const WORK_ROOT = join(ROOT, '.local-packs')

// Set once logging is redirected, so a crash can point at the log.
let logPath: string | undefined

const REQUIRED_ENV = [
  'AWS_REGION',
  'DYNAMODB_PACKS_TABLE_NAME',
  'PACK_START_DATE',
  'PHRASE_HISTORY_DAYS',
  'INSPIRATION_ADJECTIVES_COUNT',
  'INSPIRATION_NOUNS_COUNT',
  'INSPIRATION_VERBS_COUNT',
  'LLM_PHRASE_PROMPT_ID',
  'LLM_REVIEW_PROMPT_ID',
  'LLM_ANAGRAM_PROMPT_ID',
  'LLM_CRYPTOGRAM_PROMPT_ID',
  'LLM_CRYPTIC_PROMPT_ID',
  'LLM_CRYPTIC_REVIEW_PROMPT_ID',
  'DICTIONARY_PATH',
]

const USAGE = 'Usage: npm run generate-packs -- <YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD> ...'

const SELF_CONTAINED_LABEL = 'self-contained'

const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

// The services log structured JSON on every step. It goes to a file so the terminal shows progress.
// A log line that cannot be written goes to stderr rather than failing the step that logged it.
const redirectLogs = (logPath: string): void => {
  const write = (...args: unknown[]): void => {
    try {
      appendFileSync(logPath, `${format(...args)}\n`)
    } catch {
      process.stderr.write(`${format(...args)}\n`)
    }
  }
  console.log = write
  console.warn = write
  console.error = write
}

export const formatSummary = (summary: RunSummary): string[] =>
  summary.dates.flatMap(({ chains, date, selfContained }) => {
    const rows: [string, ChainResult][] = [[SELF_CONTAINED_LABEL, selfContained], ...Object.entries(chains)]
    const width = Math.max(...rows.map(([label]) => label.length))
    return ['', date, ...rows.map(([label, result]) => `  ${label.padEnd(width)}  ${describeResult(result)}`)]
  })

const isDone = (result: ChainResult): boolean => result.status === 'complete' || result.status === 'skipped'

// Every date an abort left unfinished or never started, so the developer knows exactly what to rerun.
export const toRerun = (dates: PackDate[], summary: RunSummary): PackDate[] =>
  dates.filter((date) => {
    const started = summary.dates.find((entry) => entry.date === date)
    return started === undefined || ![started.selfContained, ...Object.values(started.chains)].every(isDone)
  })

// Fails before any AWS call when claude is missing, rather than as twelve failed attempts per date.
const claudeAvailable = async (): Promise<boolean> => {
  try {
    return (await runProcess('claude', ['--version'], { cwd: ROOT, input: '', timeoutMs: 30_000 })).exitCode === 0
  } catch {
    return false
  }
}

const parseDates = (args: string[]): PackDate[] | undefined => {
  try {
    return expandPackDates(args)
  } catch (error) {
    print((error as Error).message)
    print(USAGE)
    return undefined
  }
}

const main = async (): Promise<number> => {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  if (missing.length > 0) {
    print(`Missing environment variables (set them in .env.local; see README): ${missing.join(', ')}`)
    return 1
  }
  const dates = parseDates(process.argv.slice(2))
  if (!dates) {
    return 1
  }
  if (!(await claudeAvailable())) {
    print('`claude --version` failed: install Claude Code and log in before generating packs.')
    return 1
  }

  mkdirSync(WORK_ROOT, { recursive: true })
  logPath = join(WORK_ROOT, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  print(`Writing to table ${process.env.DYNAMODB_PACKS_TABLE_NAME}`)
  print(`Logging to ${logPath}`)
  redirectLogs(logPath)

  const summary = await generatePacks(dates, {
    createBackend: (workDir, isAborted) =>
      createClaudeBackend({ isAborted, promptsDir: join(ROOT, 'prompts'), workDir }),
    onProgress: print,
    workRoot: WORK_ROOT,
  })
  formatSummary(summary).forEach(print)
  const code = exitCodeFor(summary)
  print('')
  if (summary.aborted) {
    print('Stopped: AWS credentials failed. Refresh them and rerun; only what is still missing is generated.')
  } else if (code === 1) {
    print(`Not everything was generated; see ${logPath} and the work files for the cause.`)
  }
  const remaining = toRerun(dates, summary)
  if (code === 1 && remaining.length > 0) {
    print(`Rerun: ${remaining.join(' ')}`)
  }
  return code
}

// Exits only once stdout has flushed, so a piped summary is never cut off.
const exitWith = (code: number): void => {
  process.stdout.write('', () => process.exit(code))
}

if (require.main === module) {
  main().then(exitWith, (error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    if (logPath !== undefined && existsSync(logPath)) {
      appendFileSync(logPath, `${detail}\n`)
    }
    print(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    if (logPath !== undefined) {
      print(`See ${logPath}`)
    }
    exitWith(1)
  })
}
