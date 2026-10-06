import { PackContribution } from '../../types'

// The one PackContribution literal for this type, in a leaf that imports nothing but ../../types, so
// the manifest the request path may read cannot drift from the implementation it may not.
export const cryptogramContribution: PackContribution = {
  // A literal, never read from config.ts: it is the date this TYPE shipped, not the date the
  // stack's floor happens to sit at, and an env var would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog rates Cryptogram at 3-5 minutes; base is the low end and per is (high - low) / 4.
  baseSeconds: 180,
  countPerDay: 1,
  // One sentence-length cipher a day, labeled Tricky.
  difficulties: [4],
  secondsPerDifficulty: 30,
  type: 'cryptogram',
}
