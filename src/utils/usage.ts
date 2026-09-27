import { AsyncLocalStorage } from 'node:async_hooks'

import { InvocationUsage, ModelTokenUsage } from '../types'

// USD per million tokens, keyed by the model ID with any Bedrock region/vendor prefix and version
// suffix stripped. These are Anthropic's list prices; Bedrock's us.* cross-region profiles can carry
// different rates, so check https://aws.amazon.com/bedrock/pricing/ before trusting a cost to the
// cent. cacheWrite is the 5-minute-TTL write rate.
const MODEL_PRICING_PER_MTOK: Record<string, { cacheRead: number; cacheWrite: number; input: number; output: number }> =
  {
    'claude-opus-5-5': { cacheRead: 0.2, cacheWrite: 5, input: 4, output: 20 },
    'claude-sonnet-5': { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 },
  }

// Lambda x86_64 duration price in us-east-1. Request charges ($0.20/M) are too small to matter here.
const LAMBDA_USD_PER_GB_SECOND = 0.0000166667

// The `usage` object of an Anthropic Messages response body. Every field is optional because the
// cache fields are omitted when no caching happened, and a malformed body must not throw.
export interface RawModelUsage {
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

export interface UsageClock {
  cpuUsage: () => { system: number; user: number }
  maxRssKb: () => number
  now: () => number
}

export interface UsageTracker {
  recordModel: (model: string, usage: RawModelUsage | undefined) => void
  snapshot: (builder: InvocationUsage['builder']) => InvocationUsage
}

const defaultClock: UsageClock = {
  cpuUsage: () => process.cpuUsage(),
  // Peak RSS for the whole process, so on a warm container it can reflect an earlier invocation.
  maxRssKb: () => process.resourceUsage().maxRSS,
  now: Date.now,
}

const roundTo = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places

const baseModelId = (model: string): string => (model.split('anthropic.').pop() as string).split(':')[0]

type TokenCounts = Pick<ModelTokenUsage, 'input' | 'inputCacheWrite' | 'inputCached' | 'output'>

export const modelCostUsd = (model: string, tokens: TokenCounts): number | undefined => {
  const pricing = MODEL_PRICING_PER_MTOK[baseModelId(model)]
  if (!pricing) {
    return undefined
  }
  const cost =
    tokens.input * pricing.input +
    tokens.output * pricing.output +
    tokens.inputCached * pricing.cacheRead +
    tokens.inputCacheWrite * pricing.cacheWrite
  return roundTo(cost / 1_000_000, 6)
}

export const toTokenCounts = (usage: RawModelUsage | undefined): TokenCounts => ({
  input: usage?.input_tokens ?? 0,
  inputCached: usage?.cache_read_input_tokens ?? 0,
  inputCacheWrite: usage?.cache_creation_input_tokens ?? 0,
  output: usage?.output_tokens ?? 0,
})

// One tracker per Lambda invocation.
export const createUsageTracker = (memoryLimitMb: number, clock: UsageClock = defaultClock): UsageTracker => {
  const startedAt = clock.now()
  const cpuStart = clock.cpuUsage()
  const tokens = new Map<string, ModelTokenUsage>()

  const recordModel = (model: string, usage: RawModelUsage | undefined): void => {
    const counts = toTokenCounts(usage)
    const entry = tokens.get(model) ?? {
      input: 0,
      inputCacheWrite: 0,
      inputCached: 0,
      invocations: 0,
      model,
      output: 0,
    }
    tokens.set(model, {
      ...entry,
      input: entry.input + counts.input,
      inputCacheWrite: entry.inputCacheWrite + counts.inputCacheWrite,
      inputCached: entry.inputCached + counts.inputCached,
      invocations: entry.invocations + 1,
      output: entry.output + counts.output,
    })
  }

  const snapshot = (builder: InvocationUsage['builder']): InvocationUsage => {
    const cpuNow = clock.cpuUsage()
    const wallClockMs = clock.now() - startedAt
    const cpuMs = (cpuNow.user - cpuStart.user + cpuNow.system - cpuStart.system) / 1000
    const gbSeconds = (wallClockMs / 1000) * (memoryLimitMb / 1024)

    const tokenList = [...tokens.values()].map((entry): ModelTokenUsage => {
      const costUsd = modelCostUsd(entry.model, entry)
      return costUsd === undefined ? entry : { ...entry, costUsd }
    })
    const lambdaCostUsd = roundTo(gbSeconds * LAMBDA_USD_PER_GB_SECOND, 6)
    const modelsCostUsd = roundTo(
      tokenList.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
      6,
    )

    return {
      builder,
      costUsd: { lambda: lambdaCostUsd, models: modelsCostUsd, total: roundTo(lambdaCostUsd + modelsCostUsd, 6) },
      cpuMs: roundTo(cpuMs, 0),
      gbSeconds: roundTo(gbSeconds, 3),
      maxMemoryMb: roundTo(clock.maxRssKb() / 1024, 0),
      memoryLimitMb,
      startedAt: new Date(startedAt).toISOString(),
      tokens: tokenList,
      wallClockMs,
    }
  }

  return { recordModel, snapshot }
}

// Scoped to the async call chain rather than threaded through arguments: the model calls sit under
// generators, batch helpers and reviewers that share no signature, and the builders fetch
// concurrently. Outside trackUsage -- scripts/, tests -- recordModelUsage does nothing.
const activeTracker = new AsyncLocalStorage<UsageTracker>()

export const trackUsage = <T>(tracker: UsageTracker, work: () => Promise<T>): Promise<T> =>
  activeTracker.run(tracker, work)

export const recordModelUsage = (model: string, usage: RawModelUsage | undefined): void =>
  activeTracker.getStore()?.recordModel(model, usage)
