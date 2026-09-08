import { MAX_ANSWER_LENGTH, MIN_ANSWER_LENGTH } from '@generators/crypticclue/answers'
import {
  MAX_CRYPTIC_RUNG_LENGTH,
  MAX_GLOSS_LENGTH,
  MAX_HINT_RUNGS,
  buildHints,
  gatedGloss,
  isComposedRung,
} from '@generators/crypticclue/hints'
import { crypticIndicators, tellingIndicators } from '@generators/crypticclue/indicators'
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
const CHARADE_DEVICE = 'The answer is built from two or more shorter words, one after the other.'
const DOUBLE_DEVICE = 'Both halves of the clue define the answer; there is no wordplay.'
const CHARADE_DEFINITION = 'The definition is "floor covering".'
const DELETION_DEFINITION = 'The definition is "a mark".'
const FIRST_PART = 'The first part is CAR.'
const ALL_PARTS = 'The answer is CAR + PET.'
const SOURCE = 'The wordplay starts from BRANDY.'
// TWO LETTER RUNGS AND NOT THREE, because the charade pool does not hold one: its first-part rung
// already spells the answer's first letter and more, so a `The answer begins with C.` constant here
// would name a rung this builder cannot emit.
const BRAND_LETTER = 'The answer begins with B.'
const LEFT_LETTER = 'The answer begins with L.'

// One gloss per device, each one clearing every row of gatedGloss against ITS OWN definition and
// answer: no answer token, no inflection, no substantive definition word, inside the cap. Each is the
// fixture the gloss rows below break exactly one property of.
const CHARADE_GLOSS = 'It lies underfoot in most sitting rooms.'
const DELETION_GLOSS = 'A hot iron leaves this on cattle.'
const DOUBLE_GLOSS = 'The opposite of right, or what someone did on going away.'

// `Vehicle with animal makes floor covering` -- CAR + PET, definition "floor covering" (two tokens,
// so the definition rung survives), no indicator because a charade has none.
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

// `Endless spirit leaves a mark` -- BRANDY minus its last letter, definition "a mark" (two tokens).
// `indicatorSpan` is on the type and buildHints never reads it: the deletion pool has no device rung
// to drop, so there is nothing for it to decide. It is supplied because VerifiedDeletion owes it.
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

// The one-token-definition variants, which are the SAME clue with the span moved onto its last word.
// A moved span is the honest way to exercise the drop rule: the rule reads the slice, so a fixture
// that changed the clue as well would be testing two things.
const charadeOneWordDefinition = (overrides: Partial<VerifiedCharade> = {}): VerifiedCharade =>
  charade({ definitionSpan: { end: 40, start: 32 }, ...overrides })

const deletionOneWordDefinition = (overrides: Partial<VerifiedDeletion> = {}): VerifiedDeletion =>
  deletion({ definitionSpan: { end: 28, start: 24 }, ...overrides })

const texts = (clue: VerifiedClue): string[] | undefined => buildHints(clue)?.map((hint) => hint.text)

// Every ladder shape the three pools can emit, in one list, so the cross-cutting rows below -- the
// letter rung, the escalation invariant, the length rule -- run over all of them rather than over
// whichever three a reviewer thought of. TEN, and the escalation block names the strongest rung of
// each: an invariant asserted over a subset is how the last version of this file shipped a ladder
// that descended.
const EVERY_SHAPE: [string, VerifiedClue][] = [
  ['charade, both conditional rungs survive', charade({ gloss: CHARADE_GLOSS })],
  ['charade, the definition rung drops', charadeOneWordDefinition({ gloss: CHARADE_GLOSS })],
  ['charade, the gloss drops', charade()],
  ['charade, both drop', charadeOneWordDefinition()],
  ['deletion, both survive', deletion({ gloss: DELETION_GLOSS })],
  ['deletion, the definition rung drops', deletionOneWordDefinition({ gloss: DELETION_GLOSS })],
  ['deletion, the gloss drops', deletion()],
  ['deletion, both drop', deletionOneWordDefinition()],
  ['doubledefinition, the gloss survives', doubleDefinition({ gloss: DOUBLE_GLOSS })],
  ['doubledefinition, the gloss drops', doubleDefinition()],
]

describe('the fixtures', () => {
  // SLICED, NEVER EYEBALLED. Every span in this file is asserted to point at the words its name
  // claims, because an off-by-one in a fixture makes every row below assert something about a
  // different clue and none of them fail.
  it.each([
    ['the charade definition', CHARADE_CLUE, charade().definitionSpan, 'floor covering'],
    ['the charade one-word definition', CHARADE_CLUE, charadeOneWordDefinition().definitionSpan, 'covering'],
    ['the charade first cue', CHARADE_CLUE, charade().parts[0].cueSpan, 'Vehicle'],
    ['the charade second cue', CHARADE_CLUE, charade().parts[1].cueSpan, 'animal'],
    ['the deletion definition', DELETION_CLUE, deletion().definitionSpan, 'a mark'],
    ['the deletion one-word definition', DELETION_CLUE, deletionOneWordDefinition().definitionSpan, 'mark'],
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

describe('buildHints', () => {
  describe('charade', () => {
    // THE FULL LADDER, ONE ROW PER DROP RULE. Four shapes, and all four are three rungs: the charade
    // pool holds five entries and only two of them can drop.
    it.each([
      [
        'both conditional rungs survive',
        charade({ gloss: CHARADE_GLOSS }),
        [CHARADE_GLOSS, CHARADE_DEVICE, CHARADE_DEFINITION],
      ],
      // The definition is one token, so quoting it back would hand over a word already on screen.
      // The pool pulls up and the first part takes the third rung.
      [
        'the definition rung drops on a single-token definition',
        charadeOneWordDefinition({ gloss: CHARADE_GLOSS }),
        [CHARADE_GLOSS, CHARADE_DEVICE, FIRST_PART],
      ],
      ['the gloss drops', charade(), [CHARADE_DEVICE, CHARADE_DEFINITION, FIRST_PART]],
      // BOTH DROP, which is the only shape that reaches the every-parts rung -- the complete solve,
      // at the bottom, on a clue with nothing else left to give.
      ['both drop', charadeOneWordDefinition(), [CHARADE_DEVICE, FIRST_PART, ALL_PARTS]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // NEVER DROPS. A charade carries no indicator -- crypticIndicators.charade is empty by
    // construction -- so nothing on the player's screen says the answer is shorter words abutting,
    // and the sentence is new information on every clue.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('charade')))('names the device when %s', (_case, clue) => {
      expect(texts(clue)).toContain(CHARADE_DEVICE)
    })

    // THE COMPLETE SOLVE IS LAST WHEN IT APPEARS AND ABSENT WHEN IT IS NOT NEEDED. Both halves in one
    // row, because they are one rule: a giveaway ships at the bottom of the ladder or nowhere.
    it.each([
      ['both conditional rungs survive', charade({ gloss: CHARADE_GLOSS }), []],
      ['the definition rung drops', charadeOneWordDefinition({ gloss: CHARADE_GLOSS }), []],
      ['the gloss drops', charade(), []],
      ['both drop', charadeOneWordDefinition(), [ALL_PARTS]],
    ])('places the every-parts rung last or not at all when %s', (_case, clue, expected) => {
      const ladder = texts(clue) ?? []

      expect(ladder.filter((text) => text.includes(' + '))).toStrictEqual(expected)
      expect(ladder.slice(0, -1).filter((text) => text.includes(' + '))).toStrictEqual([])
    })

    // The parts are joined in the order they concatenate, which verify step 10 pinned against the
    // whole of the answer -- so a three-part charade names three parts and the first-part rung still
    // names one.
    it('joins every part of a three-part charade', () => {
      const three = charadeOneWordDefinition({
        answer: 'CARPETS',
        parts: [
          { cueSpan: { end: 7, start: 0 }, text: 'CAR' },
          { cueSpan: { end: 19, start: 13 }, text: 'PET' },
          { cueSpan: { end: 25, start: 20 }, text: 'S' },
        ],
      })

      expect(texts(three)).toStrictEqual([CHARADE_DEVICE, FIRST_PART, 'The answer is CAR + PET + S.'])
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
      // complete solve is UNREACHABLE when the gloss and the definition rung both survive -- CLAUDE.md's
      // "at the bottom of the ladder or nowhere", taking the second branch where it can be afforded.
      ['both survive', deletion({ gloss: DELETION_GLOSS }), [DELETION_GLOSS, DELETION_DEFINITION, BRAND_LETTER]],
      [
        'the definition rung drops',
        deletionOneWordDefinition({ gloss: DELETION_GLOSS }),
        [DELETION_GLOSS, BRAND_LETTER, SOURCE],
      ],
      ['the gloss drops', deletion(), [DELETION_DEFINITION, BRAND_LETTER, SOURCE]],
      // THE ONE TWO-RUNG SHAPE IN THE TABLE, and it is two rungs rather than one padded to three. The
      // letter rung leads it because it is the weaker of the two: a character, then the whole source.
      ['both drop', deletionOneWordDefinition(), [BRAND_LETTER, SOURCE]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // THE LETTER RUNG OUTRANKS THE DEFINITION QUOTE AND LOSES TO THE SOURCE WORD, which is the
    // placement the appended floor got wrong in both directions at once. The definition quote
    // RE-LABELS words already on the clue; the letter is a character no reading of the surface
    // produces. The source word ends the puzzle, because the indicator already named the removal.
    it('ranks the letter rung between the definition quote and the source word', () => {
      const ladder = texts(deletion({ gloss: DELETION_GLOSS })) ?? []
      const full = texts(deletion()) ?? []

      expect(ladder.indexOf(DELETION_DEFINITION)).toBeLessThan(ladder.indexOf(BRAND_LETTER))
      expect(full.indexOf(BRAND_LETTER)).toBeLessThan(full.indexOf(SOURCE))
    })

    // THREE OF FOUR SHAPES ARE THREE RUNGS, and the fourth is two. Asserted as a table because the
    // claim in hints.ts is a table, and a claim about ladder LENGTHS is what a reader checks first.
    it.each([
      ['both survive', deletion({ gloss: DELETION_GLOSS }), 3],
      ['the definition rung drops', deletionOneWordDefinition({ gloss: DELETION_GLOSS }), 3],
      ['the gloss drops', deletion(), 3],
      ['both drop', deletionOneWordDefinition(), 2],
    ])('ships %s as %s rungs', (_case, clue, length) => {
      expect(buildHints(clue)).toHaveLength(length)
    })

    // NO DEVICE RUNG AT ALL, on any shape. Every deletion indicator names its own operation, so the
    // sentence would hand back a word already on the player's screen -- and a rung declared with a
    // drop rule that fires every time is a rung the pool pretends to have.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('deletion')))(
      'never names the device when %s',
      (_case, clue) => {
        const ladder = (texts(clue) ?? []).join(' ')

        expect(ladder).not.toContain('deletion')
        expect(ladder).not.toContain('The wordplay is')
      },
    )

    // THE ROW THAT LICENSES THE MISSING RUNG, held here rather than only in indicators.test.ts
    // because the DECISION lives in hints.ts. A quiet deletion indicator -- one that does not
    // announce its own letter operation -- would mean DEVICE_RUNGS owes a `deletion` entry, and this
    // is what goes red on the day one is added.
    it('drops the device rung only because every deletion indicator is telling', () => {
      expect(tellingIndicators.deletion.size).toBeGreaterThan(0)
      expect([...crypticIndicators.deletion].filter((entry) => !tellingIndicators.deletion.has(entry))).toStrictEqual(
        [],
      )
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
    it.each([
      ['the gloss survives', doubleDefinition({ gloss: DOUBLE_GLOSS }), [DOUBLE_GLOSS, DOUBLE_DEVICE, LEFT_LETTER]],
      ['the gloss drops', doubleDefinition(), [DOUBLE_DEVICE, LEFT_LETTER]],
    ])('builds the ladder when %s', (_case, clue, expected) => {
      expect(texts(clue)).toStrictEqual(expected)
    })

    // THE LETTER RUNG OUTRANKS THE DEVICE SENTENCE HERE, AND ONLY HERE. This clue is two straight
    // definitions and nothing else, so a first letter beside a definition and the enumeration the
    // client already renders is a crossword lookup. The device sentence fixes the PARSE and still
    // leaves the solver a word to find, which is worth less. Same two strings, opposite order from
    // what a shared table would have produced.
    it('puts the letter rung below the device sentence', () => {
      const ladder = texts(doubleDefinition({ gloss: DOUBLE_GLOSS })) ?? []

      expect(ladder.indexOf(DOUBLE_DEVICE)).toBeLessThan(ladder.indexOf(LEFT_LETTER))
    })

    // NEVER DROPS, and it is the most valuable rung this pool composes about the CLUE: recognizing the
    // device is most of the solve, and with no indicator on the page nothing else says so.
    it.each(EVERY_SHAPE.filter(([name]) => name.startsWith('doubledefinition')))(
      'names the device when %s',
      (_case, clue) => {
        expect(texts(clue)).toContain(DOUBLE_DEVICE)
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
      expect(texts(doubleDefinition({ gloss }))).toStrictEqual([DOUBLE_DEVICE, LEFT_LETTER])
      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'LEFT',
        reason: 'gloss-restates-definition',
        source: 'generator',
        type: 'crypticclue',
      })
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
    it.each([
      ['charade, both conditional rungs survive', charade({ gloss: CHARADE_GLOSS }), CHARADE_DEFINITION],
      ['charade, the definition rung drops', charadeOneWordDefinition({ gloss: CHARADE_GLOSS }), FIRST_PART],
      ['charade, the gloss drops', charade(), FIRST_PART],
      ['charade, both drop', charadeOneWordDefinition(), ALL_PARTS],
      ['deletion, both survive', deletion({ gloss: DELETION_GLOSS }), BRAND_LETTER],
      ['deletion, the definition rung drops', deletionOneWordDefinition({ gloss: DELETION_GLOSS }), SOURCE],
      ['deletion, the gloss drops', deletion(), SOURCE],
      ['deletion, both drop', deletionOneWordDefinition(), SOURCE],
      ['doubledefinition, the gloss survives', doubleDefinition({ gloss: DOUBLE_GLOSS }), LEFT_LETTER],
      ['doubledefinition, the gloss drops', doubleDefinition(), LEFT_LETTER],
    ])('ends with its strongest rung and never opens with it when %s', (_case, clue, strongest) => {
      const ladder = texts(clue) ?? []

      expect(ladder.at(-1)).toEqual(strongest)
      expect(ladder[0]).not.toEqual(strongest)
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
      ['doubledefinition, last', doubleDefinition({ gloss: DOUBLE_GLOSS }), 2],
      ['deletion, above the source word', deletionOneWordDefinition({ gloss: DELETION_GLOSS }), 1],
      ['deletion, below the definition quote', deletion(), 1],
      ['charade, absent', charade({ gloss: CHARADE_GLOSS }), -1],
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

  // The cap CANNOT BIND against a 120-character clue, and it is asserted anyway, because "cannot
  // bind" is a property of today's constants rather than of the code. Run over the DEFINITION rung,
  // which is now the only composed rung that quotes a clue slice and therefore the only one whose
  // length is a function of MAX_CLUE_LENGTH rather than of the answer.
  it.each([
    ['charade', charade({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
    ['deletion', deletion({ clue: `${'a'.repeat(59)} ${'b'.repeat(60)}`, definitionSpan: { end: 120, start: 0 } })],
  ])('composes the %s definition rung inside the cryptic rung cap', (_device, clue) => {
    const ladder = texts(clue) ?? []

    expect(ladder.some((text) => text.startsWith('The definition is "'))).toBe(true)
    expect(ladder.every((text) => text.length <= MAX_CRYPTIC_RUNG_LENGTH)).toBe(true)
  })

  // G4 on the COMPOSED rung. The clue's own pass covers the quoted slice's tokens -- spans hold whole
  // tokens, so they are a subset -- but the composition adds tokens of its own, and this is the row
  // that fails if the gate is dropped for that reason.
  it('rejects a rung whose quoted slice carries a charged word', () => {
    const charged = charade({
      clue: 'Vehicle with animal makes bastard covering',
      definitionSpan: { end: 42, start: 26 },
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
  it.each(EVERY_SHAPE)('recognizes every structural rung when %s', (_case, clue) => {
    const structural = (texts(clue) ?? []).filter(
      (text) => text !== CHARADE_GLOSS && text !== DELETION_GLOSS && text !== DOUBLE_GLOSS,
    )

    expect(structural.filter((text) => !isComposedRung(text))).toStrictEqual([])
    expect(structural.length).toBeGreaterThan(0)
  })

  // THE GLOSS IS THE ONE RUNG IT MUST NOT CLAIM, because the audit recovers the gloss by asking this
  // question of rung 0 and nothing else.
  it.each([CHARADE_GLOSS, DELETION_GLOSS, DOUBLE_GLOSS])('does not claim the gloss %s', (gloss) => {
    expect(isComposedRung(gloss)).toBe(false)
  })

  // THE RETIRED FRAMES, asserted UNRECOGNIZED. `ends with` and the fodder quotation survived only so
  // the audit could read packs written before their rungs were retired; those packs are deleted in
  // this migration, along with the devices whose fodder the second one quoted. Task 11 updates the
  // audit against this list.
  it.each(['The answer ends with T.', 'The wordplay works on "instant angora".'])(
    'no longer recognizes the retired rung %s',
    (retired) => {
      expect(isComposedRung(retired)).toBe(false)
    },
  )
})
