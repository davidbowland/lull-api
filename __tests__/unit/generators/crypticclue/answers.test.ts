import { normalizeAnswer } from '@rules/normalize-answer'

import { nouns } from '../../../../src/assets/nouns'
import { SHORTLIST_SIZE, drawAnswers } from '@generators/crypticclue/answers'
import { chargedTerms } from '@utils/charged-terms'

describe('drawAnswers', () => {
  // A COUNTER, not Math.random. CLAUDE.md forbids a live random source in a test body, and a fixed
  // sequence is what makes the sample assertions reproducible.
  const sequence = (values: number[]): (() => number) => {
    let index = 0
    return () => values[index++ % values.length]
  }

  it('draws the shortlist size by default', () => {
    expect(drawAnswers(new Set(), undefined, sequence([0])).size).toEqual(SHORTLIST_SIZE)
  })

  it('draws only 4-8 letter words', () => {
    const drawn = [...drawAnswers(new Set(), SHORTLIST_SIZE, sequence([0, 0.3, 0.6, 0.9])).values()]

    expect(drawn.filter((word) => word.length < 4 || word.length > 8)).toStrictEqual([])
  })

  // Both halves matter. The KEY is what verifyClue's round-trip looks the model's string up by; the
  // VALUE is the spelling that becomes data.answer, and it is uppercase because the two letter rungs read its
  // first letter and nouns.ts entries are lowercase lemmas.
  it('keys on normalizeAnswer and holds the supplied spelling, uppercased', () => {
    const drawn = drawAnswers(new Set(), 5, sequence([0]))

    expect([...drawn.entries()].filter(([key, value]) => key !== normalizeAnswer(value))).toStrictEqual([])
    expect([...drawn.values()].filter((word) => word !== word.toUpperCase())).toStrictEqual([])
  })

  // ONE STRUCTURE, because verifyClue's round-trip and the answer lookup are the same question asked
  // twice: the map this returns is the map that function takes.
  it('returns a single-token answer for every entry, which is what the enumeration stands on', () => {
    const drawn = [...drawAnswers(new Set(), 200, sequence([0.2, 0.5, 0.8])).values()]

    expect(drawn.filter((word) => word.split(' ').length !== 1)).toStrictEqual([])
  })

  it('drops an excluded answer, matched through normalizeAnswer', () => {
    const all = drawAnswers(new Set(), 1_000, sequence([0]))
    const first = [...all.keys()][0]

    expect(drawAnswers(new Set([first]), 1_000, sequence([0])).has(first)).toBe(false)
  })

  it('drops a charged word', () => {
    const drawn = drawAnswers(new Set(), 2_000, sequence([0]))

    expect([...drawn.values()].filter((word) => chargedTerms.has(word))).toStrictEqual([])
  })

  it('is deterministic under an injected random', () => {
    const draw = () => [...drawAnswers(new Set(), 10, sequence([0.1, 0.4, 0.7])).values()]

    expect(draw()).toStrictEqual(draw())
  })

  // MEMBERSHIP IS NOT GETTABILITY. The source is nouns.ts -- concreteness-filtered lemmas a player
  // knows -- and never the membership oracle, which admits AALII and ZORIL as cryptic answers. This
  // row is what would go red if someone pointed drawAnswers at data/known-words.ts.
  it('draws only from the source corpus', () => {
    const source = new Set(nouns.map((word) => word.toUpperCase()))
    const drawn = [...drawAnswers(new Set(), 200, sequence([0.15, 0.45, 0.75])).values()]

    expect(drawn.filter((word) => !source.has(word))).toStrictEqual([])
  })
})
