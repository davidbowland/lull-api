import { applyRemoval, foldWithOffsets } from '@generators/crypticclue/verify'

// THE PURE LETTER MACHINERY, and it is all that is left in this file.
//
// It held `devicePredicates` -- one function per device, taking the raw fodder slice and the answer.
// Those died with `hidden` and `anagram`, and they died BECAUSE they were decidable from the fodder
// alone: a predicate that can answer "is this the puzzle" without the definition is the property the
// player reported as "it doesn't even need the clue". The three devices that replaced them have no
// such predicate, and that is the point rather than a gap. What CAN be decided here is the letter
// operation a deletion performs, which is one function, and the fold every span in this type is taken
// through.
describe('foldWithOffsets', () => {
  // THE property: every offset it returns indexes the raw character it folded. This is what makes
  // the coordinate systems safe to mix -- the first version indexed a raw slice with an offset taken
  // from a normalized one, and no such offset existed.
  it.each(['instant angora', 'a b c', 'Dance', 'Floor covering from vehicle with animal'])(
    'indexes what it folded: %s',
    (raw) => {
      const { folded, rawAt } = foldWithOffsets(raw)

      expect(rawAt).toHaveLength(folded.length)
      expect(rawAt.map((offset) => raw[offset].toUpperCase()).join('')).toEqual(folded)
    },
  )

  // And it agrees with the fold every other part of this repo uses. normalizeAnswer is what the
  // player's typing is judged by, so a fold that disagreed with it would prove the wrong thing.
  it.each(['instant angora', 'Floor covering from vehicle with animal'])('agrees with normalizeAnswer on %s', (raw) => {
    expect(foldWithOffsets(raw).folded).toEqual(raw.toUpperCase().replace(/[^A-Z]/g, ''))
  })
})

describe('applyRemoval', () => {
  it.each([
    ['last', 'BRANDY', 'BRAND'],
    ['first', 'HEARTH', 'EARTH'],
    ['middle', 'CHEAP', 'CHAP'],
  ] as const)('removes the %s letter of %s', (removal, source, expected) => {
    expect(applyRemoval(source, removal)).toEqual(expected)
  })

  // THE ONE REFUSAL. HEARTH is six letters, so "heartless" could give HERTH or HEATH, and HEATH is a
  // real word -- two defensible readings, one of them a valid answer, and no convention picks between
  // them. The ambiguity is the PLAYER'S, so the code refuses rather than resolving it.
  it.each(['HEARTH', 'BRANDY', 'AN'])('refuses a middle removal on the even-length %s', (source) => {
    expect(applyRemoval(source, 'middle')).toBeUndefined()
  })

  // It reads letters and nothing else, so a model that submits its source in lowercase or with an
  // apostrophe gets the same answer the derivation would get from a clean one. The clue's charset
  // never applies here: `source.text` is not in the clue.
  it.each([
    ['brandy', 'BRAND'],
    ["Brand'y", 'BRAND'],
  ])('normalizes %s before removing', (source, expected) => {
    expect(applyRemoval(source, 'last')).toEqual(expected)
  })

  // EMPTINESS IS NOT AN AMBIGUITY, so it is not a refusal. A source too short to survive its own
  // removal returns the empty string and the caller's comparison against a four- to eight-letter
  // answer rejects it, which keeps this function a pure letter operation with exactly one undefined.
  it.each([
    ['first', ''],
    ['last', ''],
    ['middle', ''],
  ] as const)('returns the empty string rather than undefined for a %s removal on one letter', (removal, expected) => {
    expect(applyRemoval('A', removal)).toEqual(expected)
  })
})
