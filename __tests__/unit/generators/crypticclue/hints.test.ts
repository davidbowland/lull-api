import { MAX_CRYPTIC_RUNG_LENGTH, buildHints } from '@generators/crypticclue/hints'
import { VerifiedClue } from '@generators/crypticclue/verify'
import { logError } from '@utils/logging'

jest.mock('@utils/logging')

const verified = (overrides: Partial<VerifiedClue> = {}): VerifiedClue => ({
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  definitionSpan: { end: 5, start: 0 },
  device: 'hidden',
  fodderSpan: { end: 30, start: 16 },
  ...overrides,
})

describe('buildHints', () => {
  it('names the device first, for both devices', () => {
    expect(buildHints(verified())?.[0].text).toEqual(
      "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
    )
    expect(buildHints(verified({ device: 'anagram' }))?.[0].text).toEqual(
      'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
    )
  })

  // Rung 2 quotes the definition SLICED FROM THE CLUE, never a string the model handed over. There
  // is no second copy of the text for a model to make disagree with the first -- which is also why
  // this builder takes a VerifiedClue and not a candidate.
  it('quotes the definition sliced out of the clue', () => {
    expect(buildHints(verified())?.[1].text).toEqual('The definition is "Dance".')
  })

  it('quotes whatever the span points at, so a moved span moves the quotation', () => {
    expect(buildHints(verified({ definitionSpan: { end: 30, start: 16 } }))?.[1].text).toEqual(
      'The definition is "instant angora".',
    )
  })

  it.each([
    ['TANGO', 'Five letters, beginning with T.'],
    ['OBOE', 'Four letters, beginning with O.'],
    ['ELEPHANT', 'Eight letters, beginning with E.'],
  ])('gives %s an integer word', (answer, expected) => {
    expect(buildHints(verified({ answer }))?.[2].text).toEqual(expected)
  })

  // THE THROWING ASSERTION LIVES HERE AND NOT ON THE NIGHTLY PATH. A length outside 4-8 means the
  // shortlist filter is broken, which is a CODE DEFECT -- and a code-defect gate is a
  // logError-with-reason rejection at runtime and a throwing assertion in a test, because there is
  // no seam on the nightly path where a throw stays a throw.
  it.each([4, 5, 6, 7, 8])('has an integer word for every length the shortlist can produce: %s', (length) => {
    expect(buildHints(verified({ answer: 'A'.repeat(length) }))).toBeDefined()
  })

  it('rejects an out-of-band answer at logError rather than throwing', () => {
    expect(buildHints(verified({ answer: 'SUPERCALIFRAGILISTIC' }))).toBeUndefined()
    expect(logError).toHaveBeenCalledWith('Cryptic answer outside the shortlist band', {
      answer: 'SUPERCALIFRAGILISTIC',
      reason: 'answer-not-on-shortlist',
    })
  })

  // HintMetadata gains NO MEMBER from this type: a substring degrades to no highlight, an offset
  // degrades to a WRONG one, and a wrong highlight on a cryptic clue points the player at the wrong
  // half of the puzzle.
  it('carries no metadata on any rung', () => {
    expect(buildHints(verified())?.filter((hint) => 'metadata' in hint)).toStrictEqual([])
  })

  it('builds exactly three rungs', () => {
    expect(buildHints(verified())).toHaveLength(3)
  })

  // The cap CANNOT BIND against a 120-character clue, and it is asserted anyway, because "cannot
  // bind" is a property of today's constants rather than of the code.
  it('composes rungs inside the cryptic rung cap', () => {
    const longest = buildHints(
      verified({ clue: `Dance hidden in ${'a'.repeat(100)}`, definitionSpan: { end: 115, start: 0 } }),
    )

    expect(longest?.every((hint) => hint.text.length <= MAX_CRYPTIC_RUNG_LENGTH)).toBe(true)
  })

  // G4 on the COMPOSED rung. The clue's own pass covers the definition's tokens -- spans hold whole
  // tokens, so they are a subset -- but the composition adds tokens of its own, and this is the row
  // that fails if the gate is dropped for that reason.
  it('rejects a rung whose definition carries a charged word', () => {
    expect(
      buildHints(verified({ clue: 'Bastard hidden in instant angora', definitionSpan: { end: 7, start: 0 } })),
    ).toBeUndefined()
    expect(logError).toHaveBeenCalledWith('A cryptic rung failed the string gates', {
      reason: 'rung-gate',
      texts: expect.any(Array),
    })
  })
})
