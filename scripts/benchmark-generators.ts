#!/usr/bin/env ts-node
import { selfContainedGenerators } from '../src/generators'
import { PackDate } from '../src/types'

// Hand-run, deliberately not a Jest test: a wall-clock p95 assertion passes today and fails tomorrow.
// The deterministic budget assertion over budgetMsPerPuzzle lives in __tests__/unit/generators/index.test.ts.
//
// This reports only the first of the three numbers a flip to `inRequest: true` costs. Module-init and
// index-build cost must be measured cold and separately, since esbuild bundles the whole registry into
// get-pack-by-date and that cost is paid on cold start whether or not the generator runs; by the time
// the loop below starts, every generator's module here is already evaluated. So must the bundle and
// cold-start deltas for GetPackByDateFunction against its 15-second timeout, times eight because
// usePrefetch walks up to eight dates sequentially. A generator that needs a lexical oracle at runtime
// is `inRequest: false` by that fact alone.

const TRIALS = 200

// A fixed date, so a re-run is comparable with the last one: generators seed off the date, so the
// spread reported here is the machine's, not the draw's.
const DATE: PackDate = '2026-08-20'

const percentile = (sorted: number[], fraction: number): number => sorted[Math.floor(sorted.length * fraction)]

const run = async (): Promise<void> => {
  for (const generator of selfContainedGenerators) {
    const timings: number[] = []
    for (let trial = 0; trial < TRIALS; trial++) {
      const start = process.hrtime.bigint()
      for (const difficulty of generator.difficulties) {
        await generator.generate(DATE, difficulty)
      }
      timings.push(Number(process.hrtime.bigint() - start) / 1_000_000)
    }
    const sorted = [...timings].sort((left, right) => left - right)
    // Per puzzle as well as per run, because budgetMsPerPuzzle is per-puzzle. difficulties.length equals
    // countPerDay -- the registry test pins them equal -- so a run is a full day of this type.
    const perPuzzle = (whole: number): number => whole / generator.difficulties.length
    console.log(
      `${generator.type}: run p50 ${percentile(sorted, 0.5).toFixed(2)}ms, p95 ${percentile(sorted, 0.95).toFixed(2)}ms, worst ${sorted[sorted.length - 1].toFixed(2)}ms over ${TRIALS} trials of a full ${generator.countPerDay}-puzzle day; per puzzle p50 ${perPuzzle(percentile(sorted, 0.5)).toFixed(2)}ms, worst ${perPuzzle(sorted[sorted.length - 1]).toFixed(2)}ms against a declared budgetMsPerPuzzle of ${generator.budgetMsPerPuzzle}`,
    )
  }
}

run().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
