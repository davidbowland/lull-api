import { join } from 'node:path'

import { phraseHistoryDays } from '../config'
import { selfContainedGenerators } from '../generators'
import { modelGenerators } from '../generators/model'
import { LocalChain, LocalInvocationUsage, ModelGenerator, PackDate, Puzzle } from '../types'
import { PHRASE_CORPUS_TYPES, recentAnswersOfTypes } from '../utils/exclusions'
import { log, logError, logWarning } from '../utils/logging'
import { isPackDateFormat, packDateWindow, toPackDate } from '../utils/pack-date'
import { appendPackUsage, getPackByDate, getRecentPacks } from './dynamodb'
import { LocalModelBackend, withModelBackend } from './model-backend'
import { addModelPuzzles, addPhrasePuzzles, createPack, missingDifficulties, phrasesMissing } from './packs'
import { generatePhrases, phraseRequestCount } from './phrases'
import { reviewPhrases } from './review'

export const MAX_CHAIN_ATTEMPTS = 3
// A run is a backfill, and each date costs minutes of model time; a typo such as 2026..2062 must not
// queue decades.
export const MAX_RANGE_DAYS = 366

export type ChainResult =
  { status: 'skipped' | 'complete' | 'aborted' | 'failed' } | { status: 'short'; have: number; want: number }

export interface DateSummary {
  chains: Record<LocalChain, ChainResult>
  date: PackDate
  selfContained: ChainResult
}

export interface RunSummary {
  aborted: boolean
  dates: DateSummary[]
}

export interface LocalGenerationDeps {
  createBackend: (workDir: string, isAborted: () => boolean) => LocalModelBackend
  now?: () => number
  onProgress?: (line: string) => void
  workRoot: string
}

type Write = () => Promise<unknown>

interface ChainPlan {
  count: number
  // Runs the chain's model steps and returns the write, so the caller decides whether it happens.
  produce: () => Promise<Write>
}

interface Chain {
  bestEffort: boolean
  builder: LocalInvocationUsage['builder']
  name: LocalChain
  plan: (date: PackDate, puzzles: Puzzle[]) => ChainPlan
}

interface RunState {
  aborted: boolean
  locked: <T>(work: () => Promise<T>) => Promise<T>
  now: () => number
  progress: (line: string) => void
}

const CREDENTIAL_FAILURES = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidSignatureException',
  'UnrecognizedClientException',
])

const recentPacks = (date: PackDate) => getRecentPacks(packDateWindow(date, phraseHistoryDays))

const phraseChain: Chain = {
  bestEffort: false,
  builder: 'phrase-puzzles',
  name: 'phrases',
  plan: (date, puzzles) => {
    const count = phrasesMissing(date, puzzles)
    return {
      count,
      produce: async () => {
        const excluded = recentAnswersOfTypes(await recentPacks(date), PHRASE_CORPUS_TYPES, date)
        const { phrases } = await generatePhrases(phraseRequestCount(count), excluded)
        const reviewed = await reviewPhrases(phrases)
        return () => addPhrasePuzzles(date, reviewed)
      },
    }
  },
}

const modelChain = (generator: ModelGenerator): Chain => ({
  bestEffort: generator.bestEffort === true,
  builder: 'model-puzzles',
  name: generator.type as LocalChain,
  plan: (date, puzzles) => {
    const missing = missingDifficulties(generator, puzzles, date)
    return {
      count: missing.length,
      produce: async () => {
        const candidates = await generator.fetchCandidates(missing.length, await recentPacks(date), date)
        return () => addModelPuzzles(date, generator, missing, candidates)
      },
    }
  },
})

const chains = (): Chain[] => [phraseChain, ...modelGenerators.map(modelChain)]

const selfContainedMissing = (date: PackDate, puzzles: Puzzle[]): number =>
  selfContainedGenerators.reduce((total, generator) => total + missingDifficulties(generator, puzzles, date).length, 0)

const readPuzzles = async (date: PackDate): Promise<Puzzle[]> => (await getPackByDate(date))?.puzzles ?? []

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const shortOrComplete = (want: number, nowMissing: number): ChainResult =>
  nowMissing === 0 ? { status: 'complete' } : { have: want - nowMissing, status: 'short', want }

export const describeResult = (result: ChainResult): string =>
  result.status === 'short' ? `short (${result.have}/${result.want})` : result.status

export const isCredentialFailure = (error: unknown): boolean =>
  CREDENTIAL_FAILURES.has((error as { name?: string } | undefined)?.name ?? '')

const expandArg = (arg: string): PackDate[] => {
  const [start, end = start, ...rest] = arg.split('..')
  if (rest.length > 0 || !isPackDateFormat(start) || !isPackDateFormat(end) || start > end) {
    throw new Error(`Invalid date or range: ${arg}`)
  }
  const days = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000 + 1
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Range longer than ${MAX_RANGE_DAYS} days: ${arg}`)
  }
  const dates: PackDate[] = []
  for (const day = new Date(`${start}T00:00:00.000Z`); toPackDate(day) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(toPackDate(day))
  }
  return dates
}

export const expandPackDates = (args: string[]): PackDate[] => {
  if (args.length === 0) {
    throw new Error('No dates given')
  }
  return [...new Set(args.flatMap(expandArg))].sort()
}

// buildPack is read-merge-conditional-write, so two concurrent writes to one row race a single
// condition and the loser's puzzles are discarded. Every pack-row write in the process goes
// through here.
const createLock = (): RunState['locked'] => {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

const noteFailure = (state: RunState, error: unknown): void => {
  if (isCredentialFailure(error)) {
    state.aborted = true
  }
}

// Under the lock because it updates the same row the writes do.
const appendUsage = async (state: RunState, date: PackDate, usage: LocalInvocationUsage): Promise<void> => {
  try {
    const appended = await state.locked(async () => (state.aborted ? undefined : appendPackUsage(date, usage)))
    log('Local usage appended', { appended, chain: usage.chain, date })
  } catch (error: unknown) {
    noteFailure(state, error)
    logWarning('Could not append local usage', { chain: usage.chain, date, error })
  }
}

const runAttempt = async (
  state: RunState,
  deps: LocalGenerationDeps,
  date: PackDate,
  chain: Chain,
  attempt: number,
  plan: ChainPlan,
  start: number,
): Promise<void> => {
  const backend = deps.createBackend(join(deps.workRoot, date, chain.name, `attempt-${attempt}`), () => state.aborted)
  try {
    const write = await withModelBackend(backend, plan.produce)
    // reviewPhrases, reviewClues and generatePhrases swallow a failed call and return their input,
    // so the backend's record is the only sign that a batch is unreviewed or short of a call.
    const failures = backend.failures()
    if (failures.length > 0) {
      throw new Error(`Model calls failed: ${failures.join(', ')}`)
    }
    // Inside the backend too: a candidate's build may call a model, and outside it that call would
    // reach Bedrock.
    await state.locked(async () => (state.aborted ? undefined : withModelBackend(backend, write)))
  } catch (error: unknown) {
    // Before the finally, so a credential failure stops the usage append below.
    noteFailure(state, error)
    throw error
  } finally {
    if (backend.calls() > 0 && !state.aborted) {
      await appendUsage(state, date, {
        attempt,
        builder: chain.builder,
        chain: chain.name,
        source: 'local',
        startedAt: new Date(start).toISOString(),
        wallClockMs: state.now() - start,
      })
    }
  }
}

const finalResult = async (
  state: RunState,
  date: PackDate,
  chain: Chain,
  want: number | undefined,
  finished: boolean,
) => {
  if (want === 0) {
    return { status: 'skipped' } as const
  }
  if (state.aborted && want === undefined) {
    return { status: 'aborted' } as const
  }
  try {
    const nowMissing = chain.plan(date, await readPuzzles(date)).count
    // A chain whose types are all present is complete, whatever stopped the run around it.
    if (state.aborted && !finished && nowMissing > 0) {
      return { status: 'aborted' } as const
    }
    return shortOrComplete(want ?? nowMissing, nowMissing)
  } catch (error: unknown) {
    noteFailure(state, error)
    logError('Could not read the pack after the chain', { chain: chain.name, date, error })
    return { status: state.aborted ? 'aborted' : 'failed' } as const
  }
}

const runChain = async (
  state: RunState,
  deps: LocalGenerationDeps,
  date: PackDate,
  chain: Chain,
): Promise<ChainResult> => {
  const label = `[${date} ${chain.name}]`
  // The missing count at the first successful read; `short` is reported against it.
  let want: number | undefined
  let done = false
  let attempt = 1
  for (; attempt <= MAX_CHAIN_ATTEMPTS && !state.aborted; attempt += 1) {
    try {
      const plan = chain.plan(date, await readPuzzles(date))
      want = want ?? plan.count
      if (plan.count === 0) {
        done = true
        break
      }
      // Another chain can detect a credential failure while this read is in flight.
      if (state.aborted) {
        break
      }
      const start = state.now()
      state.progress(`${label} attempt ${attempt}/${MAX_CHAIN_ATTEMPTS}`)
      await runAttempt(state, deps, date, chain, attempt, plan, start)
    } catch (error: unknown) {
      noteFailure(state, error)
      logWarning('Local chain attempt failed', { attempt, chain: chain.name, date, error })
      state.progress(`${label} attempt ${attempt} failed: ${errorMessage(error)}`)
    }
  }

  // A chain that used every attempt before another chain aborted the run still reports what it did.
  const finished = done || attempt > MAX_CHAIN_ATTEMPTS
  const result = await finalResult(state, date, chain, want, finished)
  state.progress(`${label} ${describeResult(result)}`)
  return result
}

const createSelfContained = async (state: RunState, date: PackDate): Promise<number | undefined> => {
  const startMissing = await readPuzzles(date).then(
    (puzzles) => selfContainedMissing(date, puzzles),
    (error: unknown) => {
      noteFailure(state, error)
      logError('Could not read the pack before createPack', { date, error })
      return undefined
    },
  )
  if (state.aborted) {
    return startMissing
  }
  try {
    await state.locked(() => createPack(date))
  } catch (error: unknown) {
    noteFailure(state, error)
    logError('Could not create the self-contained puzzles', { date, error })
  }
  return startMissing
}

const selfContainedResult = async (state: RunState, date: PackDate, startMissing: number | undefined) => {
  if (startMissing === 0) {
    return { status: 'skipped' } as const
  }
  try {
    const nowMissing = selfContainedMissing(date, await readPuzzles(date))
    return nowMissing > 0 && state.aborted
      ? ({ status: 'aborted' } as const)
      : shortOrComplete(startMissing ?? nowMissing, nowMissing)
  } catch (error: unknown) {
    noteFailure(state, error)
    logError('Could not read the pack after the chains', { date, error })
    return { status: state.aborted ? 'aborted' : 'failed' } as const
  }
}

const generateDate = async (state: RunState, deps: LocalGenerationDeps, date: PackDate): Promise<DateSummary> => {
  const startMissing = await createSelfContained(state, date)

  const all = chains()
  const settled = await Promise.allSettled(all.map((chain) => runChain(state, deps, date, chain)))
  const results = settled.map((outcome, index): ChainResult => {
    if (outcome.status === 'fulfilled') {
      return outcome.value
    }
    logError('A local chain failed outside its own catch', {
      chain: all[index].name,
      date,
      reason: String(outcome.reason),
    })
    return { status: 'failed' }
  })

  const selfContained = await selfContainedResult(state, date, startMissing)
  state.progress(`[${date} self-contained] ${describeResult(selfContained)}`)
  return {
    chains: Object.fromEntries(all.map((chain, index) => [chain.name, results[index]])) as Record<
      LocalChain,
      ChainResult
    >,
    date,
    selfContained,
  }
}

export const generatePacks = async (dates: PackDate[], deps: LocalGenerationDeps): Promise<RunSummary> => {
  const state: RunState = {
    aborted: false,
    locked: createLock(),
    now: deps.now ?? Date.now,
    progress: deps.onProgress ?? (() => undefined),
  }
  const summaries: DateSummary[] = []
  for (const date of dates) {
    if (state.aborted) {
      break
    }
    state.progress(`[${date}] starting`)
    summaries.push(await generateDate(state, deps, date))
  }
  return { aborted: state.aborted, dates: summaries }
}

const isAcceptable = (result: ChainResult, bestEffort: boolean): boolean =>
  result.status === 'complete' || result.status === 'skipped' || (result.status === 'short' && bestEffort)

export const exitCodeFor = (summary: RunSummary): 0 | 1 => {
  const bestEffort = new Map(chains().map((chain) => [chain.name, chain.bestEffort]))
  const acceptable = summary.dates.every(
    (date) =>
      isAcceptable(date.selfContained, false) &&
      Object.entries(date.chains).every(([name, result]) =>
        isAcceptable(result, bestEffort.get(name as LocalChain) === true),
      ),
  )
  return !summary.aborted && acceptable ? 0 : 1
}
