import { ModelGenerator } from '../types'
import { crypticClueGenerator } from './crypticclue/generator'
import { themedAnagramsGenerator } from './themedanagrams/generator'

// Imported ONLY by the async model-puzzle handler. This module holds implementations the request
// path must never import; modelContributions in generators/index.ts holds the data it may read.
//
// Each model-backed type appends one entry here and one PackContribution literal to
// modelContributions, both derived from a single per-type leaf importing nothing but ../../types, so
// the manifest and the implementation cannot drift. themedAnagramsGenerator spreads
// themedAnagramsContribution for that reason.
//
// Order decides the sequence of the serial write loop in create-model-puzzles.ts, not which type a
// slow night skips -- fetches run concurrently and GENERATOR_BUDGET_MS bounds only the writes, all
// or nothing. themedanagrams, the required type, is written first so a failed or lost write costs
// the pack its completeness last.
export const modelGenerators: ModelGenerator[] = [themedAnagramsGenerator, crypticClueGenerator]
