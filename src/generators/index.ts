import { Generator, PackContribution, PhraseGenerator } from '../types'
import { crypticClueContribution } from './crypticclue/contribution'
import { cryptogramGenerator } from './cryptogram/generator'
import { goFigureGenerator } from './gofigure/generator'
import { missingVowelsGenerator } from './missingvowels/generator'
import { phrazleGenerator } from './phrazle/generator'
import { themedAnagramsContribution } from './themedanagrams/contribution'

// The registry, split by what a generator needs: self-contained generators need only a date and a
// difficulty and so may run inside a request; phrase generators need a phrase and so only run in the
// async builder; model generators make their own Bedrock call and live one module away.
//
// Membership here is also a claim about which IAM role runs you: createPack iterates exactly this
// list inside CreatePackFunction, whose policy block holds no Bedrock grant.
export const selfContainedGenerators: Generator[] = [goFigureGenerator]

// Order is load-bearing: these three draw greedily from one shared, mutated pool of phrases.
//
// Scarcest first. Phrazle and Cryptogram want overlapping phrases, and Phrazle's hardest band has
// the fewest candidates, so it picks first; on a thin pool the other order starves it. Missing
// Vowels goes last because it accepts almost anything and would drain the pool -- it takes what the
// other two declined. __tests__/unit/generators/index.test.ts measures the overlap ratio.
//
// Assignment stays fixed-order greedy rather than a global min-cost matching: a global match would
// change which puzzle gets which phrase run to run, making "why was there no Phrazle on the 14th?"
// hard to answer from a log.
export const phraseGenerators: PhraseGenerator[] = [phrazleGenerator, cryptogramGenerator, missingVowelsGenerator]

// DATA ONLY. These entries declare types that reach Bedrock; their implementations live in
// generators/model.ts, which this module must never import. packs.ts imports this file and
// get-pack-by-date.ts imports packs.ts, so an import here puts the Bedrock SDK into the public GET
// function's bundle and constructs a BedrockRuntimeClient at every cold start of an unauthenticated,
// 15-second-timeout function whose role has no grant to use it. Each entry must be a leaf importing
// nothing but ../../types.
//
// Two guards hold this:
//
//   * `no-restricted-imports` in eslint.config.mjs, scoped to this file and services/packs.ts. It
//     matches paths, so an implementation module under a new name walks past it.
//   * the module-factory probe in __tests__/unit/generators/index.test.ts, which loads this module
//     and src/handlers/get-pack-by-date.ts (GetPackByDateFunction's esbuild entry) in a clean
//     registry and asserts the Bedrock SDK's factory never runs. The handler subject is the one that
//     catches a leak elsewhere in the bundle.
//
// Neither guard sees a LAZY import: the factory never runs at load and the lint rule ignores
// `await import()`, but esbuild bundles a reachable dynamic import all the same. Only review catches
// that one.
export const modelContributions: PackContribution[] = [themedAnagramsContribution, crypticClueContribution]

// Completeness is asked of everything a pack owes, whoever builds it. A build that produced only
// the self-contained puzzles must not mark the day done, or the client stops refetching and the day
// stays short.
export const allContributions: PackContribution[] = [
  ...selfContainedGenerators,
  ...phraseGenerators,
  ...modelContributions,
]
