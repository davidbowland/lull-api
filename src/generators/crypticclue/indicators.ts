import { CrypticDevice, RemovalKind } from '../../types'

// Hand-authored, lowercase, whitespace-normalized. NOT in src/assets/ -- that directory holds the
// corpus-wide lists every generator reads, and `jest.config.ts` exempts it from coverage with the
// REGEXP `assets/*`, which matches that substring anywhere in a path (src/assets/README.md). An
// asset this repo DERIVES lives under a generator's data/; an asset this repo AUTHORS lives beside
// the code that reads it, which is here.
//
// A closed list is right here for the INVERSE of the reason a derived list is right for the
// membership oracle: a MISSING indicator is a logged rejection -- loud, and it costs one candidate
// out of eight -- while a WRONG indicator is a shipped unsolvable clue, silent, and it costs the
// player the puzzle.
//
// Multi-word entries are matched as token SEQUENCES, never substrings -- the same rule
// assets/blocklist.ts has always used -- so `cut short` matches as two adjacent tokens and SHORTEN
// does not match SHORT.
//
// NO SINGLE-TOKEN ENTRY MAY BE A MEMBER OF CONNECTIVES, and indicators.test.ts asserts it. The two
// sets meet the same token list from opposite sides -- one as a seam, one as a device signal -- and
// an entry on both makes one clue decomposable two ways.
//
// THE LIST GROWS BY READING REJECTION LOGS -- every `no-indicator` line carries the offending token
// and the removal kind it was claimed under. That is a bounded, measurable operation, and it is the
// reason this gate is allowed to be strict.

/**
 * KEYED BY REMOVAL KIND, and that keying is what makes the surface and the mechanism the same
 * puzzle.
 *
 * A clue saying "endless" may not secretly behead. verify.ts requires the CLAIMED `removal`'s own
 * family to contain the indicator, which is the property the old device/predicate pairing gave and
 * the reason this is not one flat set: a shared list would let a single indicator license three
 * different letter operations, and the player who read the indicator correctly would be the one
 * cheated.
 *
 * THE FAMILIES ARE DELIBERATELY DISJOINT, and indicators.test.ts asserts it. An entry appearing
 * under two kinds is an indicator that means two things, which is the same failure from the other
 * direction.
 */
export const deletionIndicators: Record<RemovalKind, ReadonlySet<string>> = {
  first: new Set(['beheaded', 'decapitated', 'headless', 'loses its head', 'topless', 'without a head']),
  last: new Set(['curtailed', 'cut short', 'docked', 'endless', 'shortened', 'unfinished']),
  // ODD-LENGTH SOURCES ONLY, and that is enforced in verify.ts because a Set has nowhere to say it.
  // See RemovalKind in types.ts for the HEARTH -> HEATH/HERTH case that makes an even-length source
  // a player-facing ambiguity rather than a coding inconvenience.
  middle: new Set(['coreless', 'heartless', 'hollow', 'without a heart']),
}

/**
 * The per-device view, which is what verify.ts's step 8 reads.
 *
 * `charade` AND `doubledefinition` ARE DELIBERATELY EMPTY, and that is a property of the devices
 * rather than a gap someone forgot to fill. A charade's parts simply ABUT -- there is no word in the
 * language that says "these two things join, in this order" -- and a double definition is two
 * definitions welded together with nothing at all marking either as wordplay. Both are verified
 * structurally instead, and both therefore reach step 8 with no indicator range to match, which is
 * why that step is SKIPPED for them rather than passed vacuously. A vacuous pass would look like the
 * check ran.
 *
 * Built from `deletionIndicators` rather than restated, so the flattened view cannot drift from the
 * families the verifier actually gates on.
 */
export const crypticIndicators: Record<CrypticDevice, ReadonlySet<string>> = {
  charade: new Set<string>(),
  deletion: new Set(Object.values(deletionIndicators).flatMap((entries) => [...entries])),
  doubledefinition: new Set<string>(),
}

// `tellingIndicators` WAS HERE AND IS DELETED. It listed the indicators whose plain English already
// names their device, and it existed for exactly one caller: a drop rule deciding whether to spend a
// hint on a sentence naming the mechanism. That rule became structural when `deletion` turned out to
// be the WHOLE indicator set -- a rung dropping 100% of the time is a rung the pool pretends to have
// -- and the list survived as the stated REASON for the missing entry.
//
// NOW THERE ARE NO DEVICE RUNGS ON ANY DEVICE, so there is no drop rule left for it to be the reason
// for. A device sentence was the same string on every clue of its device, which makes it a tutorial
// rather than a hint however quiet the indicator: the question the list answered -- "does the clue
// give its own device away?" -- stopped mattering once the answer stopped changing what ships. What
// replaced those rungs is a phrase about a word the clue may not print, and no indicator list bears
// on that.
//
// A list kept for a rule that no longer exists is a list that goes stale silently, which is why this
// is a comment and not a deprecation.
