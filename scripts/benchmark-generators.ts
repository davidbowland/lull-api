#!/usr/bin/env ts-node
import { selfContainedGenerators } from '../src/generators'
import { PackDate } from '../src/types'

// HAND-RUN, and deliberately not a Jest test: a wall-clock p95 assertion is exactly the test
// CLAUDE.md forbids -- one that passes today and fails tomorrow. What goes in Jest is the
// deterministic budget assertion over budgetMsPerPuzzle, in __tests__/unit/generators/index.test.ts.
//
// scripts/ is unmeasured by collectCoverageFrom ('src/**/*'), so this file contributes nothing to
// the coverage thresholds and no coverage number will ever tell you whether it is exercised.
// `npm run typecheck` is its only gate.
//
// FLIPPING ANY GENERATOR TO inRequest: true COSTS THREE NUMBERS, NOT ONE. This script produces the
// first and only the first; the other two are still measured by hand, and they are the ones the
// criterion misses:
//
//   1. generate() p50 AND WORST over >= 200 trials of a full countPerDay run at EVERY declared
//      difficulty, storage stubbed. Publish both, so the graded table finally measures one thing --
//      a row quoted as p50/worst and a row quoted as p50/p95 are not comparable.
//   2. Module-init and index-build cost, measured separately and COLD -- a fresh module registry, so
//      corpus parse and index construction are inside the number rather than amortised away by a
//      warm container. esbuild bundles the whole registry into get-pack-by-date, so that cost is
//      paid on cold start WHETHER OR NOT THE GENERATOR RUNS. This script cannot produce it: by the
//      time the loop below starts, every generator's module has already been evaluated.
//   3. The get-pack bundle delta and the observed cold-start delta for GetPackByDateFunction,
//      against its 15-second timeout, MULTIPLIED BY EIGHT because usePrefetch walks up to eight
//      dates sequentially.
//
// Plus the redraw bound priced at its BOUND and not its median, and the two ceilings checked: the
// 10-second budget plus one whole generate plus the write against a 15-second timeout leaves ~5
// seconds of real headroom.
//
// Measured once against a rejected design, the numbers are why this rule exists: a module-scope
// lexical index added 852,948 B to the public GET bundle, 6.2 ms parse + 35.7 ms index build locally
// (85-170 ms estimated Lambda x86 cold start, x8 on a cold prefetch fan-out) and +46.7 MB RSS -- for
// a generator fillPack filters out anyway. A generator that needs a lexical oracle at runtime is
// inRequest: false by that fact alone, no measurement required.

const TRIALS = 200

// A fixed date, so a re-run is comparable with the last one. Generators seed off the date, so this
// picks the same puzzles every trial -- the timing spread this reports is the machine's, not the
// draw's. A generator whose cost varies by DATE wants a second run against a different literal.
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
    // Per WHOLE RUN and per PUZZLE both, because the two fields being checked are per-puzzle:
    // budgetMsPerPuzzle is what the Jest budget assertion sums, and the worst per-puzzle figure is
    // what it has to cover. Dividing by difficulties.length is dividing by countPerDay -- the
    // registry test pins those equal, so a run IS a full day of this type.
    const perPuzzle = (whole: number): number => whole / generator.difficulties.length
    // p50 AND worst. A new grade publishes both.
    console.log(
      `${generator.type}: run p50 ${percentile(sorted, 0.5).toFixed(2)}ms, p95 ${percentile(sorted, 0.95).toFixed(2)}ms, worst ${sorted[sorted.length - 1].toFixed(2)}ms over ${TRIALS} trials of a full ${generator.countPerDay}-puzzle day; per puzzle p50 ${perPuzzle(percentile(sorted, 0.5)).toFixed(2)}ms, worst ${perPuzzle(sorted[sorted.length - 1]).toFixed(2)}ms against a declared budgetMsPerPuzzle of ${generator.budgetMsPerPuzzle}`,
    )
  }
}

run().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
