import { PackContribution } from '../../types'

// THE ONE PackContribution LITERAL for this type, in a leaf that imports nothing but ../../types.
// generators/index.ts reads it and generators/crypticclue/generator.ts spreads it, so the manifest
// the request path may read and the implementation it may not cannot drift.
//
// Nothing here reaches the Bedrock SDK or the 152,206-entry membership slice, which is what keeps
// resolving src/generators free of both.
export const crypticClueContribution: PackContribution = {
  // A LITERAL, never read from config.ts: this is the date the TYPE shipped, not the date the
  // stack's floor sits at, and wiring it to an env var would make a code fact into a deploy fact.
  //
  // SET FORWARD ON PURPOSE. This type ships DISABLED until its entry gate is met -- 30 dry-run
  // batches producing enough verified clues at a high enough blind solve rate -- and until lull-ui
  // has a reader for it. appliesTo filters the contribution out of every earlier date, so no
  // archived pack becomes incomplete and no GET fans out. Reset it to the day after lull-ui's reader
  // deploys, in the release commit.
  //
  // Zero-padded, and nothing at runtime checks that: '2026-9-1' <= '2026-10-15' is FALSE, so one
  // unpadded literal makes this type apply to no date at all, silently and forever. What holds it is
  // the format assertion over allContributions in generators/index.test.ts.
  availableFrom: '2026-01-01',
  // BASE is the catalog range's low end (1-3 min), PER is (180 - 60) / 4. ON THE LITERAL, not as
  // module constants -- a ModelGenerator has no generate(), so estimatedSeconds exists only inside
  // Candidate.build in a module the registry may not import, and the pack-duration ceiling test can
  // reach the number by no other route. Difficulty 3 -> 60 + 30 * 2 = 120.
  baseSeconds: 60,
  // PROBATION, with a stated exit condition rather than a permanent excuse, and it is filtered in
  // exactly one .filter() clause in isComplete and nowhere else.
  //
  // WHAT IT BUYS. This is the one type that makes `complete: false` the NORMAL state -- the cover is
  // the harshest gate in this repo and it will reject clues that are fair -- and complete: false has
  // three costs. The alarm: there is no CloudWatch alarm in this stack at all, only subscription
  // filters on level="ERROR", so at a miss rate of a third the sole alarm channel fires on a healthy
  // night a third of the time and the operator's correct learned response becomes "ignore", which
  // also deletes the alarm for Missing Vowels. The fan-out: get-pack-by-date.ts invokes the builders
  // for ANY pack with complete: false, gated only by a per-date claim, and a client prefetches eight
  // dates -- a permanently incomplete date is a permanently reclaimable one. The client: complete:
  // false is the refetch signal, so the date never settles.
  //
  // IT SUPPRESSES THE ALARM, NEVER THE ATTEMPT. missingDifficulties still asks for this type, and so
  // does hasWorkRemaining -- isComplete is the one place bestEffort is filtered. So a pack missing
  // ONLY its cryptic clue reads complete: true to the client, which stops refetching, while the same
  // GET still hands the date to the model builder under claimPackGeneration. That second question is
  // what makes a GET a repair path here, and it is why removing the 05:33 retry schedule did not
  // leave this type with the 03:33 nightly as its only attempt.
  bestEffort: true,
  countPerDay: 1,
  // difficulties.length === countPerDay, enforced by consequence rather than by comment. A type
  // owing one puzzle a day owes one band, and a type with one puzzle a day HAS NO DIAL TO IMPLEMENT
  // -- a dial exists to spread a type's SEVERAL daily puzzles. The catalog's "difficulty dial: clue
  // type" line is struck for a mechanical reason: missingDifficulties compares stored puzzles
  // against THIS DEPLOY's declared array, so Monday's stored [3] against Tuesday's declared [4]
  // reports one missing puzzle on every historical pack, every day, forever -- and every nightly
  // top-up and every GET re-triggers a model-backed generation for it.
  //
  // Band 3 because the catalog's 1-3 minute range puts it mid-shelf, and because a narrowed
  // two-device type with a full code-built ladder and the enumeration given has no claim on 4 or 5.
  difficulties: [3],
  secondsPerDifficulty: 30,
  type: 'crypticclue',
}
