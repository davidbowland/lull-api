import { ModelGenerator } from '../types'
import { crypticClueGenerator } from './crypticclue/generator'
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
// crypticClueGenerator goes LAST, deliberately. GENERATOR_BUDGET_MS bounds when the LAST
// fetchCandidates call may START -- it is a budget for the WHOLE LOOP, not per type, checked once
// per iteration against a single start -- and two model types share it, so this array order decides
// which type is skipped on a slow night. Cryptic Clue is the bestEffort type: a skipped clue is
// short by design and stays out of the pack-level alarm, while a skipped Themed Anagrams set is a
// genuine incomplete pack. One line of ordering doing the work a priority field would otherwise
// want.
export const modelGenerators: ModelGenerator[] = [themedAnagramsGenerator, crypticClueGenerator]
