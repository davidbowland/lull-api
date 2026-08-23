import { ModelGenerator } from '../types'
import { themedAnagramsGenerator } from './themedanagrams/generator'

// Imported ONLY by the async model-puzzle handler. See the comment on modelContributions in
// generators/index.ts: that module is data the request path may read, and this one is
// implementations the request path must never import. Two lists, named apart, because a single list
// cannot be both.
//
// Each model-backed type appends one entry here and one PackContribution literal to
// modelContributions -- both derived from a single per-type leaf that imports nothing but ../../types,
// so the manifest and the implementation cannot drift. themedAnagramsGenerator spreads
// themedAnagramsContribution for exactly that reason.
export const modelGenerators: ModelGenerator[] = [themedAnagramsGenerator]
