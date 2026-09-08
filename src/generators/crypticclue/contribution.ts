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
  // IN THE PAST, AND THE TYPE IS LIVE. This comment used to read "SET FORWARD ON PURPOSE. This type
  // ships DISABLED until its entry gate is met ... Reset it to the day after lull-ui's reader
  // deploys" -- which described a launch that has already happened, against a literal nine months in
  // the past. It was the eleventh instance on this branch alone of a comment outliving the premise
  // that justified it, and the most misleading, because it told a reader the type was dark while the
  // same file's newer paragraphs assume it is serving.
  //
  // WHAT THAT MEANS FOR THE 2026-09-07 DEVICE CHANGE, and it is why the correction matters rather
  // than being tidy: this date is what makes the delete-and-rebuild runbook in endpoints.rest
  // MANDATORY for that deploy. Roughly eight months of archived packs hold crypticclue puzzles, every
  // one of them `hidden` or `anagram`, and both devices are gone. Had the type genuinely still been
  // dark, there would have been nothing stored to delete and the runbook would have been optional.
  //
  // IT FILTERS NOTHING TODAY, and the sentence that used to sit here said the opposite: "appliesTo
  // filters the contribution out of every date before this one, so it still governs which archived
  // dates are asked for the type at all." All six types declare 2026-01-01, which IS PACK_START_DATE,
  // so appliesTo is true on every servable date and no date is filtered out of anything --
  // endpoints.rest says so in as many words. What availableFrom is FOR is a type added LATER: it is
  // what would stop a newly-shipped type marking the entire archive incomplete at once. A live guard
  // with nothing to guard yet is worth keeping and is not worth describing as a live filter.
  //
  // Zero-padded, and nothing at runtime checks that: '2026-9-1' <= '2026-10-15' is FALSE, so one
  // unpadded literal makes this type apply to no date at all, silently and forever. What holds it is
  // the format assertion over allContributions in generators/index.test.ts.
  availableFrom: '2026-01-01',
  // BASE is the catalog range's low end (1-3 min), PER is (180 - 60) / 4. ON THE LITERAL, not as
  // module constants -- a ModelGenerator has no generate(), so estimatedSeconds exists only inside
  // Candidate.build in a module the registry may not import, and the pack-duration ceiling test can
  // reach the number by no other route. Difficulty 3 -> 60 + 30 * 2 = 120.
  //
  // NEITHER NUMBER IS STALE UNDER THE NEW BANDS, and it was worth checking rather than assuming: the
  // pair maps the catalog's stated 1-3 min onto bands 1 through 5, so the band-5 puzzle this type now
  // owes lands on 60 + 30 * 4 = 180 -- the TOP OF THE RANGE, exactly. The derivation was always
  // written for five bands; this is the first branch that exercises the fifth.
  //
  // THAT 30-SECOND CLAIM COST A CEILING, and the cost is recorded where it was paid rather than
  // hidden here. Moving one puzzle from band 4 to band 5 took the registry's summed estimatedSeconds
  // from 2,385 to 2,415 against a 2,400 ceiling that was already 99.4% spent, and
  // generators/index.test.ts carries the decision to raise it to 2,500 along with the two
  // alternatives that were refused. The one that would have been paid HERE -- trimming PER from 30 to
  // 25 so the sum fits -- is a derived number adjusted because a test went red, when nothing about
  // the puzzle got faster. These devices are HARDER than the ones they replace, which is the whole
  // point of the branch, so an estimate moving DOWN would have been the wrong direction twice over.
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
  countPerDay: 2,
  // difficulties.length === countPerDay, enforced by consequence rather than by comment: a type owes
  // countPerDay puzzles and missingDifficulties asks for one per declared band, so the two arrays
  // ARE the same array counted twice. generators/index.test.ts asserts the equality over every type.
  //
  // THE CATALOG'S "DIFFICULTY DIAL: CLUE TYPE" LINE IS UNSTRUCK. It was struck because this type
  // owed one puzzle a day and a type with one puzzle a day has no dial to implement -- a dial exists
  // to spread a type's SEVERAL daily puzzles, and there was only ever one. Owing two, the dial is
  // required, and generator.ts implements it as a READ OF A PROVED FIELD rather than a rating:
  // `device`, plus `parts.length` on a charade, and nothing else.
  //
  //   deletion          -> 3   one unknown, and the indicator SIGNPOSTS the operation
  //   charade, 2 parts  -> 3   two unknowns, no indicator at all
  //   charade, 3+ parts -> 5   three or more unknowns, no indicator at all
  //   doubledefinition  -> 5   no letter work; recognizing the device IS the solve
  //
  // THE ARGUMENT FOR BAND 5 IS NEW, AND IT HAD TO BE. The paragraph this replaces concluded that
  // "band 5 remains unclaimed" because, averaged over its devices, this type "is a mid-shelf puzzle".
  // That was a true claim ABOUT `hidden` AND `anagram`, and both were deleted on 2026-09-07: each was
  // a literal-string operation on characters already printed on the player's screen, so the wordplay
  // fully determined the answer and the definition did no work. A conclusion cannot outlive the two
  // things it was reasoned over, so it is rewritten rather than quietly contradicted. These three
  // devices make the solver SUPPLY the word the wordplay operates on -- CAR is not in the clue,
  // BRANDY is not in the clue -- which is the property that puts the harder half of the set at 5.
  //
  // BAND 4 IS DELIBERATELY EMPTY, and that is a shape the catalog already has rather than a gap.
  // Every other type skips bands: gofigure [2,4,5], phrazle [2,3,5], missingvowels [1,2,4],
  // themedanagrams [1,3,4]. Coverage EXCLUDING this type, in puzzles per day, read off those four
  // arrays plus cryptogram [2,3]:
  //
  //   band 1  themedanagrams, missingvowels                        2
  //   band 2  cryptogram, missingvowels, gofigure, phrazle         4
  //   band 3  cryptogram, themedanagrams, phrazle                  3
  //   band 4  themedanagrams, missingvowels, gofigure              3
  //   band 5  gofigure, phrazle                                    2
  //
  // Band 3 does not need this type and band 4 has three occupants without it. Band 5 is the thinnest
  // band in the catalog and this type has never claimed it, so vacating 3 costs the pack nothing and
  // claiming 5 fills the one real hole. Which is also what the 30 extra seconds on the ceiling bought
  // -- see the note on baseSeconds above.
  //
  // BAND 5 HAS TWO INDEPENDENT OCCUPANTS BY DESIGN, and the hazard is one this comment named before
  // the devices changed: THIS TYPE CAN STARVE A BAND ON DEVICE MIX rather than on clue quality. One
  // device per band reintroduces it -- a night where the model writes no usable double definition
  // would leave band 5 empty on its own. `charade`-with-3-parts and `doubledefinition` both land
  // there, so either one alone fills the day.
  //
  // COUNT STAYS AT 2 rather than rising to 3. `asked = count * CANDIDATES_PER_PUZZLE`, so a third
  // puzzle takes one call's ask from 16 clues to 24, and generator.ts records what a large output
  // costs: max_tokens is shared with adaptive thinking, and a run that spends the budget thinking
  // returns no tool_use block and loses the whole night. These devices are harder to write correctly,
  // so the right answer to a falling pass rate is more candidates per puzzle, not more puzzles.
  //
  // A STORED PACK DOES NOT SELF-HEAL ONTO THESE BANDS, and the paragraph that stood here said it
  // did. It read: "missingDifficulties compares stored puzzles against THIS DEPLOY's declared array,
  // so every historical pack -- which could hold at most a band-3 cryptic ... -- now reports both
  // bands missing, and every GET for such a date hands it to the model builder." Every clause of
  // that is wrong, and the third is the one that matters.
  //
  //   * MASTER DECLARES [3, 4], not [3]. countPerDay has been 2 since before this branch, so a
  //     historical pack holds a band-3 AND a band-4 cryptic, not "at most a band-3".
  //   * SO ONE BAND READS MISSING, NOT BOTH. missingDifficulties over a present set of {3, 4}
  //     against a declared [3, 5] returns [5]. Band 3 is already there and stays there.
  //   * AND NOTHING ASKS FOR IT ANYWAY, which is the correction that changes what an operator has to
  //     do. The gate on an async builder is hasWorkRemaining, NEVER missingDifficulties, and
  //     hasWorkRemaining is `isSatisfied`, which is `countOfType(...) >= countPerDay` -- a COUNT, not
  //     a band comparison. A stored pack already holds two crypticclue puzzles, so the type grades
  //     satisfied on the strength of two puzzles built by devices that no longer exist, no builder is
  //     ever invoked for that date again, and the band-5 gap missingDifficulties would report is
  //     never asked about by anything.
  //
  // WHICH IS WHY THE DELETE-AND-REBUILD IS MANDATORY RATHER THAN TIDY. There is no repair path at
  // all: not the nightly, which only touches today and tomorrow; not the request path, which is
  // gated on the same count; not bestEffort, which suppresses an alarm rather than causing an
  // attempt. Roughly 250 dates would serve an old-device clue with a silently absent `explanation`
  // forever, and nothing on the read path throws, logs, 500s or alarms over it -- services/dynamodb.ts
  // casts the stored JSON straight to `Pack` with no schema check and no version field.
  //
  // THE ONE THING THAT LOOKS is scripts/audit-cryptic.ts, which reports a stale count over a window
  // by checking for `explanation`. `npm run audit-cryptic -- <table> --days 40 --no-model` is the
  // runbook's verification step and spends no tokens.
  difficulties: [3, 5],
  secondsPerDifficulty: 30,
  type: 'crypticclue',
}
