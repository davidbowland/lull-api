import { PackContribution } from '../../types'

// The one PackContribution literal for this type, in a leaf importing nothing but ../../types, so
// the manifest the request path may read and the implementation it may not cannot drift. Nothing
// here reaches the Bedrock SDK or the membership slice.
export const crypticClueContribution: PackContribution = {
  // A literal, never read from config.ts: this is the date the TYPE shipped, not the stack's
  // floor. It filters nothing today, since all six types declare PACK_START_DATE; it exists for a
  // type added LATER, to stop it marking the whole archive incomplete at once.
  //
  // MUST BE ZERO-PADDED and nothing at runtime checks it: '2026-9-1' <= '2026-10-15' is false, so
  // one unpadded literal makes this type apply to no date at all, silently and forever. The format
  // assertion over allContributions in generators/index.test.ts is what holds it.
  availableFrom: '2026-01-01',
  // BASE is the catalog range's low end (1-3 min) and PER is (180 - 60) / 4, mapping that range
  // onto bands 1 through 5 so band 5 lands on 180 exactly. On the literal rather than as module
  // constants: a ModelGenerator has no generate(), so estimatedSeconds exists only inside
  // Candidate.build, in a module the registry may not import.
  baseSeconds: 60,
  // Probation. This is the one type that makes `complete: false` the normal state, which costs
  // three things: the stack's only alarm channel is a level="ERROR" subscription filter, so
  // routine misses train the operator to ignore it; get-pack-by-date.ts invokes the builders for
  // any incomplete pack; and the client treats it as a refetch signal, so the date never settles.
  // It suppresses the ALARM, never the ATTEMPT -- isComplete is the one place bestEffort is
  // filtered, so a GET remains a repair path.
  bestEffort: true,
  countPerDay: 2,
  // difficulties.length must equal countPerDay, since missingDifficulties asks for one puzzle per
  // declared band; generators/index.test.ts asserts it over every type.
  //
  // Band 4 is deliberately empty and every other type skips bands too: excluding this type it has
  // three occupants where band 5 has two, the thinnest in the catalog. Band 5 has TWO devices
  // behind it because this type can starve a band on DEVICE MIX rather than on clue quality.
  //
  // CHANGING THESE BANDS DOES NOT REPAIR STORED PACKS. The gate on the async builder is
  // hasWorkRemaining, a COUNT rather than a band comparison, so a stored pack holding two
  // crypticclue puzzles grades satisfied however stale its devices are and no builder is ever
  // invoked for that date again. The delete-and-rebuild runbook in endpoints.rest is therefore
  // mandatory for a device change; `npm run audit-cryptic` is its verification step.
  difficulties: [3, 5],
  secondsPerDifficulty: 30,
  type: 'crypticclue',
}
