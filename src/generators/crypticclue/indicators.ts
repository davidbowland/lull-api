import { CrypticDevice, RemovalKind } from '../../types'

// Hand-authored, lowercase, whitespace-normalized, and beside the code that reads it rather than
// in src/assets/, which holds corpus-wide lists and is exempted from coverage by `assets/*`.
//
// A closed hand-authored list is right because the failures are asymmetric: a MISSING indicator is
// a logged rejection costing one candidate, where a WRONG one ships an unsolvable clue silently.
// It grows by reading rejection logs -- every `no-indicator` line carries the offending token and
// the removal kind it was claimed under.
//
// Entries are matched as token SEQUENCES, never substrings, so SHORTEN does not match SHORT, and
// no single-token entry may be a member of CONNECTIVES -- an entry on both lists makes one clue
// decomposable two ways. indicators.test.ts asserts that.

/**
 * Keyed by removal kind, so the surface and the mechanism are the same puzzle: verify.ts requires
 * the CLAIMED `removal`'s own family to contain the indicator, so a clue saying "endless" cannot
 * secretly behead. One flat set would let a single indicator license three letter operations. The
 * families are disjoint, asserted by indicators.test.ts.
 */
export const deletionIndicators: Record<RemovalKind, ReadonlySet<string>> = {
  first: new Set(['beheaded', 'decapitated', 'headless', 'loses its head', 'topless', 'without a head']),
  last: new Set(['curtailed', 'cut short', 'docked', 'endless', 'shortened', 'unfinished']),
  // Odd-length sources only, enforced in verify.ts because a Set has nowhere to say it. See
  // RemovalKind in types.ts for the HEARTH -> HEATH/HERTH ambiguity that makes it a rule.
  middle: new Set(['coreless', 'heartless', 'hollow', 'without a heart']),
}

/**
 * The per-device view verify.ts's step 8 reads. `charade` and `doubledefinition` are empty because
 * neither device has an indicator -- a charade's parts simply abut and a double definition marks
 * neither half -- and step 8 is SKIPPED for them rather than passed vacuously against an empty
 * set. Built from `deletionIndicators` so it cannot drift from the families the verifier gates on.
 */
export const crypticIndicators: Record<CrypticDevice, ReadonlySet<string>> = {
  charade: new Set<string>(),
  deletion: new Set(Object.values(deletionIndicators).flatMap((entries) => [...entries])),
  doubledefinition: new Set<string>(),
}
