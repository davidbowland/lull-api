import { crypticIndicators, deletionIndicators } from '@generators/crypticclue/indicators'
import { CONNECTIVES } from '@generators/crypticclue/verify'
import { CrypticDevice, RemovalKind } from '@types'

const REMOVAL_KINDS: RemovalKind[] = ['first', 'last', 'middle']
const INDICATORLESS_DEVICES: CrypticDevice[] = ['charade', 'doubledefinition']

// Flattened once. `Object.values` over a Record is total on the union, so a fourth removal kind
// arrives here without an edit -- which is what lets the disjointness and equality rows below stay
// true rather than merely passing today.
const allDeletionEntries = Object.values(deletionIndicators).flatMap((entries) => [...entries])

describe('deletionIndicators', () => {
  it.each(REMOVAL_KINDS)('carries at least one indicator for removal kind %s', (kind) => {
    expect(deletionIndicators[kind].size).toBeGreaterThan(0)
  })

  // An entry under two kinds is an indicator that means two things, which is the same failure the
  // per-family keying exists to prevent, arriving from the other direction.
  it('never lists one indicator under two removal kinds', () => {
    expect(new Set(allDeletionEntries).size).toEqual(allDeletionEntries.length)
  })

  it.each(REMOVAL_KINDS)('holds lowercase whitespace-normalized entries for %s', (kind) => {
    const malformed = [...deletionIndicators[kind]].filter(
      (entry) => entry !== entry.toLowerCase().trim() || entry.includes('  '),
    )
    expect(malformed).toEqual([])
  })
})

describe('crypticIndicators', () => {
  // Equality rather than containment, in both directions: a family the flattened view forgot is an
  // indicator the verifier gates on and the prompt never offers, and an extra entry here is one the
  // prompt offers and the verifier rejects.
  it('exposes exactly the deletion families as the deletion device list', () => {
    expect([...crypticIndicators.deletion].sort()).toEqual([...allDeletionEntries].sort())
  })

  it.each(INDICATORLESS_DEVICES)('gives %s no indicators at all', (device) => {
    expect(crypticIndicators[device].size).toEqual(0)
  })

  // The two sets meet the same token list from opposite sides. An entry on both makes one clue
  // decomposable two ways -- a seam token that is also a device signal.
  it('keeps every single-token indicator out of CONNECTIVES', () => {
    const collisions = allDeletionEntries.filter(
      (entry) => !entry.includes(' ') && CONNECTIVES.has(entry.toUpperCase()),
    )
    expect(collisions).toEqual([])
  })
})
