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
// crypticClueGenerator goes LAST, and the reason is WRITE ORDER -- not survival.
//
// This comment used to say that GENERATOR_BUDGET_MS bounds when the last fetchCandidates call may
// START, so this array's order decided which type a slow night skipped, so putting the bestEffort
// type last meant only a best-effort shortfall was ever lost. NONE OF THAT IS TRUE ANY MORE, and it
// is corrected in place rather than deleted because the old reading is a comfortable thing to
// re-derive. create-model-puzzles.ts fetches every generator CONCURRENTLY: the budget bounds no
// fetch at all, only the serial WRITE loop that follows, and when it fires it fires on the FIRST
// entry -- the loop's first clock reading is essentially the moment the slowest fetch settled, so
// every type is past the bound together. It is ALL-OR-NOTHING. themedanagrams, the REQUIRED type, is
// skipped alongside the best-effort one, which is a genuinely incomplete pack rather than the
// graduated shortfall this ordering used to buy. Ordering cannot protect anybody from that; only the
// value of the bound can, and that value is now derived from what a WRITE costs and is indifferent
// to which generator sits where.
//
// What the order still decides is the sequence of the conditional writes and the order
// `Model budget spent, skipping the remaining types` lists them in. Writing the required type first
// is the right default -- if a write does fail or lose its race, the one that costs the pack its
// completeness has already gone in -- and a stable order makes that ERROR readable. One line of
// ordering, doing a smaller job than it was once credited with.
export const modelGenerators: ModelGenerator[] = [themedAnagramsGenerator, crypticClueGenerator]
