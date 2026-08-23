import { ModelGenerator } from '../types'

// Imported ONLY by the async model-puzzle handler. See the comment on modelContributions in
// generators/index.ts: that module is data the request path may read, and this one is
// implementations the request path must never import. Two lists, named apart, because a single list
// cannot be both.
//
// Ships empty. Each model-backed type will append one entry here and one PackContribution literal to
// modelContributions -- both derived from a single per-type leaf that imports nothing but ../../types,
// so the manifest and the implementation cannot drift.
export const modelGenerators: ModelGenerator[] = []
