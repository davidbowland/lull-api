import { MAX_EXPLANATION_LENGTH, buildExplanation } from '@generators/crypticclue/explanation'
import { VerifiedCharade, VerifiedDeletion, VerifiedDoubleDefinition } from '@generators/crypticclue/verify'
import { RemovalKind } from '@types'
import { log } from '@utils/logging'

jest.mock('@utils/logging')

// EVERY SPAN BELOW WAS VERIFIED BY SLICING, not by counting characters in a comment. A fixture whose
// spans are off by one still produces a string, so the test passes for the wrong reason and pins a
// reveal nobody would ship -- which is why the last describe re-slices every fixture and asserts the
// slice against the word it is supposed to be. That block is the guard on all the rows above it.
//
// These are fixtures rather than clues the verifier would necessarily pass. buildExplanation takes a
// VerifiedClue and asks no question the verifier already answered, so a row here is free to isolate
// one property of the composed string.

// `Floor covering from vehicle with animal` -- CAR (vehicle) + PET (animal) = CARPET. The reference
// charade, and the one the spec's table is written against.
const charade = (overrides: Partial<VerifiedCharade> = {}): VerifiedCharade => ({
  answer: 'CARPET',
  clue: 'Floor covering from vehicle with animal',
  definitionSpan: { end: 14, start: 0 },
  device: 'charade',
  parts: [
    { cueSpan: { end: 27, start: 20 }, text: 'CAR' },
    { cueSpan: { end: 39, start: 33 }, text: 'PET' },
  ],
  ...overrides,
})

// THREE PARTS, because two is the arity every other row exercises and `join(' + ')` on a two-element
// list cannot distinguish a separator from a suffix. PAN + TO + MIME = PANTOMIME, with the definition
// at the far end.
//
// REBUILT ON A SHAPE THE PIPELINE CAN ACTUALLY PRODUCE. The fixture here was CAR + A + VAN on
// `Vehicle article truck brings home`, and verifyClue rejects that clue twice over: `brings` is not a
// member of CONNECTIVES, so it is `residue-out-of-position`, and the part text `A` is one letter where
// ENABLE starts at two, so it is `unknown-part-word`. buildExplanation asks no question the verifier
// already answered, so the row still PASSED -- which is exactly how a fixture becomes the last copy of
// a shape the repo cannot ship. This clue verifies: run through the real verifier and the real
// lexicon it is accepted with these spans, one seam on GIVES, and every cue and part text a word.
const threePartCharade = (overrides: Partial<VerifiedCharade> = {}): VerifiedCharade =>
  charade({
    answer: 'PANTOMIME',
    clue: 'Pot toward mimic gives show',
    definitionSpan: { end: 27, start: 23 },
    parts: [
      { cueSpan: { end: 3, start: 0 }, text: 'PAN' },
      { cueSpan: { end: 10, start: 4 }, text: 'TO' },
      { cueSpan: { end: 16, start: 11 }, text: 'MIME' },
    ],
    ...overrides,
  })

// `Endless spirit is a mark` -- BRANDY minus its last letter is BRAND, defined by `a mark`.
const deletion = (overrides: Partial<VerifiedDeletion> = {}): VerifiedDeletion => ({
  answer: 'BRAND',
  clue: 'Endless spirit is a mark',
  definitionSpan: { end: 24, start: 18 },
  device: 'deletion',
  indicatorSpan: { end: 7, start: 0 },
  removal: 'last',
  source: { cueSpan: { end: 14, start: 8 }, text: 'BRANDY' },
  ...overrides,
})

// `Departed and still remaining` -- two senses of LEFT, and no wordplay half at all.
//
// AND, NOT BUT. The fixture read `Departed but still remaining`, and BUT is not a member of
// CONNECTIVES -- the prompt names it among the three joining words a double definition may not use --
// so that clue is `residue-out-of-position` and unshippable. The composed reveal is byte-identical
// either way, which is why the row stayed green while pinning a clue the pipeline rejects. The spans
// are unchanged because `and` and `but` are both three characters.
const doubleDefinition = (overrides: Partial<VerifiedDoubleDefinition> = {}): VerifiedDoubleDefinition => ({
  answer: 'LEFT',
  clue: 'Departed and still remaining',
  definitionSpans: [
    { end: 8, start: 0 },
    { end: 28, start: 13 },
  ],
  device: 'doubledefinition',
  ...overrides,
})

describe('buildExplanation', () => {
  describe('format', () => {
    // ONE ROW PER DEVICE, and every expected string opens with the QUOTED DEFINITION except the
    // double definition, which needs no prefix because both halves are definitions. That asymmetry is
    // the format rule, so it is asserted as literal expected strings rather than a shape.
    it.each([
      ['charade', charade(), '"Floor covering" = CAR (vehicle) + PET (animal)'],
      ['three-part charade', threePartCharade(), '"show" = PAN (Pot) + TO (toward) + MIME (mimic)'],
      ['deletion', deletion(), '"a mark" = BRANDY (spirit) minus its last letter'],
      ['doubledefinition', doubleDefinition(), 'Two definitions: "Departed" and "still remaining"'],
    ])('composes the reveal for a %s', (_device, verified, expected) => {
      expect(buildExplanation(verified)).toEqual(expected)
    })

    // THE REGRESSION ROW. A reveal reading only `CAR (vehicle) + PET (animal)` never tells the player
    // which words of the clue were the definition, which is what the span-driven reveal gave
    // unconditionally. This fails the day someone "simplifies" the prefix away.
    it.each([
      ['charade', charade(), '"Floor covering"'],
      ['deletion', deletion(), '"a mark"'],
    ])('names the definition of a %s before anything else', (_device, verified, quoted) => {
      expect(buildExplanation(verified)?.startsWith(quoted)).toBe(true)
    })

    it('ships no reveal without logging a reason', () => {
      buildExplanation(charade())

      expect(log).not.toHaveBeenCalled()
    })
  })

  describe('removal phrases', () => {
    // A TOTAL Record over RemovalKind, exercised through the builder so a missing key shows up as the
    // string "undefined" in player-visible prose rather than as a passing unit test on a table.
    it.each<[RemovalKind, string]>([
      ['first', '"a mark" = BRANDY (spirit) minus its first letter'],
      ['last', '"a mark" = BRANDY (spirit) minus its last letter'],
      ['middle', '"a mark" = BRANDY (spirit) minus its middle letter'],
    ])('names the %s removal', (removal, expected) => {
      expect(buildExplanation(deletion({ removal }))).toEqual(expected)
    })
  })

  describe('gates', () => {
    // G2. The clue is 120 characters -- MAX_CLUE_LENGTH -- and the reveal quotes 115 of them, so it
    // cannot fit 100. Undefined DROPS THE CANDIDATE, which is the whole reason this returns an option
    // rather than a best-effort string.
    const overLong = charade({
      clue: `${'x'.repeat(60)} and ${'y'.repeat(55)}`,
      definitionSpan: { end: 3, start: 0 },
      parts: [
        { cueSpan: { end: 60, start: 0 }, text: 'CAR' },
        { cueSpan: { end: 120, start: 65 }, text: 'PET' },
      ],
    })

    it('drops a reveal over the cap', () => {
      expect(buildExplanation(overLong)).toBeUndefined()
    })

    it('logs the drop with a reason', () => {
      buildExplanation(overLong)

      expect(log).toHaveBeenCalledWith('Dropped a cryptic explanation', {
        answer: 'CARPET',
        length: expect.any(Number),
        reason: 'explanation-gate',
        type: 'crypticclue',
      })
    })

    // G4, AND IT IS LIVE HERE RATHER THAN THEORETICAL. A clue slice already passed the charged-term
    // gate in generator.ts's `accept`; a part text never did. It is a lexicon word, and the lexicon
    // contains DYKE -- an embankment, blocked deliberately, as utils/charged-terms.ts says in as many
    // words.
    it('drops a reveal whose part text is a charged term', () => {
      expect(
        buildExplanation(
          charade({
            answer: 'DYKELAND',
            parts: [
              { cueSpan: { end: 27, start: 20 }, text: 'DYKE' },
              { cueSpan: { end: 39, start: 33 }, text: 'LAND' },
            ],
          }),
        ),
      ).toBeUndefined()
    })

    // G5 IS WAIVED BY ROLE. A charade's parts concatenate to the answer, so an applied leak gate
    // would reject every charade -- this row is what fails if someone "tightens" the gate by passing
    // `answer`.
    it.each([
      ['charade', charade(), 'CAR'],
      ['three-part charade', threePartCharade(), 'MIME'],
      ['deletion', deletion(), 'BRANDY'],
    ])('ships the answer letters of a %s rather than gating them out', (_device, verified, letters) => {
      expect(buildExplanation(verified)).toContain(letters)
    })

    it('caps the reveal at 100, not at the 80 every rung is pinned to', () => {
      expect(MAX_EXPLANATION_LENGTH).toEqual(100)
    })

    it.each([
      ['charade', charade()],
      ['three-part charade', threePartCharade()],
      ['deletion', deletion()],
      ['doubledefinition', doubleDefinition()],
    ])('keeps the %s reveal inside the cap', (_device, verified) => {
      expect(buildExplanation(verified)?.length).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH)
    })
  })

  // THE FIXTURE GUARD, and it is not ceremony. Every span above is a raw character offset into its
  // own clue, and an off-by-one still yields a plausible-looking string -- so each expected reveal in
  // this file would pin the wrong slice and pass. These rows re-derive the slice from the fixture and
  // assert the word, so a bad fixture fails HERE, where the message names the span, rather than
  // silently making every row above vacuous.
  describe('fixture spans', () => {
    it.each([
      ['charade definition', charade().clue, charade().definitionSpan, 'Floor covering'],
      ['charade first cue', charade().clue, charade().parts[0].cueSpan, 'vehicle'],
      ['charade second cue', charade().clue, charade().parts[1].cueSpan, 'animal'],
      ['three-part definition', threePartCharade().clue, threePartCharade().definitionSpan, 'show'],
      ['three-part first cue', threePartCharade().clue, threePartCharade().parts[0].cueSpan, 'Pot'],
      ['three-part second cue', threePartCharade().clue, threePartCharade().parts[1].cueSpan, 'toward'],
      ['three-part third cue', threePartCharade().clue, threePartCharade().parts[2].cueSpan, 'mimic'],
      ['deletion definition', deletion().clue, deletion().definitionSpan, 'a mark'],
      ['deletion indicator', deletion().clue, deletion().indicatorSpan, 'Endless'],
      ['deletion source cue', deletion().clue, deletion().source.cueSpan, 'spirit'],
      ['first definition', doubleDefinition().clue, doubleDefinition().definitionSpans[0], 'Departed'],
      ['second definition', doubleDefinition().clue, doubleDefinition().definitionSpans[1], 'still remaining'],
    ])('the %s span is a genuine offset', (_name, clue, span, expected) => {
      expect(clue.slice(span.start, span.end)).toEqual(expected)
    })
  })
})
