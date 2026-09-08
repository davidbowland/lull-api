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

/**
 * The subset of crypticIndicators whose PLAIN ENGLISH ALREADY NAMES THE DEVICE, so a device rung
 * over one of them is a restatement rather than a hint.
 *
 * NOTHING IN src/ READS IT, and that is the drop rule having become STRUCTURAL rather than the list
 * having stopped mattering. hints.ts used to evaluate this per clue and pull the pool up one; because
 * `deletion` turned out to be the WHOLE set (below), the rung dropped on every deletion clue without
 * exception, so the deletion pool simply has no device rung to drop -- see DEVICE_RUNGS in hints.ts,
 * which states that a rung declared with a drop rule firing 100% of the time is a rung the pool
 * pretends to have. The list is still the REASON that entry is absent, and indicators.test.ts plus
 * hints.test.ts are what hold the two in step: a quiet deletion indicator added here would mean
 * hints.ts owes a `deletion` entry, and the tests are what say so.
 *
 * `deletion` IS THE WHOLE SET, and that is the honest reading rather than a shortcut taken to avoid
 * curating a subset. Every deletion indicator names its own operation -- `endless`, `beheaded`,
 * `heartless` each say what to do to the letters -- so "the wordplay is a deletion" hands back a
 * word already on the player's screen. There is no quiet deletion indicator the way `shaken` was
 * quiet for anagrams: an indicator that did not announce the operation would leave the player unable
 * to perform it, since nothing else in the clue says which letter goes.
 *
 * THE COST IS ONE RUNG AND NEVER THE PUZZLE. The clue ships normally, and the deletion pool's other
 * four entries carry the ladder to three rungs in three of its four shapes. There is no appended
 * floor doing that backfilling: hints.ts ranks the `begins with` rung as a POOL ENTRY, third of four
 * on this device, for reasons its own comment gives.
 *
 * The other two devices are empty because they have NO INDICATORS AT ALL, so there is nothing that
 * could be telling. Their device rungs therefore NEVER drop, which is the right outcome rather than
 * a happy accident: with no indicator on the page, naming the mechanism is the most useful
 * structural thing this type can say, and for a double definition -- where recognizing the device is
 * most of the solve -- it is the single most valuable rung in the pool.
 *
 * A SUBSET, and indicators.test.ts asserts it: an entry here that is not an indicator for its device
 * is a rung dropped over a token the verifier would never admit, which fails silently and forever.
 */
export const tellingIndicators: Record<CrypticDevice, ReadonlySet<string>> = {
  charade: new Set<string>(),
  deletion: crypticIndicators.deletion,
  doubledefinition: new Set<string>(),
}
