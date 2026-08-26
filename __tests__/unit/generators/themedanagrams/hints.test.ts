import { MAX_ANAGRAM_RUNG_LENGTH, buildHints } from '@generators/themedanagrams/hints'
import { AnagramEntry } from '@types'
import { containsAnswerToken, passesStringGates } from '@utils/model-output-checks'

// THE WIRE ORDER IS DELIBERATELY NOT LENGTH-SORTED. Ranked, this is COLANDER (8) then TOASTER (7,
// index 2) then SPATULA (7, index 3, tie broken by index) then KETTLE (6, never named) -- so the
// ordinals come out 3rd / 4th / 2nd and no reader can mistake rank for position. A length-sorted
// fixture would make the two look interchangeable and would hide the invariant this file exists to
// pin.
const ENTRIES: AnagramEntry[] = [
  { answer: 'KETTLE', scrambles: ['LTEEKT'] },
  { answer: 'COLANDER', scrambles: ['RNDAELOC'] },
  { answer: 'TOASTER', scrambles: ['ERTOAST'] },
  { answer: 'SPATULA', scrambles: ['ALUTAPS'] },
]

// Shares no token with any answer above, so the "no rung names the theme" row cannot pass by the
// theme happening to be absent for some other reason.
const THEME = 'Kitchen tools'

describe('buildHints', () => {
  it('escalates first letter, bookends, whole answer over three different entries', () => {
    expect(buildHints(ENTRIES)).toStrictEqual([
      {
        metadata: { entryIndex: 2, kind: 'themedanagrams-entry', reveal: 'initial' },
        text: 'The 3rd answer starts with T.',
      },
      {
        metadata: { entryIndex: 3, kind: 'themedanagrams-entry', reveal: 'bookends' },
        text: 'The 4th answer starts with S and ends with A.',
      },
      {
        metadata: { entryIndex: 1, kind: 'themedanagrams-entry', reveal: 'answer' },
        text: 'The 2nd answer is COLANDER.',
      },
    ])
  })

  it('names three different entries and never the shortest', () => {
    const named = buildHints(ENTRIES).map((rung) => rung.metadata.entryIndex)

    expect(new Set(named).size).toEqual(3)
    // KETTLE, at index 0, is the shortest. Spending a rung on the one they most likely already have
    // is spending the ladder on nothing.
    expect(named).not.toContain(0)
  })

  // The tie-break, isolated: TOASTER and SPATULA are both 7, and entry index ascending is what puts
  // TOASTER on rung 1. Without it the ladder depends on sort stability, which no test could pin.
  it('breaks a length tie by entry index ascending', () => {
    const swapped: AnagramEntry[] = [ENTRIES[0], ENTRIES[1], ENTRIES[3], ENTRIES[2]]

    expect(buildHints(swapped)[0].metadata.entryIndex).toEqual(2)
    expect(buildHints(swapped)[0].text).toContain('starts with S')
  })

  // entryIndex IS 0-BASED and the ordinal in `text` is entryIndex + 1. They are the same row
  // expressed two ways, and a client treating the field as 1-based highlights the wrong row while
  // printing the right sentence -- exactly the failure the field exists to prevent.
  it('renders the ordinal as entryIndex + 1 on every rung', () => {
    const ordinals: Record<number, string> = { 0: '1st', 1: '2nd', 2: '3rd', 3: '4th' }

    for (const rung of buildHints(ENTRIES)) {
      expect(rung.text).toContain(`The ${ordinals[rung.metadata.entryIndex]} answer`)
    }
  })

  // THE LEAK CHECK, INVERTED. A gate saying "this must not leak" and a check saying "this must
  // reveal" are the same measurement pointed in opposite directions, and a type that owes a
  // most-revealing rung is entitled to the second one.
  //
  // TEST-ONLY, and that is load-bearing rather than incidental: containsAnswerToken shares a
  // tokenizer with leaksAnswerTokens, whose function-word exemption means a rung reading "The 2nd
  // answer is THOSE." measures FALSE. A runtime throw would kill a correct puzzle over a vacuous
  // measurement; as a test over named fixtures it costs nothing and still catches a buildHints change
  // that stops rung 3 naming a word.
  it('makes rung 3 contain a whole answer token', () => {
    const [, , third] = buildHints(ENTRIES)

    expect(containsAnswerToken(ENTRIES[third.metadata.entryIndex].answer, third.text)).toBe(true)
  })

  it('makes rungs 1 and 2 contain no whole answer token', () => {
    const [first, second] = buildHints(ENTRIES)

    expect(containsAnswerToken(ENTRIES[first.metadata.entryIndex].answer, first.text)).toBe(false)
    expect(containsAnswerToken(ENTRIES[second.metadata.entryIndex].answer, second.text)).toBe(false)
  })

  // A code-authored rung may interpolate only answer substrings and integers. The ENFORCEMENT is the
  // signature -- buildHints is not given the theme, so it cannot reach it -- and this row is the
  // assertion beside it.
  it('names the theme in no rung', () => {
    for (const rung of buildHints(ENTRIES)) {
      expect(rung.text.toUpperCase()).not.toContain('KITCHEN')
      expect(rung.text.toUpperCase()).not.toContain('TOOLS')
      expect(rung.text).not.toContain(THEME)
    }
  })

  // G1, G2 and G3 still apply, because they are about what a client can render rather than about who
  // wrote the string, and endpoints.rest tells every client to render `text` verbatim. The cap is
  // this type's 80, not the 200 sized for model prose.
  it('keeps every rung inside this types own gates, at the longest shape it can compose', () => {
    const longest: AnagramEntry[] = [
      { answer: 'ABCDEFGHI', scrambles: ['IHGFEDCBA'] },
      { answer: 'ABCDEFGH', scrambles: ['HGFEDCBA'] },
      { answer: 'ABCDEFG', scrambles: ['GFEDCBA'] },
      { answer: 'ABCDEF', scrambles: ['FEDCBA'] },
    ]

    for (const rung of buildHints(longest)) {
      expect(passesStringGates({ maxLength: MAX_ANAGRAM_RUNG_LENGTH, value: rung.text })).toBe(true)
    }
  })

  // Metadata is a machine-readable RESTATEMENT of its own rung, never a superset. The letters are
  // already on the wire in entries[entryIndex].answer, and a second copy here could disagree with
  // them.
  it('carries the kind of reveal and never the revealed letters', () => {
    for (const rung of buildHints(ENTRIES)) {
      expect(Object.keys(rung.metadata).sort()).toStrictEqual(['entryIndex', 'kind', 'reveal'])
      expect(rung.metadata.kind).toEqual('themedanagrams-entry')
    }
    expect(buildHints(ENTRIES).map((rung) => rung.metadata.reveal)).toStrictEqual(['initial', 'bookends', 'answer'])
  })
})
