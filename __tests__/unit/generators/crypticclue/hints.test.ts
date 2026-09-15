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

// THREE CLUES, ONE PER DEVICE, and every span below is a genuine offset into its own clue -- the
// first describe block slices each one and asserts what it points at, because a fixture whose spans
// are eyeballed tests the offsets someone imagined rather than the ones the builder reads.
//
// They are shaped like clues the verifier would pass -- definition at one end, seam tokens drawn from
// CONNECTIVES -- but buildHints takes a VerifiedClue and asks no question the verifier already
// answered, so nothing here re-derives them.
const CHARADE_CLUE = 'Vehicle with animal makes floor covering'
const DELETION_CLUE = 'Endless spirit leaves a mark'
const DOUBLE_CLUE = 'Departed still remaining'

// Every rung the three pools can compose over those clues, named once so a reworded template fails
// in one place rather than in thirty string literals.
//
// NO DEVICE SENTENCE AND NO DEFINITION QUOTE. Both are gone from every pool, and the reason is one
// rule applied twice: a rung must narrow the answer using something the player cannot read off their
// own screen. A device sentence was a PER-DEVICE CONSTANT -- the same words on every charade this
// repo has ever shipped -- so it narrowed nothing after a player's first game and spent a hint saying
// so. A definition quote points at words printed in the clue. `clue` is on `data`, so those words are
// on the screen by the same rule that retires an enumeration rung.
const FIRST_PART = 'The first part is CAR.'
const ALL_PARTS = 'The answer is CAR + PET.'
const SOURCE = 'The wordplay starts from BRANDY.'
// TWO LETTER RUNGS AND NOT THREE, because the charade pool does not hold one: its first-part rung
// already spells the answer's first letter and more, so a `The answer begins with C.` constant here
// would name a rung this builder cannot emit. It is also why no `ends with` constant appears
// anywhere: a second letter reveal beside the first is one hint delivered twice.
const BRAND_LETTER = 'The answer begins with B.'
const LEFT_LETTER = 'The answer begins with L.'

// One gloss per device, each one clearing every row of gatedGloss against ITS OWN definition and
// answer: no answer token, no inflection, no substantive definition word, inside the cap. Each is the
// fixture the gloss rows below break exactly one property of.
const CHARADE_GLOSS = 'It lies underfoot in most sitting rooms.'
const DELETION_GLOSS = 'A hot iron leaves this on cattle.'
const DOUBLE_GLOSS = 'The opposite of right on a compass.'

// THE SECOND MODEL STRING AND THE RUNG EACH FRAME COMPOSES FROM IT. The phrase is what the model
// sends; the rung is what the player reads. Both are named because the gate runs over the first and
// the ladder tables assert the second, and a test that conflated them would pass a phrase through a
// frame nobody checked.
//
// EACH ONE IS ABOUT A WORD THE CLUE DOES NOT PRINT -- CAR for the charade, BRANDY for the deletion --
// which is the whole reason this rung replaced a device sentence. A double definition hides no such
// word, so its phrase is a third angle on the answer itself, reusing neither printed half nor the
// gloss above it.
const CHARADE_WORD_GLOSS = 'a thing driven on roads'
const DELETION_WORD_GLOSS = 'a strong drink'
const DOUBLE_WORD_GLOSS = 'a political leaning'
const CHARADE_WORD = `The first part is ${CHARADE_WORD_GLOSS}.`
const DELETION_WORD = `The longer word is ${DELETION_WORD_GLOSS}.`
const DOUBLE_WORD = `The answer also means ${DOUBLE_WORD_GLOSS}.`

// `Vehicle with animal makes floor covering` -- CAR + PET, definition "floor covering". CAR AND PET
// APPEAR NOWHERE IN IT, which is the property the word gloss rung depends on and which verify proves
// on the nightly path. `definitionSpan` is still read -- gatedGloss gates the gloss against it -- but
// no rung quotes it any more.
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

// `Endless spirit leaves a mark` -- BRANDY minus its last letter, definition "a mark". BRANDY is not
// in the clue either, for the same reason CAR is not in the charade's. `indicatorSpan` is on the type
// and buildHints never reads it: there is no device rung on any device now, so nothing consults an
// indicator. It is supplied because VerifiedDeletion owes it.
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

// Every ladder shape the three pools can emit, in one list, so the cross-cutting rows below -- the
// letter rung, the escalation invariant, the length rule -- run over all of them rather than over
// whichever three a reviewer thought of. TWELVE, and the escalation block names the strongest rung of
// each: an invariant asserted over a subset is how an earlier version of this file shipped a ladder
// that descended.
//
// THE TWO DIMENSIONS ARE NOW THE TWO MODEL STRINGS, where they used to be the gloss and a drop rule
// over a clue slice. Both conditional rungs are model prose, so every shape below is a statement
// about what the model supplied rather than about the clue's shape -- which is the change: a pool
// whose conditional entries are prose degrades by losing CONTENT, where one whose conditional entry
// was a quotation degraded by losing a pointer at something already on screen.
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
  // SLICED, NEVER EYEBALLED. Every span in this file is asserted to point at the words its name
  // claims, because an off-by-one in a fixture makes every row below assert something about a
  // different clue and none of them fail.
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

  // Every arm is a `log` and never a logError. A dropped gloss is a working gate on model prose and
  // an EXPECTED outcome -- the ladder backfills -- and the reason travels so the prompt can be tuned
  // by reading which gate fires.
  it.each([
    ['over-length', 'x'.repeat(MAX_GLOSS_LENGTH + 1), 'floor covering', 'gloss-gate'],
    ['a charged term', 'A bastard of a rug.', 'floor covering', 'gloss-gate'],
    ['a control character', 'It lies underfoot.‮', 'floor covering', 'gloss-gate'],
    // G5, which buildHints waives BY ROLE for every other rung. A charade's parts spell the answer;
    // a sentence about the answer may not name it.
    ['the answer itself', 'A carpet lies underfoot.', 'floor covering', 'gloss-gate'],
    // Whole-token matching means the plural sails past G5 while handing the player the answer.
    ['an inflection of the answer', 'Carpets lie underfoot.', 'floor covering', 'gloss-inflection'],
    ['the definition, restated', 'A covering for the boards.', 'floor covering', 'gloss-restates-definition'],
    // The four-character floor on the banned predicate would have let this through; filtering on
    // CONNECTIVES instead of a length floor is what catches a three-letter definition.
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

  // A connective IS allowed to recur -- the rule is about content words, and a definition's "A" or
  // "The" carries no meaning to restate. CONNECTIVES is the same set verify step 7's
  // substantive-definition floor reads, so the two cannot disagree about what a content word is.
  it('ignores a connective shared with the definition', () => {
    expect(gate('A rug for the boards.', 'A rug')).toBeUndefined()
    expect(gate('It lies underfoot.', 'A rug')).toEqual('It lies underfoot.')
  })

  it('accepts a gloss exactly at the cap', () => {
    const exact = `${'It lies underfoot. '.repeat(5)}`.slice(0, MAX_GLOSS_LENGTH)

    expect(gate(exact)?.length).toEqual(MAX_GLOSS_LENGTH)
  })

  // THE `source` PARAMETER IS THE ONLY THING SEPARATING the two prompts in the logs, and review.ts
  // supplies the other value. A gate whose reason cannot say which prompt wrote the string cannot be
  // used to tune either.
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
 * THE GATE ON THE SECOND MODEL STRING, and it is a DIFFERENT GATE from gatedGloss rather than a
 * second caller of it. A gloss is a SENTENCE about the answer; a word gloss is a bare PHRASE about a
 * word the answer is built from, which code then frames. Three of the differences are load-bearing:
 *
 *   * TWO PROTECTED WORDS, not one. A charade's word gloss is about CAR and must name neither CAR nor
 *     CARPET -- the target because that is the word it is hinting at, the answer because no rung may
 *     hand it over. gatedGloss protects one word because its target IS the answer.
 *   * A SHAPE ROW. The phrase is interpolated mid-sentence, so `A noisy argument.` composes
 *     `The first part is A noisy argument..` -- a capital mid-sentence and a doubled period. The rung
 *     is built here, so its well-formedness is decidable here.
 *   * A NARROWER CAP. 56, not 80, and the reason is arithmetic rather than taste: the widest frame is
 *     22 characters and a composed rung is held to the same 80 every other code-built rung meets.
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
    // G5 over the ANSWER. Every other rung on this device waives it -- a charade's parts spell the
    // answer -- and a phrase about one part carries no such licence.
    ['the answer itself', 'part of a carpet', 'word-gloss-gate'],
    // THE TARGET, which G5 cannot catch: leaksAnswerTokens keeps only tokens of four characters or
    // more, and CAR is three. This is the row that fails if the target is protected by G5 alone.
    ['the target word', 'a car you drive', 'word-gloss-inflection'],
    ['an inflection of the target', 'cars you drive', 'word-gloss-inflection'],
    ['an inflection of the answer', 'what carpets are made of', 'word-gloss-inflection'],
    // The cue is printed in the clue, so a phrase restating it hands back a word already on screen.
    ['the cue, restated', 'a vehicle you drive', 'word-gloss-restates-cue'],
    // SHAPE. Both halves compose a malformed rung rather than an unsafe one, which is why they are a
    // drop here and not a rung-gate rejection later.
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

  // A connective may recur, for the same reason it may in a gloss: the rule is about content words.
  it('ignores a connective shared with the forbidden text', () => {
    expect(gate('a vehicle driven on roads', ['A vehicle'])).toBeUndefined()
    expect(gate('a thing driven on roads', ['A vehicle'])).toEqual('a thing driven on roads')
  })

  // MORE THAN ONE FORBIDDEN TEXT, which is what a double definition needs: its word gloss may restate
  // neither printed half NOR the gloss already shipped as rung one.
  it.each([
    ['the first of several', ['Departed', 'still remaining']],
    ['the last of several', ['still remaining', 'Departed']],
  ])('rejects a phrase restating %s', (_case, slices) => {
    expect(gatedWordGloss('what the departed did', 'LEFT', 'LEFT', { slices }, 'generator')).toBeUndefined()
  })

  /*
   * THE PROSE FILTER, AND THE FALSE DROP THAT PUT IT HERE. `forbid.prose` is a whole SENTENCE -- the
   * gloss already shipped as rung one -- where `forbid.slices` are four-word clue fragments, so the
   * two strings meet across a far wider surface and a shared function word is near-certain.
   *
   * CONNECTIVES DOES NOT COVER IT, because it is the cryptic SEAM alphabet rather than a stopword
   * list: it holds `of`, `to` and `with` and does not hold `on`. The first version of this gate
   * filtered prose on CONNECTIVES alone, and `Might be pencil lines on paper.` killed `five funny
   * minutes on a stage` over the word `on` -- two genuinely different angles, one dropped rung, and
   * nothing restated. The length floor is what separates them.
   *
   * IT STILL CATCHES A REAL REPEAT, which is the second row and the reason this is a floor rather
   * than dropping the prose rule altogether.
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

  // THE FLOOR IS NOT APPLIED TO A CLUE SLICE, and that asymmetry is the design. A three-letter
  // definition is pure content where a three-letter prose token is almost always a preposition, so a
  // floor over slices would wave through exactly the restatement gatedGloss's own note calls out.
  it('applies no length floor to a clue slice', () => {
    expect(gatedWordGloss('a cat sat on it', 'ROW', 'ROWBOAT', { slices: ['Cat'] }, 'generator')).toBeUndefined()
  })

  it('accepts a phrase exactly at the cap', () => {
    const exact = 'a thing driven on roads '.repeat(5).slice(0, MAX_WORD_GLOSS_LENGTH).trimEnd()

    expect(gate(`${exact}x`.slice(0, MAX_WORD_GLOSS_LENGTH))).toHaveLength(MAX_WORD_GLOSS_LENGTH)
  })

  // The reviewer rewrites this field too, and one message name over two prompts cannot be read to
  // tune either.
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
  // code-built rung in either repo meets. Pinned because nothing else would catch 56 becoming 70.
  it('pins the phrase cap low enough that the widest framed rung fits 80', () => {
    expect(MAX_WORD_GLOSS_LENGTH + 'The answer also means '.length + 1).toBeLessThanOrEqual(MAX_GLOSS_LENGTH)
  })
})

describe('buildHints', () => {
  describe('charade', () => {
    // THE FULL LADDER, ONE ROW PER DROP RULE. Both conditional entries are model prose now, so the
    // four shapes are the four things the model can supply rather than four shapes of clue.
    it.each([
      [
        'both model rungs survive',
        charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS }),
        [CHARADE_GLOSS, CHARADE_WORD, FIRST_PART],
      ],
      ['the word gloss drops', charade({ gloss: CHARADE_GLOSS }), [CHARADE_GLOSS, FIRST_PART, ALL_PARTS]],
      ['the gloss drops', charade({ wordGloss: CHARADE_WORD_GLOSS }), [CHARADE_WORD, FIRST_PART, ALL_PARTS]],
      // BOTH DROP: two rungs, and the only charade shape with nothing to say that is not letters.
      ['both drop', charade(), [FIRST_PART, ALL_PARTS]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // THE TWO RETIRED RUNGS, asserted as absences over every shape. The device sentence was a
    // per-device CONSTANT and the definition rung quoted the clue; neither can narrow an answer the
    // player is looking at. This is the row that reddens if either is reintroduced.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'names neither the device nor the definition when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('The definition is')
        expect(ladder).not.toContain('built from two or more')
      },
    )

    // THE WORD GLOSS IS ABOUT A WORD THE CLUE DOES NOT PRINT, which is the whole of what it buys over
    // the sentence it replaced. CAR appears nowhere in `Vehicle with animal makes floor covering`.
    it('hints at a part the clue never prints', () => {
      const ladder = texts(charade({ gloss: CHARADE_GLOSS, wordGloss: CHARADE_WORD_GLOSS })) ?? []

      expect(CHARADE_CLUE).not.toContain('CAR')
      expect(ladder).toContain(CHARADE_WORD)
    })

    // THE COMPLETE SOLVE IS LAST WHEN IT APPEARS AND ABSENT WHEN IT IS NOT NEEDED. Both halves in one
    // row, because they are one rule: a giveaway ships at the bottom of the ladder or nowhere.
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

    // The parts are joined in the order they concatenate, which verify step 10 pinned against the
    // whole of the answer -- so a three-part charade names three parts and the first-part rung still
    // names one.
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

    // NO LETTER RUNG ON THIS DEVICE, and it is not a floor that happened not to be reached: the
    // charade pool does not contain one. The first-part rung spells the answer's first letter and one
    // to seven more -- the parts concatenate in clue order -- so shipping both would spend a hint on a
    // character the next rung repeats.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'composes no letter rung when %s',
      (_case, clue) => {
        expect(texts(clue)?.some((text) => text.startsWith('The answer begins with'))).toBe(false)
      },
    )
  })

  describe('deletion', () => {
    it.each([
      // THE GENTLEST SHAPE NEVER NAMES THE SOURCE. Four pool entries and a prefix of three means the
      // complete solve is UNREACHABLE when both model rungs survive -- CLAUDE.md's "at the bottom of
      // the ladder or nowhere", taking the second branch where it can be afforded.
      [
        'both model rungs survive',
        deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }),
        [DELETION_GLOSS, DELETION_WORD, BRAND_LETTER],
      ],
      ['the word gloss drops', deletion({ gloss: DELETION_GLOSS }), [DELETION_GLOSS, BRAND_LETTER, SOURCE]],
      ['the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS }), [DELETION_WORD, BRAND_LETTER, SOURCE]],
      // THE ONE TWO-RUNG SHAPE IN THE TABLE, and it is two rungs rather than one padded to three. The
      // letter rung leads it because it is the weaker of the two: a character, then the whole source.
      ['both drop', deletion(), [BRAND_LETTER, SOURCE]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // THE WORD GLOSS OUTRANKS NOTHING AND LOSES TO THE LETTER, which is the placement an appended
    // floor got wrong in both directions at once. A phrase for the SOURCE leaves several drinks
    // standing; a first letter beside a definition and the enumeration the client renders narrows
    // hard. The source word itself ends the puzzle, because the indicator already named the removal.
    it('ranks the word gloss above the letter rung and the letter rung above the source word', () => {
      const ladder = texts(deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS })) ?? []
      const full = texts(deletion()) ?? []

      expect(ladder.indexOf(DELETION_WORD)).toBeLessThan(ladder.indexOf(BRAND_LETTER))
      expect(full.indexOf(BRAND_LETTER)).toBeLessThan(full.indexOf(SOURCE))
    })

    // THREE OF FOUR SHAPES ARE THREE RUNGS, and the fourth is two. Asserted as a table because the
    // claim in hints.ts is a table, and a claim about ladder LENGTHS is what a reader checks first.
    it.each([
      ['both model rungs survive', deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS }), 3],
      ['the word gloss drops', deletion({ gloss: DELETION_GLOSS }), 3],
      ['the gloss drops', deletion({ wordGloss: DELETION_WORD_GLOSS }), 3],
      ['both drop', deletion(), 2],
    ])('ships %s as %s rungs', (_case, clue, length) => {
      expect(buildHints(clue)).toHaveLength(length)
    })

    // NO DEVICE RUNG AND NO DEFINITION QUOTE, on any shape. Every deletion indicator names its own
    // operation, so a device sentence would hand back a word already on the player's screen -- and
    // the definition is printed in the clue.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('deletion')))(
      'names neither the device nor the definition when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('deletion')
        expect(ladder).not.toContain('The wordplay is')
        expect(ladder).not.toContain('The definition is')
      },
    )

    // THE WORD GLOSS IS ABOUT THE SOURCE, WHICH THE CLUE NEVER PRINTS -- that is what makes it a hint
    // on a device whose indicator already announces the mechanism. BRANDY appears nowhere in
    // `Endless spirit leaves a mark`.
    it('hints at the source word the clue never prints', () => {
      const ladder = texts(deletion({ gloss: DELETION_GLOSS, wordGloss: DELETION_WORD_GLOSS })) ?? []

      expect(DELETION_CLUE).not.toContain('BRANDY')
      expect(ladder).toContain(DELETION_WORD)
    })

    // THE COMPLETE SOLVE ON THIS DEVICE: the indicator has already told the player what to remove, so
    // naming the source finishes the puzzle. It is therefore the LAST rung on every shape that has it
    // and absent from the shape that does not -- never anywhere else, and never rung one.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('deletion')))(
      'ships the source word last or not at all when %s',
      (_case, clue) => {
        // Everything but the last rung, which is where a giveaway may never appear. The ladder table
        // above is what proves it appears at all -- this row is the one that fails if it moves up.
        expect((texts(clue) ?? []).slice(0, -1)).not.toContain(SOURCE)
      },
    )
  })

  describe('doubledefinition', () => {
    // THE SHORTEST POOL OF THE THREE, at three entries, and the only one that can ship a ONE-RUNG
    // ladder. This device hides no word: both halves are printed, there are no parts and no source,
    // so when neither model string survives there is exactly one honest thing left to say. A rung you
    // do not have beats a rung that restates the screen, and padding this to three would mean a
    // second letter reveal -- one hint delivered twice, which is the shape a player named as the
    // thing they hated most.
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

    // THE LETTER RUNG IS THE STRONGEST ENTRY HERE, AND ONLY HERE. This clue is two straight
    // definitions and nothing else -- no wordplay, no letters to operate on -- so a first letter
    // beside a definition and the enumeration the client already renders is a crossword lookup. It is
    // therefore LAST on every shape rather than ranked mid-pool as it is on a deletion.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'puts the letter rung last when %s',
      (_case, clue) => {
        expect(texts(clue)?.at(-1)).toEqual(LEFT_LETTER)
      },
    )

    // NO DEVICE SENTENCE. It was the single most defensible constant this type shipped -- recognizing
    // a double definition is most of the solve -- and it was still the SAME SENTENCE on every double
    // definition ever generated, so it told a returning player nothing at all. That is the rule: a
    // rung must narrow THIS answer, and a per-device constant narrows no answer twice.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'names the device on no shape when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('Both halves')
        expect(ladder).not.toContain('no wordplay')
      },
    )

    // NO QUOTING RUNG. Both halves are on screen and neither is distinguishable as "the definition",
    // so quoting one back returns nothing -- and quoting both is the clue.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'quotes neither half back at the player when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('The definition is')
        expect(ladder).not.toContain('Departed')
        expect(ladder).not.toContain('remaining')
      },
    )

    // THE UNION OF BOTH HALVES IS WHAT GATES THE GLOSS, and this is the row that fails if someone
    // passes only `definitionSpans[0]`. A gloss leaning on the SECOND half is the interesting case:
    // it is the half the player is likelier to be stuck on, and a first-half-only gate would ship it.
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

    // THE GLOSS IS FORBIDDEN TO THE WORD GLOSS, and this device is the only one where that matters:
    // its two model strings are both about the ANSWER, where a charade's second string is about a
    // part. Two angles on one word that share their content words are one hint delivered twice.
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

    // BOTH PRINTED HALVES ARE FORBIDDEN TOO, for the same reason the gloss's own rule forbids them.
    it.each([
      ['the first half', 'what the departed once did'],
      ['the second half', 'what is still remaining'],
    ])('drops a word gloss that restates %s', (_case, wordGloss) => {
      expect(texts(doubleDefinition({ gloss: DOUBLE_GLOSS, wordGloss }))).toStrictEqual([DOUBLE_GLOSS, LEFT_LETTER])
    })
  })

  describe('escalation', () => {
    // THE INVARIANT, TOTAL OVER ALL TEN SHAPES AND OVER EVERY RUNG IN THEM. Two claims, one table:
    // the strongest rung is LAST, and no ladder OPENS with it.
    //
    // NOTHING IS EXCLUDED FROM THE RANKING, and that exclusion is what the earlier version of this
    // block got wrong. It subtracted the letter rung before checking, on the theory that a floor
    // appended below the pool was not part of the escalation -- which is exactly how
    // `The wordplay starts from BRANDY.` came to sit ABOVE `The answer begins with B.` with a green
    // suite. A rung on the wire is a rung the player spends a hint on; if it is not ranked, it is not
    // checked, and this reads `at(-1)` over the shipped ladder for that reason.
    //
    // THE STRONGEST RUNG IS NAMED PER SHAPE rather than derived, because "which rung yields most" is
    // the judgment this file exists to make and a derivation would just re-encode the pool order and
    // agree with it by construction. Three different rungs win on three devices -- a quotation, a
    // letter and a source word -- and the letter rung wins on doubledefinition while losing on
    // deletion, which is the per-device ranking in one table.
    //
    // The second assertion cannot pass vacuously: a one-rung ladder has its strongest rung at index 0
    // and at(-1) both, so it fails here rather than slipping through as "well, it had no weaker rung".
    // THE ONE-RUNG SHAPE IS EXCLUDED FROM THE SECOND CLAIM AND NAMED SEPARATELY BELOW, rather than
    // quietly passing it. On a one-rung ladder the strongest rung is at index 0 and at(-1) both, so
    // "never opens with it" is false by arithmetic rather than by a ranking error -- and a row that
    // swallowed that case would swallow a genuine one-rung regression on the other eleven shapes too.
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

    // THE ONLY SHAPE IN THE TABLE THAT IS ONE RUNG, named so the exclusion above cannot hide a second
    // one appearing. If another device ever collapses to a single rung, this row still reads one.
    it('ships exactly one shape as a single rung', () => {
      const single = EVERY_SHAPE.filter(([, clue]) => (texts(clue) ?? []).length === 1)

      expect(single.map(([name]) => name)).toStrictEqual(['doubledefinition, both drop'])
    })

    // NO RUNG THAT HANDS OVER THE ANSWER MAY SIT ANYWHERE BUT THE BOTTOM. The invariant above is
    // stated over the strongest rung of each shape; this one is stated over the two rungs that ARE the
    // answer -- a charade's every-parts rung and a deletion's source word -- so it keeps holding if a
    // future pool entry is ranked below them by mistake.
    it.each(EVERY_SHAPE)('keeps every complete solve off the top of the ladder when %s', (_case, clue) => {
      const ladder = texts(clue) ?? []
      const solves = [ALL_PARTS, SOURCE]

      expect(ladder.slice(0, -1).filter((text) => solves.includes(text))).toStrictEqual([])
    })

    // NO LENGTH ON ANY RUNG, ON ANY DEVICE. `enumeration` ships on `data` and the client renders it
    // beside the clue, so a rung stating it spends a hint and returns nothing. The digit half catches
    // "(6)" and the word half catches "six letters"; the charade device sentence's "two or more
    // shorter words" is about how many WORDS the answer joins and is deliberately not matched.
    it.each(EVERY_SHAPE)('states no answer length when %s', (_case, clue) => {
      const ladder = (texts(clue) ?? []).join(' ')

      expect(ladder).not.toMatch(/\d/)
      expect(ladder).not.toMatch(/\bletters?\b/i)
    })

    // NEVER EMPTY, never over the ceiling, and never a blank rung -- over every shape. The builder
    // used to name three indices in a literal, so a two-rung ladder would have shipped
    // `{ text: undefined }` as a third: typechecking, rendering as a blank hint, telling nobody.
    it.each(EVERY_SHAPE)('stays within one and MAX_HINT_RUNGS when %s', (_case, clue) => {
      const ladder = buildHints(clue) ?? []

      expect(ladder.length).toBeGreaterThanOrEqual(1)
      expect(ladder.length).toBeLessThanOrEqual(MAX_HINT_RUNGS)
      expect(ladder.filter((rung) => typeof rung.text === 'string' && rung.text.length > 0)).toHaveLength(ladder.length)
    })
  })

  describe('the letter rung', () => {
    // ONE, NEVER TWO. Two letter reveals in a ladder is one hint delivered twice, which is the shape a
    // player named as the thing they hated most. It is a pool ENTRY on two devices and absent on the
    // third, so "at most one" is a property of the pools rather than of a push.
    it.each(EVERY_SHAPE)('carries at most one letter rung when %s', (_case, clue) => {
      const letters = (texts(clue) ?? []).filter((text) => text.startsWith('The answer begins with'))

      expect(letters.length).toBeLessThanOrEqual(1)
    })

    // WHERE IT SITS IS THE DEVICE'S ANSWER, NOT A FIXED INDEX -- last on doubledefinition, third of
    // four on deletion (so above the source word and below the definition quote), absent on charade.
    // This is the row that fails if someone reintroduces "append the letter rung at the end".
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

    // ABSENT FROM EVERY CHARADE SHAPE, because the first-part rung already spells that letter and
    // more. This is the only device where another rung contains it.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))(
      'ships no letter rung when %s',
      (_case, clue) => {
        expect(texts(clue)?.some((text) => text.startsWith('The answer begins with'))).toBe(false)
      },
    )

    // `begins with`, NEVER `ends with`. The retired frame is gone from the pool AND from
    // isComposedRung -- see the audit rows below -- because the packs that carried it are deleted in
    // this migration.
    it.each(EVERY_SHAPE)('never emits an ends-with rung when %s', (_case, clue) => {
      expect(texts(clue)?.some((text) => text.startsWith('The answer ends with'))).toBe(false)
    })
  })

  describe('the shortlist band', () => {
    // The duplicated band in hints.ts is held equal to the one drawAnswers filters on HERE, where a
    // test can import both without shipping nouns.ts into the leaf module's bundle.
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

  // HintMetadata gains NO MEMBER from this type: a substring degrades to no highlight, an offset
  // degrades to a WRONG one, and a wrong highlight on a cryptic clue points the player at the wrong
  // half of the puzzle.
  it.each(EVERY_SHAPE)('carries no metadata on any rung when %s', (_case, clue) => {
    expect(buildHints(clue)?.filter((hint) => 'metadata' in hint)).toStrictEqual([])
  })

  // NOT read off the symbol, unlike every other assertion in this file. MAX_GLOSS_LENGTH is the one
  // cap here with no independent check on its value -- the packs-size row would catch a large
  // increase indirectly through worst-case.ts and nothing at all would catch 80 becoming 60 -- so
  // this pins the number and the reason for it: 80 is what every code-built rung is capped at,
  // rather than MAX_HINT_LENGTH, which is sized for phrase prose.
  //
  // IT USED TO PIN TWO SIBLING SYMBOLS AS WELL, and that half is gone. MAX_ANAGRAM_RUNG_LENGTH and
  // MAX_PHRAZLE_RUNG_LENGTH are also 80 and now live ONLY in lull-ui, as
  // components/themedanagrams/rungs.ts and components/phrazle/rungs.ts, so there is nothing here to
  // import and no way to assert the three numbers equal in one place. What replaces it is two halves
  // that do not touch: this row pins 80 here, and lull-ui's rungs tests pin their own 80s there, each
  // carrying a comment naming this one. A sibling drifting off 80 goes red over there, or nowhere.
  //
  // MAX_CRYPTOGRAM_RUNG_LENGTH WAS ALWAYS OUTSIDE THAT PIN at 99, because cryptogram is the one type
  // with no per-word length gate.
  it('pins the gloss cap to the same 80 every bounded code-built rung uses', () => {
    expect(MAX_GLOSS_LENGTH).toEqual(80)
  })

  // NO RUNG QUOTES THE CLUE ANY MORE, ON ANY SHAPE, and that is the property the definition rung's
  // retirement bought. It is asserted over a 120-character clue -- the widest the verifier admits --
  // because the interesting failure is a rung whose LENGTH is a function of the clue rather than of
  // the answer, and there is now no such rung to find.
  it.each([
    ['charade', charade({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
    ['deletion', deletion({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
  ])('quotes no slice of a %s clue in any rung', (_device, clue) => {
    const ladder = texts(clue) ?? []

    expect(ladder.some((text) => text.includes('a'.repeat(59)) || text.includes('b'.repeat(60)))).toBe(false)
    expect(ladder.every((text) => text.length <= MAX_CRYPTIC_RUNG_LENGTH)).toBe(true)
  })

  // THE WIDEST COMPOSED RUNG IS NOW A FRAMED WORD GLOSS, so the cap is exercised there instead. A
  // phrase at its own cap inside the widest frame is the largest string this builder can emit, and it
  // must clear both the rung gate and the 80 every code-built rung meets.
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

  // G4 on the COMPOSED rung, which is a CODE-DEFECT gate rather than a content filter now that no
  // rung quotes the clue. The only model-derived string still interpolated into a rung is a part's
  // `text`, and verify step 10 pins every letter of that against the answer -- so reaching this
  // requires an answer that is itself a charged term, which answers.ts does not draw. Asserted anyway,
  // because the gate's job is to be unreachable rather than absent.
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
  // IT READS THE POOLS' OWN CONSTANTS, which is the only reason scripts/audit-cryptic.ts may trust it
  // -- a prefix table copied into the audit would silently stop matching the day a template is
  // reworded. This row runs it over every rung the three pools can actually emit.
  // A FRAMED WORD GLOSS COUNTS AS COMPOSED, and the direction of that choice is the safe one. The
  // rung is half model prose, so neither answer is clean -- but the audit recovers the gloss by asking
  // this question of rung 0, and on the shape where the gloss dropped the word gloss IS rung 0. Called
  // composed, the audit reports no gloss and the supply rate reads LOW; called model prose, it reports
  // one that was never written and a dead gloss prompt hides behind it. An audit that under-reports
  // its own supply prompts an investigation; one that over-reports hides a defect.
  it.each(EVERY_SHAPE)('recognizes every structural rung when %s', (_case, clue) => {
    const structural = (texts(clue) ?? []).filter(
      (text) => text !== CHARADE_GLOSS && text !== DELETION_GLOSS && text !== DOUBLE_GLOSS,
    )

    expect(structural.filter((text) => !isComposedRung(text))).toStrictEqual([])
    expect(structural.length).toBeGreaterThan(0)
  })

  // THE THREE WORD-GLOSS FRAMES, named individually rather than left to the sweep above, because the
  // sweep would still pass if a frame were dropped from the table AND from the pool at once.
  it.each([CHARADE_WORD, DELETION_WORD, DOUBLE_WORD])('recognizes the framed word gloss %s', (rung) => {
    expect(isComposedRung(rung)).toBe(true)
  })

  // THE GLOSS IS THE ONE RUNG IT MUST NOT CLAIM, because the audit recovers the gloss by asking this
  // question of rung 0 and nothing else.
  it.each([CHARADE_GLOSS, DELETION_GLOSS, DOUBLE_GLOSS])('does not claim the gloss %s', (gloss) => {
    expect(isComposedRung(gloss)).toBe(false)
  })

  // THE RETIRED FRAMES, asserted UNRECOGNIZED. The list grows by two with this change: the definition
  // quote and the two device sentences are gone from the pools, so they are gone from the table that
  // recognizes them. The precedent is the `ends with` and fodder frames struck the same way -- a frame
  // survives here only while packs carrying it survive, and this change regenerates every cryptic.
  //
  // THE CHARADE DEVICE SENTENCE IS DELIBERATELY NOT ON THIS LIST, and it is the one retired rung this
  // function still claims. `The answer is built from ...` opens with ALL_PARTS_FRAME, so striking the
  // sentence from the pool cannot strike it from the prefix test -- the overlap that was noted as
  // harmless while both were composed here outlives one of them. It costs nothing: the sentence can no
  // longer appear on a rung this repo writes, and on an old pack it was structural anyway.
  it.each([
    'The answer ends with T.',
    'The wordplay works on "instant angora".',
    'The definition is "floor covering".',
    'Both halves of the clue define the answer; there is no wordplay.',
  ])('no longer recognizes the retired rung %s', (retired) => {
    expect(isComposedRung(retired)).toBe(false)
  })
})
