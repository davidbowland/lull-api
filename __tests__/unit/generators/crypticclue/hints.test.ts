import { MAX_ANSWER_LENGTH, MIN_ANSWER_LENGTH } from '@generators/crypticclue/answers'
import {
  MAX_CRYPTIC_RUNG_LENGTH,
  MAX_GLOSS_LENGTH,
  MAX_HINT_RUNGS,
  MAX_WORD_GLOSS_LENGTH,
  buildHints,
  gatedGloss,
  gatedWordGloss,
  isComposedRung,
} from '@generators/crypticclue/hints'
import {
  VerifiedCharade,
  VerifiedClue,
  VerifiedDeletion,
  VerifiedDoubleDefinition,
} from '@generators/crypticclue/verify'
import { log, logError } from '@utils/logging'

jest.mock('@utils/logging')

// One clue per device; the first describe block slices every span and asserts what it points at.
const CHARADE_CLUE = 'Vehicle with animal makes floor covering'
const DELETION_CLUE = 'Endless spirit leaves a mark'
const DOUBLE_CLUE = 'Departed still remaining'

// Every rung the three pools can compose, named once so a reworded template fails in one place.
const FIRST_PART = 'The first part is CAR.'
const ALL_PARTS = 'The answer is CAR + PET.'
const SOURCE = 'The wordplay starts from BRANDY.'
// No third letter rung: the charade pool has none, its first-part rung already spelling that letter.
const BRAND_LETTER = 'The answer begins with B.'
const LEFT_LETTER = 'The answer begins with L.'

// One gloss per device, each clearing every gatedGloss row against its own definition and answer.
const CHARADE_GLOSS = 'It lies underfoot in most sitting rooms.'
const DELETION_GLOSS = 'A hot iron leaves this on cattle.'
const DOUBLE_GLOSS = 'The opposite of right on a compass.'

// The model's phrase and the rung code frames from it: the gate runs over the first, tables assert the second.
const CHARADE_WORD_GLOSS = 'a thing driven on roads'
const DELETION_WORD_GLOSS = 'a strong drink'
const DOUBLE_WORD_GLOSS = 'a political leaning'
const CHARADE_WORD = `The first part is ${CHARADE_WORD_GLOSS}.`
const DELETION_WORD = `The longer word is ${DELETION_WORD_GLOSS}.`
const DOUBLE_WORD = `The answer also means ${DOUBLE_WORD_GLOSS}.`

// CAR + PET, definition "floor covering"; neither part appears in the clue, which the word gloss rung needs.
const charade = (overrides: Partial<VerifiedCharade> = {}): VerifiedCharade => ({
  answer: 'CARPET',
  clue: CHARADE_CLUE,
  definitionSpan: { end: 40, start: 26 },
  device: 'charade',
  parts: [
    { cueSpan: { end: 7, start: 0 }, text: 'CAR' },
    { cueSpan: { end: 19, start: 13 }, text: 'PET' },
  ],
  ...overrides,
})

// BRANDY minus its last letter, and not in the clue. `indicatorSpan` is supplied because the type owes it.
const deletion = (overrides: Partial<VerifiedDeletion> = {}): VerifiedDeletion => ({
  answer: 'BRAND',
  clue: DELETION_CLUE,
  definitionSpan: { end: 28, start: 22 },
  device: 'deletion',
  indicatorSpan: { end: 7, start: 0 },
  removal: 'last',
  source: { cueSpan: { end: 14, start: 8 }, text: 'BRANDY' },
  ...overrides,
})

// `Departed still remaining` -- both halves define LEFT, and neither is "the" definition.
const doubleDefinition = (overrides: Partial<VerifiedDoubleDefinition> = {}): VerifiedDoubleDefinition => ({
  answer: 'LEFT',
  clue: DOUBLE_CLUE,
  definitionSpans: [
    { end: 8, start: 0 },
    { end: 24, start: 9 },
  ],
  device: 'doubledefinition',
  gloss: undefined,
  ...overrides,
})

const texts = (clue: VerifiedClue): string[] | undefined => buildHints(clue)?.map((hint) => hint.text)

// Every ladder shape the three pools can emit, so the cross-cutting rows below run over all twelve.
const EVERY_SHAPE: [string, VerifiedClue][] = [
  ['charade, both model rungs survive', charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS })],
  ['charade, the word gloss drops', charade({ gloss: CHARADE_GLOSS })],
  ['charade, the gloss drops', charade({ wordGloss: CHARADE_WORD_GLOSS })],
  ['charade, both drop', charade()],
  ['deletion, both model rungs survive', deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS })],
  ['deletion, the word gloss drops', deletion({ gloss: DELETION_GLOSS })],
  ['deletion, the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS })],
  ['deletion, both drop', deletion()],
  [
    'doubledefinition, both model rungs survive',
    doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss: DOUBLE_WORD_GLOSS }),
  ],
  ['doubledefinition, the word gloss drops', doubleDefinition({ gloss: DOUBLE_GLOSS })],
  ['doubledefinition, the gloss drops', doubleDefinition({ wordGloss: DOUBLE_WORD_GLOSS })],
  ['doubledefinition, both drop', doubleDefinition()],
]

describe('the fixtures', () => {
  // An off-by-one span would make every row below assert against a different clue, and none would fail.
  it.each([
    ['the charade definition', CHARADE_CLUE, charade().definitionSpan, 'floor covering'],
    ['the charade first cue', CHARADE_CLUE, charade().parts[0].cueSpan, 'Vehicle'],
    ['the charade second cue', CHARADE_CLUE, charade().parts[1].cueSpan, 'animal'],
    ['the deletion definition', DELETION_CLUE, deletion().definitionSpan, 'a mark'],
    ['the deletion indicator', DELETION_CLUE, deletion().indicatorSpan, 'Endless'],
    ['the deletion source cue', DELETION_CLUE, deletion().source.cueSpan, 'spirit'],
    ['the first half of the double definition', DOUBLE_CLUE, doubleDefinition().definitionSpans[0], 'Departed'],
    ['the second half of the double definition', DOUBLE_CLUE, doubleDefinition().definitionSpans[1], 'still remaining'],
  ])('%s span is a real offset into its clue', (_name, clue, span, expected) => {
    expect(clue.slice(span.start, span.end)).toEqual(expected)
  })
})

describe('gatedGloss', () => {
  const gate = (gloss: string | undefined, definition = 'floor covering'): string | undefined =>
    gatedGloss(gloss, 'CARPET', definition, 'generator')

  it('passes a gloss that says something about the answer', () => {
    expect(gate(CHARADE_GLOSS)).toEqual(CHARADE_GLOSS)
  })

  it('drops silently when the model supplied none, which is not a failure', () => {
    expect(gate(undefined)).toBeUndefined()
    expect(log).not.toHaveBeenCalled()
  })

  // Every arm logs rather than logErrors: a dropped gloss is a working gate, and the reason travels.
  it.each([
    ['over-length', 'x'.repeat(MAX_GLOSS_LENGTH + 1), 'floor covering', 'gloss-gate'],
    ['a charged term', 'A bastard of a rug.', 'floor covering', 'gloss-gate'],
    ['a control character', 'It lies underfoot.‮', 'floor covering', 'gloss-gate'],
    // G5, which buildHints waives by role for every other rung: a charade's parts spell the answer.
    ['the answer itself', 'A carpet lies underfoot.', 'floor covering', 'gloss-gate'],
    // Whole-token matching means the plural sails past G5 while handing the player the answer.
    ['an inflection of the answer', 'Carpets lie underfoot.', 'floor covering', 'gloss-inflection'],
    ['the definition, restated', 'A covering for the boards.', 'floor covering', 'gloss-restates-definition'],
    // Filtering on CONNECTIVES rather than a length floor is what catches a three-letter definition.
    ['a three-letter definition', 'A cat sat on it.', 'Cat', 'gloss-restates-definition'],
  ])('drops %s at log, with a reason', (_case, gloss, definition, reason) => {
    expect(gate(gloss, definition)).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
      answer: 'CARPET',
      reason,
      source: 'generator',
      type: 'crypticclue',
    })
    expect(logError).not.toHaveBeenCalled()
  })

  // A connective may recur; the rule is about content words. CONNECTIVES is the set verify step 7 reads.
  it('ignores a connective shared with the definition', () => {
    expect(gate('A rug for the boards.', 'A rug')).toBeUndefined()
    expect(gate('It lies underfoot.', 'A rug')).toEqual('It lies underfoot.')
  })

  it('accepts a gloss exactly at the cap', () => {
    const exact = `${'It lies underfoot. '.repeat(5)}`.slice(0, MAX_GLOSS_LENGTH)

    expect(gate(exact)?.length).toEqual(MAX_GLOSS_LENGTH)
  })

  // `source` is the only thing separating the two prompts in the logs; review.ts supplies the other.
  it('names the reviewer as the source when the reviewer wrote the string', () => {
    expect(gatedGloss('A carpet lies underfoot.', 'CARPET', 'floor covering', 'review')).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
      answer: 'CARPET',
      reason: 'gloss-gate',
      source: 'review',
      type: 'crypticclue',
    })
  })
})

/**
 * A separate gate from gatedGloss, not a second caller of it: a word gloss protects two words (its
 * target and the answer), carries a shape row because code interpolates it mid-sentence, and caps at
 * 56 rather than 80 so the widest frame still composes inside 80.
 */
describe('gatedWordGloss', () => {
  const gate = (wordGloss: string | undefined, slices: readonly string[] = ['Vehicle']): string | undefined =>
    gatedWordGloss(wordGloss, 'CAR', 'CARPET', { slices }, 'generator')

  it('passes a phrase that says what the hidden part means', () => {
    expect(gate('a thing driven on roads')).toEqual('a thing driven on roads')
  })

  it('drops silently when the model supplied none, which is not a failure', () => {
    expect(gate(undefined)).toBeUndefined()
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['over-length', 'x'.repeat(MAX_WORD_GLOSS_LENGTH + 1), 'word-gloss-gate'],
    ['a charged term', 'a bastard of a thing', 'word-gloss-gate'],
    ['a control character', 'a thing driven‮', 'word-gloss-gate'],
    // G5 over the answer, which every other rung on this device waives.
    ['the answer itself', 'part of a carpet', 'word-gloss-gate'],
    // The target, which G5 misses: leaksAnswerTokens keeps only tokens of four characters or more.
    ['the target word', 'a car you drive', 'word-gloss-inflection'],
    ['an inflection of the target', 'cars you drive', 'word-gloss-inflection'],
    ['an inflection of the answer', 'what carpets are made of', 'word-gloss-inflection'],
    // The cue is printed in the clue, so a phrase restating it hands back a word already on screen.
    ['the cue, restated', 'a vehicle you drive', 'word-gloss-restates-cue'],
    // Shape: both compose a malformed rung, not an unsafe one, hence a drop here not a rung-gate later.
    ['a capitalised opening', 'A thing driven on roads', 'word-gloss-shape'],
    ['a trailing period', 'a thing driven on roads.', 'word-gloss-shape'],
  ])('drops %s at log, with a reason', (_case, wordGloss, reason) => {
    expect(gate(wordGloss)).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Dropped a cryptic word gloss', {
      answer: 'CARPET',
      reason,
      source: 'generator',
      type: 'crypticclue',
    })
    expect(logError).not.toHaveBeenCalled()
  })

  it('ignores a connective shared with the forbidden text', () => {
    expect(gate('a vehicle driven on roads', ['A vehicle'])).toBeUndefined()
    expect(gate('a thing driven on roads', ['A vehicle'])).toEqual('a thing driven on roads')
  })

  // Several forbidden texts, which a double definition needs: neither printed half nor rung one's gloss.
  it.each([
    ['the first of several', ['Departed', 'still remaining']],
    ['the last of several', ['still remaining', 'Departed']],
  ])('rejects a phrase restating %s', (_case, slices) => {
    expect(gatedWordGloss('what the departed did', 'LEFT', 'LEFT', { slices }, 'generator')).toBeUndefined()
  })

  /*
   * `forbid.prose` is a whole sentence where `forbid.slices` are short clue fragments, so a shared
   * function word is near-certain; CONNECTIVES is the cryptic seam alphabet and lacks `on`. A length
   * floor separates a shared preposition from a shared content word, which the second row still catches.
   */
  const againstGloss = (wordGloss: string, prose: string): string | undefined =>
    gatedWordGloss(wordGloss, 'SKETCH', 'SKETCH', { prose, slices: ['Rough draft', 'comic turn'] }, 'generator')

  it('keeps a phrase sharing only a short function word with the gloss', () => {
    expect(againstGloss('five funny minutes on a stage', 'Might be pencil lines on paper.')).toEqual(
      'five funny minutes on a stage',
    )
  })

  it('still drops a phrase sharing a content word with the gloss', () => {
    expect(againstGloss('pencil marks on a pad', 'Might be pencil lines on paper.')).toBeUndefined()
  })

  // No floor on a clue slice: a three-letter definition is content where a prose token is a preposition.
  it('applies no length floor to a clue slice', () => {
    expect(gatedWordGloss('a cat sat on it', 'ROW', 'ROWBOAT', { slices: ['Cat'] }, 'generator')).toBeUndefined()
  })

  it('accepts a phrase exactly at the cap', () => {
    const exact = 'a thing driven on roads '.repeat(5).slice(0, MAX_WORD_GLOSS_LENGTH).trimEnd()

    expect(gate(`${exact}x`.slice(0, MAX_WORD_GLOSS_LENGTH))).toHaveLength(MAX_WORD_GLOSS_LENGTH)
  })

  // The reviewer rewrites this field too, and one message name over two prompts cannot tune either.
  it('names the reviewer as the source when the reviewer wrote the string', () => {
    expect(gatedWordGloss('a car you drive', 'CAR', 'CARPET', { slices: ['Vehicle'] }, 'review')).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Dropped a cryptic word gloss', {
      answer: 'CARPET',
      reason: 'word-gloss-inflection',
      source: 'review',
      type: 'crypticclue',
    })
  })

  // 56 + the widest frame (`The answer also means `, 22) + a period is 79, inside the 80 every
  // code-built rung meets. Pinned because nothing else would catch 56 becoming 70.
  it('pins the phrase cap low enough that the widest framed rung fits 80', () => {
    expect(MAX_WORD_GLOSS_LENGTH + 'The answer also means '.length + 1).toBeLessThanOrEqual(MAX_GLOSS_LENGTH)
  })
})

describe('buildHints', () => {
  describe('charade', () => {
    // One row per drop rule: the four shapes are the four things the model can supply.
    it.each([
      [
        'both model rungs survive',
        charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS }),
        [CHARADE_GLOSS, CHARADE_WORD, FIRST_PART],
      ],
      ['the word gloss drops', charade({ gloss: CHARADE_GLOSS }), [CHARADE_GLOSS, FIRST_PART, ALL_PARTS]],
      ['the gloss drops', charade({ wordGloss: CHARADE_WORD_GLOSS }), [CHARADE_WORD, FIRST_PART, ALL_PARTS]],
      // Both drop: two rungs, the only charade shape with nothing to say that is not letters.
      ['both drop', charade(), [FIRST_PART, ALL_PARTS]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // The two retired rungs, asserted as absences over every shape; this reddens if either returns.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'names neither the device nor the definition when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('The definition is')
        expect(ladder).not.toContain('built from two or more')
      },
    )

    // The word gloss is about a word the clue does not print, which is what it buys over a constant.
    it('hints at a part the clue never prints', () => {
      const ladder = texts(charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS })) ?? []

      expect(CHARADE_CLUE).not.toContain('CAR')
      expect(ladder).toContain(CHARADE_WORD)
    })

    it.each([
      ['both model rungs survive', charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS }), []],
      ['the word gloss drops', charade({ gloss: CHARADE_GLOSS }), [ALL_PARTS]],
      ['the gloss drops', charade({ wordGloss: CHARADE_WORD_GLOSS }), [ALL_PARTS]],
      ['both drop', charade(), [ALL_PARTS]],
    ])('places the every-parts rung last or not at all when %s', (_case, clue, expected) => {
      const ladder = texts(clue) ?? []

      expect(ladder.filter((text) => text.includes(' + '))).toStrictEqual(expected)
      expect(ladder.slice(0, -1).filter((text) => text.includes(' + '))).toStrictEqual([])
    })

    // Parts join in concatenation order (verify step 10), so a three-part charade names three parts.
    it('joins every part of a three-part charade', () => {
      const three = charade({
        answer: 'CARPETS',
        parts: [
          { cueSpan: { end: 7, start: 0 }, text: 'CAR' },
          { cueSpan: { end: 19, start: 13 }, text: 'PET' },
          { cueSpan: { end: 25, start: 20 }, text: 'S' },
        ],
      })

      expect(texts(three)).toStrictEqual([FIRST_PART, 'The answer is CAR + PET + S.'])
    })

    // The pool holds no letter rung at all; the first-part rung already spells that letter and more.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'composes no letter rung when %s',
      (_case, clue) => {
        expect(texts(clue)?.some((text) => text.startsWith('The answer begins with'))).toBe(false)
      },
    )
  })

  describe('deletion', () => {
    it.each([
      // Four pool entries and a prefix of three make the complete solve unreachable on this shape.
      [
        'both model rungs survive',
        deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }),
        [DELETION_GLOSS, DELETION_WORD, BRAND_LETTER],
      ],
      ['the word gloss drops', deletion({ gloss: DELETION_GLOSS }), [DELETION_GLOSS, BRAND_LETTER, SOURCE]],
      ['the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS }), [DELETION_WORD, BRAND_LETTER, SOURCE]],
      // The only two-rung shape: the letter rung leads because it is the weaker of the two.
      ['both drop', deletion(), [BRAND_LETTER, SOURCE]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // A phrase for the source leaves several drinks standing; the first letter narrows hard; the
    // source word itself ends the puzzle, because the indicator already named the removal.
    it('ranks the word gloss above the letter rung and the letter rung above the source word', () => {
      const ladder = texts(deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS })) ?? []
      const full = texts(deletion()) ?? []

      expect(ladder.indexOf(DELETION_WORD)).toBeLessThan(ladder.indexOf(BRAND_LETTER))
      expect(full.indexOf(BRAND_LETTER)).toBeLessThan(full.indexOf(SOURCE))
    })

    it.each([
      ['both model rungs survive', deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }), 3],
      ['the word gloss drops', deletion({ gloss: DELETION_GLOSS }), 3],
      ['the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS }), 3],
      ['both drop', deletion(), 2],
    ])('ships %s as %s rungs', (_case, clue, length) => {
      expect(buildHints(clue)).toHaveLength(length)
    })

    // Every deletion indicator names its own operation, so a device sentence would restate the screen.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('deletion')))(
      'names neither the device nor the definition when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('deletion')
        expect(ladder).not.toContain('The wordplay is')
        expect(ladder).not.toContain('The definition is')
      },
    )

    // The word gloss is about the source, which the clue never prints -- BRANDY is nowhere in it.
    it('hints at the source word the clue never prints', () => {
      const ladder = texts(deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS })) ?? []

      expect(DELETION_CLUE).not.toContain('BRANDY')
      expect(ladder).toContain(DELETION_WORD)
    })

    // The indicator has already named the removal, so naming the source finishes the puzzle.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('deletion')))(
      'ships the source word last or not at all when %s',
      (_case, clue) => {
        // Everything but the last rung; the ladder table above is what proves it appears at all.
        expect((texts(clue) ?? []).slice(0, -1)).not.toContain(SOURCE)
      },
    )
  })

  describe('doubledefinition', () => {
    // The shortest pool and the only one that can ship one rung: this device hides no word, so when
    // neither model string survives there is exactly one honest thing left to say.
    it.each([
      [
        'both model rungs survive',
        doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss: DOUBLE_WORD_GLOSS }),
        [DOUBLE_GLOSS, DOUBLE_WORD, LEFT_LETTER],
      ],
      ['the word gloss drops', doubleDefinition({ gloss: DOUBLE_GLOSS }), [DOUBLE_GLOSS, LEFT_LETTER]],
      ['the gloss drops', doubleDefinition({ wordGloss: DOUBLE_WORD_GLOSS }), [DOUBLE_WORD, LEFT_LETTER]],
      ['both drop', doubleDefinition(), [LEFT_LETTER]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // The letter rung is strongest only here: with no wordplay, a first letter plus the rendered
    // enumeration is a crossword lookup, so it sits last rather than mid-pool as on a deletion.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'puts the letter rung last when %s',
      (_case, clue) => {
        expect(texts(clue)?.at(-1)).toEqual(LEFT_LETTER)
      },
    )

    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'names the device on no shape when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('Both halves')
        expect(ladder).not.toContain('no wordplay')
      },
    )

    // Neither half is distinguishable as "the" definition, so quoting one back returns nothing.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'quotes neither half back at the player when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('The definition is')
        expect(ladder).not.toContain('Departed')
        expect(ladder).not.toContain('remaining')
      },
    )

    // The union of both halves gates the gloss; this reddens if only `definitionSpans[0]` is passed.
    it.each([
      ['the first half', 'It is what the departed did.'],
      ['the second half', 'Nothing remaining once the others have gone.'],
    ])('drops a gloss that restates %s', (_case, gloss) => {
      expect(texts(doubleDefinition({ gloss }))).toStrictEqual([LEFT_LETTER])
      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'LEFT',
        reason: 'gloss-restates-definition',
        source: 'generator',
        type: 'crypticclue',
      })
    })

    // Both model strings are about the answer here, so two angles sharing content words are one hint.
    it('drops a word gloss that repeats the gloss above it', () => {
      expect(texts(doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss: 'the opposite of right' }))).toStrictEqual([
        DOUBLE_GLOSS,
        LEFT_LETTER,
      ])
      expect(log).toHaveBeenCalledWith('Dropped a cryptic word gloss', {
        answer: 'LEFT',
        reason: 'word-gloss-restates-cue',
        source: 'generator',
        type: 'crypticclue',
      })
    })

    it.each([
      ['the first half', 'what the departed once did'],
      ['the second half', 'what is still remaining'],
    ])('drops a word gloss that restates %s', (_case, wordGloss) => {
      expect(texts(doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss }))).toStrictEqual([DOUBLE_GLOSS, LEFT_LETTER])
    })
  })

  describe('escalation', () => {
    // The invariant: the strongest rung is last, and no ladder opens with it. Nothing is excluded
    // from the ranking, because a rung on the wire is a rung the player spends a hint on. Strongest
    // is named per shape rather than derived, so the table cannot re-encode the pool order and agree
    // with itself. The one-rung shape is excluded here and named separately below.
    it.each([
      [
        'charade, both model rungs survive',
        charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS }),
        FIRST_PART,
      ],
      ['charade, the word gloss drops', charade({ gloss: CHARADE_GLOSS }), ALL_PARTS],
      ['charade, the gloss drops', charade({ wordGloss: CHARADE_WORD_GLOSS }), ALL_PARTS],
      ['charade, both drop', charade(), ALL_PARTS],
      [
        'deletion, both model rungs survive',
        deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }),
        BRAND_LETTER,
      ],
      ['deletion, the word gloss drops', deletion({ gloss: DELETION_GLOSS }), SOURCE],
      ['deletion, the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS }), SOURCE],
      ['deletion, both drop', deletion(), SOURCE],
      [
        'doubledefinition, both model rungs survive',
        doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss: DOUBLE_WORD_GLOSS }),
        LEFT_LETTER,
      ],
      ['doubledefinition, the word gloss drops', doubleDefinition({ gloss: DOUBLE_GLOSS }), LEFT_LETTER],
      ['doubledefinition, the gloss drops', doubleDefinition({ wordGloss: DOUBLE_WORD_GLOSS }), LEFT_LETTER],
    ])('ends with its strongest rung and never opens with it when %s', (_case, clue, strongest) => {
      const ladder = texts(clue) ?? []

      expect(ladder.at(-1)).toEqual(strongest)
      expect(ladder[0]).not.toEqual(strongest)
    })

    // Named so the exclusion above cannot hide a second one-rung shape appearing.
    it('ships exactly one shape as a single rung', () => {
      const single = EVERY_SHAPE.filter(([, clue]) => (texts(clue) ?? []).length === 1)

      expect(single.map(([name]) => name)).toStrictEqual(['doubledefinition, both drop'])
    })

    // Stated over the two rungs that ARE the answer, so it holds if a future entry is ranked below them.
    it.each(EVERY_SHAPE)('keeps every complete solve off the top of the ladder when %s', (_case, clue) => {
      const ladder = texts(clue) ?? []
      const solves = [ALL_PARTS, SOURCE]

      expect(ladder.slice(0, -1).filter((text) => solves.includes(text))).toStrictEqual([])
    })

    // `enumeration` is on `data`, so a rung stating it returns nothing; digits and "six letters" both.
    it.each(EVERY_SHAPE)('states no answer length when %s', (_case, clue) => {
      const ladder = (texts(clue) ?? []).join(' ')

      expect(ladder).not.toMatch(/\d/)
      expect(ladder).not.toMatch(/\bletters?\b/i)
    })

    // Never empty, over the ceiling, or blank: a missing rung must not ship as `{ text: undefined }`.
    it.each(EVERY_SHAPE)('stays within one and MAX_HINT_RUNGS when %s', (_case, clue) => {
      const ladder = buildHints(clue) ?? []

      expect(ladder.length).toBeGreaterThanOrEqual(1)
      expect(ladder.length).toBeLessThanOrEqual(MAX_HINT_RUNGS)
      expect(ladder.filter((rung) => typeof rung.text === 'string' && rung.text.length > 0)).toHaveLength(ladder.length)
    })
  })

  describe('the letter rung', () => {
    // At most one is a property of the pools rather than of a push appended after them.
    it.each(EVERY_SHAPE)('carries at most one letter rung when %s', (_case, clue) => {
      const letters = (texts(clue) ?? []).filter((text) => text.startsWith('The answer begins with'))

      expect(letters.length).toBeLessThanOrEqual(1)
    })

    // Placement is per device, not a fixed index; this reddens if the letter rung is appended again.
    it.each([
      ['doubledefinition, last', doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss: DOUBLE_WORD_GLOSS }), 2],
      ['deletion, below the word gloss', deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }), 2],
      ['deletion, above the source word', deletion({ gloss: DELETION_GLOSS }), 1],
      ['charade, absent', charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS }), -1],
    ])('places the letter rung by device: %s', (_case, clue, index) => {
      const ladder = texts(clue) ?? []

      expect(ladder.findIndex((text) => text.startsWith('The answer begins with'))).toEqual(index)
    })

    it.each([
      ['LEFT', 'The answer begins with L.'],
      ['OBOE', 'The answer begins with O.'],
      ['ELEPHANT', 'The answer begins with E.'],
    ])('reads the first letter of %s', (answer, begins) => {
      expect(texts(doubleDefinition({ answer }))?.at(-1)).toEqual(begins)
    })

    // Absent from every charade shape: the first-part rung already spells that letter and more.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'ships no letter rung when %s',
      (_case, clue) => {
        expect(texts(clue)?.some((text) => text.startsWith('The answer begins with'))).toBe(false)
      },
    )

    // `begins with`, never `ends with`: the retired frame is gone from the pool and isComposedRung.
    it.each(EVERY_SHAPE)('never emits an ends-with rung when %s', (_case, clue) => {
      expect(texts(clue)?.some((text) => text.startsWith('The answer ends with'))).toBe(false)
    })
  })

  describe('the shortlist band', () => {
    // hints.ts duplicates the band; it is held equal here, where a test can import both without
    // shipping nouns.ts into the leaf module's bundle.
    it.each([MIN_ANSWER_LENGTH, MAX_ANSWER_LENGTH])('has a ladder for every length the shortlist draws: %s', (length) =>
      expect(buildHints(doubleDefinition({ answer: 'A'.repeat(length) }))).toBeDefined(),
    )

    it.each([MIN_ANSWER_LENGTH - 1, MAX_ANSWER_LENGTH + 1])(
      'rejects length %s at logError rather than throwing',
      (length) => {
        const answer = 'A'.repeat(length)

        expect(buildHints(doubleDefinition({ answer }))).toBeUndefined()
        expect(logError).toHaveBeenCalledWith('Cryptic answer outside the shortlist band', {
          answer,
          reason: 'answer-not-on-shortlist',
        })
      },
    )
  })

  // No metadata member: a substring degrades to no highlight, an offset degrades to a wrong one.
  it.each(EVERY_SHAPE)('carries no metadata on any rung when %s', (_case, clue) => {
    expect(buildHints(clue)?.filter((hint) => 'metadata' in hint)).toStrictEqual([])
  })

  // The one cap with no independent check on its value, so the number is pinned literally: 80 is what
  // every code-built rung is capped at. lull-ui's rungs tests pin their own 80s; drift goes red there.
  it('pins the gloss cap to the same 80 every bounded code-built rung uses', () => {
    expect(MAX_GLOSS_LENGTH).toEqual(80)
  })

  // Asserted over a 120-character clue -- the widest the verifier admits -- because the failure this
  // catches is a rung whose length is a function of the clue rather than of the answer.
  it.each([
    ['charade', charade({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
    ['deletion', deletion({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
  ])('quotes no slice of a %s clue in any rung', (_device, clue) => {
    const ladder = texts(clue) ?? []

    expect(ladder.some((text) => text.includes('a'.repeat(59)) || text.includes('b'.repeat(60)))).toBe(false)
    expect(ladder.every((text) => text.length <= MAX_CRYPTIC_RUNG_LENGTH)).toBe(true)
  })

  // A phrase at its own cap inside the widest frame is the largest string this builder can emit.
  it.each([
    ['charade', charade({ wordGloss: 'x'.repeat(MAX_WORD_GLOSS_LENGTH) }), 'The first part is '],
    ['deletion', deletion({ wordGloss: 'x'.repeat(MAX_WORD_GLOSS_LENGTH) }), 'The longer word is '],
    ['doubledefinition', doubleDefinition({ wordGloss: 'x'.repeat(MAX_WORD_GLOSS_LENGTH) }), 'The answer also means '],
  ])('composes the widest %s word gloss rung inside every cap', (_device, clue, frame) => {
    const rung = (texts(clue) ?? []).find((text) => text.startsWith(frame))

    expect(rung).toBeDefined()
    expect(rung?.length).toBeLessThanOrEqual(MAX_GLOSS_LENGTH)
    expect(rung?.length).toBeLessThanOrEqual(MAX_CRYPTIC_RUNG_LENGTH)
  })

  // G4 on the composed rung, a code-defect gate: reaching it needs an answer that is itself a charged
  // term, which answers.ts does not draw. Asserted anyway -- the gate's job is to be unreachable.
  it('rejects a rung whose interpolated part carries a charged word', () => {
    const charged = charade({
      answer: 'BASTARD',
      parts: [
        { cueSpan: { end: 7, start: 0 }, text: 'BASTARD' },
        { cueSpan: { end: 19, start: 13 }, text: 'S' },
      ],
    })

    expect(buildHints(charged)).toBeUndefined()
    expect(logError).toHaveBeenCalledWith('A cryptic rung failed the string gates', {
      reason: 'rung-gate',
      texts: expect.any(Array),
    })
  })
})

describe('isComposedRung', () => {
  // It reads the pools' own constants, which is why scripts/audit-cryptic.ts may trust it. A framed
  // word gloss counts as composed: the audit recovers the gloss by asking this of rung 0, and an
  // audit that under-reports its own supply prompts an investigation where over-reporting hides one.
  it.each(EVERY_SHAPE)('recognizes every structural rung when %s', (_case, clue) => {
    const structural = (texts(clue) ?? []).filter(
      (text) => text !== CHARADE_GLOSS && text !== DELETION_GLOSS && text !== DOUBLE_GLOSS,
    )

    expect(structural.filter((text) => !isComposedRung(text))).toStrictEqual([])
    expect(structural.length).toBeGreaterThan(0)
  })

  // Named individually because the sweep above still passes if a frame leaves table and pool at once.
  it.each([CHARADE_WORD, DELETION_WORD, DOUBLE_WORD])('recognizes the framed word gloss %s', (rung) => {
    expect(isComposedRung(rung)).toBe(true)
  })

  // The audit recovers the gloss by asking this of rung 0, so a gloss must never be claimed.
  it.each([CHARADE_GLOSS, DELETION_GLOSS, DOUBLE_GLOSS])('does not claim the gloss %s', (gloss) => {
    expect(isComposedRung(gloss)).toBe(false)
  })

  // A frame survives here only while packs carrying it survive. The charade device sentence is off
  // this list on purpose: it opens with ALL_PARTS_FRAME, so the prefix test still matches it.
  it.each([
    'The answer ends with T.',
    'The wordplay works on "instant angora".',
    'The definition is "floor covering".',
    'Both halves of the clue define the answer; there is no wordplay.',
  ])('no longer recognizes the retired rung %s', (retired) => {
    expect(isComposedRung(retired)).toBe(false)
  })
})
