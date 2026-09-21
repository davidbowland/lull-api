import { MAX_EXPLANATION_LENGTH, buildExplanation } from '@generators/crypticclue/explanation'
import { VerifiedCharade, VerifiedDeletion, VerifiedDoubleDefinition } from '@generators/crypticclue/verify'
import { RemovalKind } from '@types'
import { log } from '@utils/logging'

jest.mock('@utils/logging')

// The reference charade, and the one the spec's table is written against.
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

// Three parts, because `join(' + ')` on the two-element list every other row uses cannot
// distinguish a separator from a suffix. The clue also verifies under the real verifier and lexicon.
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

// Two senses of LEFT and no wordplay half. Joined with `and` because BUT is not in CONNECTIVES, so
// `but` would make the clue `residue-out-of-position` while composing a byte-identical reveal.
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
    // Every reveal opens with the quoted definition except a double definition, where both halves are.
    it.each([
      ['charade', charade(), '"Floor covering" = CAR (vehicle) + PET (animal)'],
      ['three-part charade', threePartCharade(), '"show" = PAN (Pot) + TO (toward) + MIME (mimic)'],
      ['deletion', deletion(), '"a mark" = BRANDY (spirit) minus its last letter'],
      ['doubledefinition', doubleDefinition(), 'Two definitions: "Departed" and "still remaining"'],
    ])('composes the reveal for a %s', (_device, verified, expected) => {
      expect(buildExplanation(verified)).toEqual(expected)
    })

    // A reveal reading only `CAR (vehicle) + PET (animal)` never tells the player which words were
    // the definition; this fails the day someone simplifies the prefix away.
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
    // Driven through the builder, so a missing RemovalKind key surfaces as "undefined" in prose.
    it.each<[RemovalKind, string]>([
      ['first', '"a mark" = BRANDY (spirit) minus its first letter'],
      ['last', '"a mark" = BRANDY (spirit) minus its last letter'],
      ['middle', '"a mark" = BRANDY (spirit) minus its middle letter'],
    ])('names the %s removal', (removal, expected) => {
      expect(buildExplanation(deletion({ removal }))).toEqual(expected)
    })
  })

  describe('gates', () => {
    // G2. The clue is 120 characters (MAX_CLUE_LENGTH) and the reveal quotes 115 of them, so it
    // cannot fit 100. Undefined drops the candidate, which is why this returns an option.
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

    // G4 is live here: a clue slice already passed the charged-term gate in `accept`, but a part
    // text never did, and the lexicon contains DYKE, which utils/charged-terms.ts blocks.
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

    // G5 is waived by role: a charade's parts concatenate to the answer, so an applied leak gate
    // would reject every charade. This fails if someone tightens the gate by passing `answer`.
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

  // Every span above is a raw character offset, and an off-by-one still yields a plausible string,
  // so these rows re-derive each slice and fail here rather than making every row above vacuous.
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
