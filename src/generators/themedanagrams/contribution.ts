import { PackContribution } from '../../types'

// The one PackContribution literal for this type, in a leaf that imports nothing but ../../types, so
// the manifest the request path may read cannot drift from the implementation it may not, and
// resolving src/generators pulls in neither the lexicon, the Bedrock SDK nor a string builder.
export const themedAnagramsContribution: PackContribution = {
  // The day after lull-ui's reader for this type ships: the API must not emit a type before a board
  // can render it.
  //
  // DEPLOY lull-ui FIRST AND THIS API SECOND. The mirror image of that rule orders the current
  // change: dropping `hints` from cryptogram, phrazle and themed anagrams is endpoints.rest's clause
  // (b), and all three have been live since PACK_START_DATE, so an API-first deploy writes packs
  // with no `hints` while production lull-ui calls hintsOf, gets null and hides the hint bar. The
  // client can go first because its adapters compute the ladder from `answer`. Step 0 is the ONLY
  // step of clause (b) that applies -- a stale `hints` field is ignored rather than misread -- and
  // step 1 destroys every historical pack and puzzle id, so it MUST NOT be run.
  //
  // Zero-padded, and nothing at runtime checks that: '2026-9-1' <= '2026-09-15' is false, so one
  // unpadded literal makes this type apply to no date at all. generators/index.test.ts asserts it.
  availableFrom: '2026-01-01',
  // The catalog rates this type at 1-2 minutes; BASE is the low end and PER is (high - low) / 4, so
  // the declared bands come out 75 / 90 / 105 seconds.
  baseSeconds: 60,
  // Not bestEffort: isComplete uses `>=`, so an over-claimed count makes every pack permanently
  // incomplete with no code path able to clear it, where under-claiming is recoverable. Three is
  // safe because the dial is code-owned, so no declared band can starve on THEME content.
  countPerDay: 3,
  // One target per puzzle. Band 4 is the only one at risk, and on word SHAPE rather than theme
  // content: measured per-word success at the derived attempt budget is >=98% at every length at or
  // above MIN_WORD_LENGTH. Band 1 is the loosest row in SEVERITY_BY_DIFFICULTY.
  difficulties: [1, 3, 4],
  secondsPerDifficulty: 15,
  type: 'themedanagrams',
}
