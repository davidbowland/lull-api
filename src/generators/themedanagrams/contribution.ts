import { PackContribution } from '../../types'

// THE ONE PackContribution LITERAL for this type, in a leaf that imports nothing but ../../types.
// generators/index.ts reads it and generators/themedanagrams/generator.ts spreads it, so the manifest
// the request path may read and the implementation it may not cannot drift.
//
// Nothing here reaches the lexicon, the Bedrock SDK or any string builder -- which is what keeps
// resolving src/generators free of both, and is why the file exists at all rather than the
// contribution living beside fetchCandidates.
export const themedAnagramsContribution: PackContribution = {
  // THE DAY AFTER lull-ui's reader for this type ships, not the day this branch merges. HintMetadata
  // gains a member here, and a client that does not know the `themedanagrams-entry` tag is a client
  // reading an unknown shape -- so the API must not emit the type before the board can render it.
  //
  // Zero-padded, and nothing at runtime checks that: '2026-9-1' <= '2026-09-15' is FALSE, so one
  // unpadded literal makes this type apply to no date at all, silently and forever. What holds it is
  // the format assertion over allContributions in generators/index.test.ts.
  availableFrom: '2026-01-01',
  // The catalog rates this type at 1-2 minutes; BASE is the range's low end and PER is (high - low)
  // / 4, so the declared bands come out 75 / 90 / 105 seconds and difficulty 5 would land exactly on
  // 120. Literally the pair Missing Vowels carries, which is where on the shelf this sits.
  baseSeconds: 60,
  // NOT bestEffort, and that is argued rather than assumed. isComplete uses `>=`, so an over-claimed
  // count makes every pack permanently incomplete with no code path able to clear it -- under-claiming
  // is the recoverable direction. Three is safe because supply is unlimited by the catalog's own
  // grading, the dial is code-owned so no declared band can starve on THEME content, and the 4x set
  // over-ask plus the six-asked-four-shipped floor absorb a thin batch.
  countPerDay: 3,
  // One target per puzzle. Band 4 is the only one at risk, and it is at risk on word SHAPE rather
  // than on theme content: measured per-word success at the derived attempt budget is >=92.5% at
  // length 5 and >=98% everywhere else, against six words asked and four needed.
  //
  // Band 1 replaces band 2 and is the LOOSEST row in SEVERITY_BY_DIFFICULTY -- maxAgreements
  // floor(length / 2) against band 2's floor(length / 3), maxPreservedRun 4 against 3 -- so every
  // scramble band 2 accepted band 1 also accepts, and the supply argument above only gets easier.
  // Nothing else moves: the dial is a generation INPUT code sets before the model is paid, so a band
  // change here cannot starve on theme content.
  difficulties: [1, 3, 4],
  secondsPerDifficulty: 15,
  type: 'themedanagrams',
}
