import { CONNECTIVES, MAX_CLUE_LENGTH, REJECTION_REASONS, tokensOf, verifyClue } from '@generators/crypticclue/verify'

jest.mock('@utils/logging')

// The shortlist map every row is verified against. `answers` is keyed by normalizeAnswer and maps to
// the CODE-SUPPLIED spelling, which is the string that reaches VerifiedClue.answer.
const answers = new Map([['TANGO', 'TANGO']])

// A fixture membership oracle. The real one is a derived slice of the pinned lexicon; verifyClue
// takes isKnownWord as a PARAMETER precisely so this file never has to load it. `angorax` and
// `zqxjangora` are deliberately ABSENT -- that absence is a row's whole mechanism.
const known = new Set(['a', 'an', 'angora', 'dance', 'got', 'hats', 'instant', 'is', 'tangoing', 'tangos'])
const isKnownWord = (word: string): boolean => known.has(word)

// The legal shape every table below mutates one field of.
const candidate = (overrides: Record<string, unknown> = {}) => ({
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  definition: 'Dance',
  device: 'hidden',
  fodder: 'instant angora',
  indicator: 'hidden in',
  ...overrides,
})

const verify = (overrides: Record<string, unknown> = {}, onReject = jest.fn()) => ({
  onReject,
  result: verifyClue(candidate(overrides), answers, isKnownWord, onReject),
})

// Steps 0 and 1. Every row names the code it must fire, never merely `undefined`.
const SHAPE_ROWS = [
  { overrides: { definition: '' }, reason: 'malformed-item' },
  { overrides: { definition: ' Dance' }, reason: 'malformed-item' },
  { overrides: { device: 5 }, reason: 'malformed-item' },
  { overrides: { indicator: undefined }, reason: 'malformed-item' },
  // A trailing space is what the anchored charset DOES admit, and step 0's trim equality is what
  // rejects it. It fires as malformed-item rather than malformed-clue because step 0 runs first, and
  // a shape failure belongs at the shape step.
  { overrides: { clue: 'Dance hidden in instant angora ' }, reason: 'malformed-item' },
  { overrides: { clue: 'Dance hidden  in instant angora' }, reason: 'malformed-clue' },
  // A6. UNDECIDABLE before the charset narrowed: a whitespace split rejects the comma and the
  // repo's letter-run tokenizer yields zero tokens for it and accepts. The character is now gone.
  { overrides: { clue: 'Dance hidden in instant angora ,' }, reason: 'charset' },
  { overrides: { clue: 'Dansé hidden in instant angora' }, reason: 'charset' },
  // The enumeration is its own field. A clue carrying (5) is a model putting presentation into
  // content, and every character the cover tolerates is a character a model can hide content in.
  { overrides: { clue: 'Dance hidden in instant angora (5)' }, reason: 'charset' },
  { overrides: { clue: `Dance hidden in ${'a'.repeat(MAX_CLUE_LENGTH)}` }, reason: 'too-long' },
]

// Steps 2 and 3.
const ANSWER_ROWS = [
  { overrides: { answer: 'WALTZ' }, reason: 'answer-not-on-shortlist' },
  { overrides: { answer: 'TANGOS' }, reason: 'answer-not-on-shortlist' },
  { overrides: { device: 'charade' }, reason: 'unknown-device' },
  { overrides: { device: 'Hidden' }, reason: 'unknown-device' },
  {
    overrides: { clue: 'A slow and stately dance hidden in instant angora', definition: 'A slow and stately dance' },
    reason: 'definition-too-long',
  },
]

// Steps 4 and 5. A9, A10, A11.
const SPAN_ROWS = [
  // Zero occurrences.
  { overrides: { definition: 'Waltz' }, reason: 'no-unique-span' },
  // Zero occurrences, because a part is located as a TOKEN SEQUENCE and `stant` is not a token of
  // this clue -- it is a substring of one. THIS ROW IS WHAT RETIRES `not-word-aligned`: the
  // alignment is structural, so the code has no clause and the closed set has no entry.
  { overrides: { fodder: 'stant angora' }, reason: 'no-unique-span' },
  // Two occurrences.
  {
    overrides: { clue: 'Dance hidden in instant angora hidden in', indicator: 'hidden in' },
    reason: 'no-unique-span',
  },
  // Overlapping: the indicator's second token IS the definition's only token.
  { overrides: { definition: 'in', indicator: 'hidden in' }, reason: 'overlapping-spans' },
]

// Step 6 -- the cover. A1, A2, A3, A12, A17, A18.
const COVER_ROWS = [
  // A1. Unbounded residue BEFORE the first span. Every residue token is a connective and both
  // bounded gaps are 0, so this ACCEPTED before the partition rewrite.
  {
    overrides: { clue: 'A the in of from by to gives Dance hidden in instant angora' },
    reason: 'residue-out-of-position',
  },
  // A2. The same, at the other end. Also ACCEPTED before the rewrite.
  { overrides: { clue: 'Dance hidden in instant angora of the by from' }, reason: 'residue-out-of-position' },
  // A3. ONE trailing connective, in no capped gap -- the sharpest form of the finding: the leak did
  // not need a preamble, it needed one token.
  { overrides: { clue: 'Dance hidden in instant angora with' }, reason: 'residue-out-of-position' },
  // A12. The definition in the middle.
  {
    overrides: { clue: 'Hidden in dance instant angora', definition: 'dance', indicator: 'Hidden in' },
    reason: 'definition-not-at-end',
  },
  // A17. TWO seam tokens between the definition and the wordplay.
  { overrides: { clue: 'Dance is of hidden in instant angora' }, reason: 'not-adjacent' },
  // A18. A seam token that is not a connective.
  { overrides: { clue: 'Dance quickly hidden in instant angora' }, reason: 'uncovered-token' },
]

// Steps 7 and 8. A4, A13.
const DEVICE_SIGNAL_ROWS = [
  // A4. definition="The" cleared TWELVE STEPS OUT OF TWELVE before this floor existed.
  { overrides: { clue: 'The hidden in instant angora', definition: 'The' }, reason: 'definition-not-substantive' },
  // A definition made only of an indicator word is equally empty. `inside` is a single-token entry
  // of the hidden list, so it is filtered by the floor's second half rather than by CONNECTIVES.
  {
    overrides: { clue: 'Inside hidden in instant angora', definition: 'Inside' },
    reason: 'definition-not-substantive',
  },
  // A13. An anagram whose indicator is not on the committed list.
  {
    overrides: { clue: 'Dance beautifully got an', device: 'anagram', fodder: 'got an', indicator: 'beautifully' },
    reason: 'no-indicator',
  },
  // The recall cost, priced and asserted: a bare `in` is not an indicator, because the single-token
  // entries were struck from the hidden list.
  { overrides: { clue: 'Dance in instant angora', indicator: 'in' }, reason: 'no-indicator' },
]

// Step 10. A5, A7, A8.
const DERIVATION_ROWS = [
  // A5. UNDECIDABLE before the index map existed: one reading of the word-break clause accepts TANGO
  // inside TANGOS, which is the exact case the clause exists to exclude.
  { overrides: { clue: 'Dance hidden in tangos', fodder: 'tangos' }, reason: 'derivation-failed' },
  // A7. Residue relocated INSIDE a span, where the cover cannot see it. ACCEPTED before the
  // fodder-boundary clauses, because the run still has padding on both sides.
  {
    overrides: { clue: 'Dance hidden in instant angora of the', fodder: 'instant angora of the' },
    reason: 'derivation-failed',
  },
  // A8. The run starts at the first character of the first fodder token.
  { overrides: { clue: 'Dance hidden in tangoing hats', fodder: 'tangoing hats' }, reason: 'derivation-failed' },
  // The anagram half, through the same code.
  {
    overrides: { clue: 'Dance shaken got at', device: 'anagram', fodder: 'got at', indicator: 'shaken' },
    reason: 'derivation-failed',
  },
]

// Steps 11 and 12. A16.
const LEAK_ROWS = [
  // A16. ACCEPTED before crypticInflections: containsAnswerToken has no stemming, so a clue that
  // hands the player TANGOS passed a check named for exactly that failure.
  {
    overrides: {
      clue: 'Dances tangos hidden in instant angora',
      definition: 'Dances tangos',
      fodder: 'instant angora',
      indicator: 'hidden in',
    },
    reason: 'answer-token',
  },
  // The unstemmed case the gate always caught, kept so the inflection set is not the only cover.
  { overrides: { clue: 'Tango hidden in instant angora', definition: 'Tango' }, reason: 'answer-token' },
  // Step 12. `angorax` derives TANGO perfectly and is not a word in any oracle, which is the point:
  // the row has to CLEAR step 10 to reach step 12 at all.
  {
    overrides: { clue: 'Dance hidden in instant angorax', fodder: 'instant angorax' },
    reason: 'unknown-fodder-word',
  },
]

const ALL_ROWS = [
  ...SHAPE_ROWS,
  ...ANSWER_ROWS,
  ...SPAN_ROWS,
  ...COVER_ROWS,
  ...DEVICE_SIGNAL_ROWS,
  ...DERIVATION_ROWS,
  ...LEAK_ROWS,
]

// THE FIVE LEGAL SHAPES. Without these the adversarial table is satisfied by a verifier that rejects
// everything, and the type generates nothing on its first night. Each is chosen so that exactly one
// seam token, a definition of at most four tokens with a substantive one, and a list-member
// indicator are present; a reworded surface silently stops testing the shape it is named for.
const ACCEPTED_SHAPES = [
  {
    answer: 'TANGO',
    clue: 'Dance hidden in instant angora',
    definition: 'Dance',
    device: 'hidden',
    fodder: 'instant angora',
    indicator: 'hidden in',
    shape: 'hidden, definition first, no seam',
  },
  {
    answer: 'TANGO',
    clue: 'Hidden in instant angora is a dance',
    definition: 'a dance',
    device: 'hidden',
    fodder: 'instant angora',
    indicator: 'Hidden in',
    shape: 'hidden, definition last, one seam',
  },
  {
    answer: 'TANGO',
    clue: 'Dance shaken got an',
    definition: 'Dance',
    device: 'anagram',
    fodder: 'got an',
    indicator: 'shaken',
    shape: 'anagram, definition first',
  },
  {
    answer: 'TANGO',
    clue: 'Got an shaken to a dance',
    definition: 'a dance',
    device: 'anagram',
    fodder: 'Got an',
    indicator: 'shaken',
    shape: 'anagram, definition last, a TO seam',
  },
  {
    answer: 'TANGO',
    clue: 'Dance shaken by got an',
    definition: 'Dance',
    device: 'anagram',
    fodder: 'got an',
    indicator: 'shaken',
    shape: 'anagram, fodder after the indicator across a BY seam',
  },
]

describe('verifyClue', () => {
  it.each(ALL_ROWS)('rejects with $reason', ({ overrides, reason }) => {
    const { onReject, result } = verify(overrides)

    expect(result).toBeUndefined()
    expect(onReject).toHaveBeenCalledWith(reason, expect.any(Object))
  })

  // A15. `"abc".indexOf("")` is 0 and `lastIndexOf("")` is 3, so an empty part used to fail the
  // UNIQUENESS clause rather than the shape clause -- and a one-character clue would have flipped
  // even that. It now fails at step 0, naming the field.
  it('rejects an empty part at step 0 rather than by accident downstream', () => {
    const { onReject } = verify({ definition: '' })

    expect(onReject).toHaveBeenCalledWith('malformed-item', { field: 'definition' })
  })

  // The round-trip is case- and punctuation-insensitive on the way in, and the SUPPLIED SPELLING is
  // what survives. Both halves matter: the first is why a model that shouts its answer is not
  // punished, the second is why a two-token "tan go" cannot reach the enumeration.
  it('accepts a differently-spelled key and keeps the supplied spelling', () => {
    const supplied = new Map([['TANGO', 'TANGO']])
    const onReject = jest.fn()

    const verified = verifyClue(candidate({ answer: 'Tango!' }), supplied, isKnownWord, onReject)

    expect(onReject).not.toHaveBeenCalled()
    expect(verified?.answer).toEqual('TANGO')
  })

  it('allows a four-token definition', () => {
    const onReject = jest.fn()

    verifyClue(
      candidate({ clue: 'A slow stately dance hidden in instant angora', definition: 'A slow stately dance' }),
      answers,
      isKnownWord,
      onReject,
    )

    expect(onReject).not.toHaveBeenCalledWith('definition-too-long', expect.any(Object))
  })

  // THE CLOSED SET, asserted as an EQUALITY so it fails in BOTH directions: a code with no row, or a
  // row naming a code that is not declared. An omission-shaped assertion would fail in only one.
  it('exercises exactly the declared rejection reasons', () => {
    const exercised = [...new Set(ALL_ROWS.map((row) => row.reason))].sort()

    expect(exercised).toStrictEqual([...REJECTION_REASONS].sort())
  })
})

describe('the legal shapes', () => {
  it.each(ACCEPTED_SHAPES)('accepts $shape', ({ shape: _shape, ...item }) => {
    const onReject = jest.fn()

    const verified = verifyClue(item, answers, isKnownWord, onReject)

    expect(onReject).not.toHaveBeenCalled()
    expect(verified).toEqual({
      answer: 'TANGO',
      clue: item.clue,
      definitionSpan: expect.any(Object),
      device: item.device,
      fodderSpan: expect.any(Object),
    })
  })

  // The spans index the CLUE, and the slice is what rung 2 quotes and what the board highlights.
  it.each(ACCEPTED_SHAPES)('returns spans that slice back to the parts of $shape', ({ shape: _shape, ...item }) => {
    const verified = verifyClue(item, answers, isKnownWord)

    expect(verified?.clue.slice(verified.definitionSpan.start, verified.definitionSpan.end)).toEqual(item.definition)
    expect(verified?.clue.slice(verified.fodderSpan.start, verified.fodderSpan.end)).toEqual(item.fodder)
  })
})

describe('the clue charset makes one tokenizer answer every question', () => {
  // Byte-for-byte the tokenizer in src/utils/model-output-checks.ts, which is module-private there
  // and must stay so. The property is that on any string CLEARING STEP 1, this, a whitespace split
  // and tokensOf all agree; the control below is what stops the assertion being vacuous.
  const letterRuns = (text: string): string[] => text.toUpperCase().match(/[A-Z0-9]+/g) ?? []

  it.each(['Dance hidden in instant angora', 'A', 'Hidden in instant angora is a dance', 'Dance shaken got an'])(
    'agrees with a whitespace split on %s',
    (clue) => {
      expect(tokensOf(clue).map((token) => token.folded)).toStrictEqual(letterRuns(clue))
      expect(tokensOf(clue).map((token) => token.folded)).toStrictEqual(clue.toUpperCase().split(' '))
    },
  )

  // THE CONTROL. On a string step 1 rejects, the two tokenizers DISAGREE -- which is the whole
  // reason `,` `'` and `-` are struck from the charset. Without this row the property above would
  // pass just as happily for a charset that admits them.
  it('disagrees on a string the charset excludes, which is why the charset excludes it', () => {
    expect(letterRuns('Dance ,')).toStrictEqual(['DANCE'])
    expect('Dance ,'.toUpperCase().split(' ')).toStrictEqual(['DANCE', ','])
  })

  it('records the raw offsets each token was folded from', () => {
    expect(tokensOf('Dance hidden in')).toStrictEqual([
      { end: 5, folded: 'DANCE', start: 0 },
      { end: 12, folded: 'HIDDEN', start: 6 },
      { end: 15, folded: 'IN', start: 13 },
    ])
  })
})

describe('CONNECTIVES', () => {
  it('holds the thirteen committed tokens, uppercase', () => {
    expect([...CONNECTIVES].sort()).toStrictEqual(
      ['A', 'AN', 'BY', 'FOR', 'FROM', 'GIVES', 'IN', 'IS', 'MAKES', 'OF', 'THE', 'TO', 'WITH'].sort(),
    )
  })
})
