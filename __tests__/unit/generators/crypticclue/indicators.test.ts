import { crypticIndicators } from '@generators/crypticclue/indicators'
import { CONNECTIVES, CRYPTIC_DEVICES } from '@generators/crypticclue/verify'
import { chargedTerms } from '@utils/charged-terms'

describe('crypticIndicators', () => {
  it('covers every device, exhaustively', () => {
    expect(Object.keys(crypticIndicators).sort()).toStrictEqual([...CRYPTIC_DEVICES].sort())
  })

  // THE invariant. The two sets meet the same token list from opposite sides -- one as a seam, one
  // as a device signal -- and an entry on both makes the same clue decomposable two ways. Bare `in`
  // is what this struck.
  it('puts no single-token indicator on the connective list', () => {
    const singles = [...crypticIndicators.hidden, ...crypticIndicators.anagram].filter((entry) => !entry.includes(' '))
    const connectives = new Set([...CONNECTIVES].map((connective) => connective.toLowerCase()))

    expect(singles.filter((entry) => connectives.has(entry))).toStrictEqual([])
  })

  it.each(['anagram', 'hidden'] as const)('keeps %s entries lowercase and single-spaced', (device) => {
    const entries = [...crypticIndicators[device]]

    expect(entries.filter((entry) => entry !== entry.trim().toLowerCase().replace(/\s+/g, ' '))).toStrictEqual([])
    expect(entries.filter((entry) => !/^[a-z]+(?: [a-z]+)*$/.test(entry))).toStrictEqual([])
  })

  // These lists go into the prompt VERBATIM, so they are model-visible content of this repo's own
  // authorship. Nothing else gates them -- the clue's own G4 pass runs over the clue, not over the
  // list handed to the model -- so the gate is here.
  it.each(['anagram', 'hidden'] as const)('carries no charged term on the %s list', (device) => {
    const entries = [...crypticIndicators[device]].flatMap((entry) => entry.toUpperCase().split(' '))

    expect(entries.filter((token) => chargedTerms.has(token))).toStrictEqual([])
  })

  // The seed list, pinned. Sixteen for `hidden` against roughly sixty for `anagram`, the asymmetry
  // reflecting that real anagram indicators are open-ended by design while containment indicators
  // are a short closed family.
  it('carries the committed hidden seed list', () => {
    expect([...crypticIndicators.hidden].sort()).toStrictEqual(
      [
        'amid',
        'among',
        'buried',
        'concealed',
        'contains',
        'covers',
        'found in',
        'held by',
        'hidden',
        'hidden in',
        'hiding',
        'holds',
        'inside',
        'part of',
        'some of',
        'within',
      ].sort(),
    )
  })

  it('carries an anagram list wide enough to be worth handing to the model', () => {
    expect(crypticIndicators.anagram.size).toBeGreaterThanOrEqual(50)
  })

  // The two lists must stay disjoint from each other as well: an entry on both would let a clue
  // claim either device over the same signal, which is the surface lying about its own mechanism.
  it('shares no entry between the two devices', () => {
    expect([...crypticIndicators.hidden].filter((entry) => crypticIndicators.anagram.has(entry))).toStrictEqual([])
  })
})
