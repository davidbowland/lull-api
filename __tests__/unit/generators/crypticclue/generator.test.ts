import { SHORTLIST_SIZE, drawAnswers } from '@generators/crypticclue/answers'
import { crypticClueContribution } from '@generators/crypticclue/contribution'
import { crypticClueGenerator, crypticTool } from '@generators/crypticclue/generator'
import { MAX_GLOSS_LENGTH } from '@generators/crypticclue/hints'
import { reviewClues } from '@generators/crypticclue/review'
import { VerifiedClue, verifyClue } from '@generators/crypticclue/verify'
import { BatchRequest, requestBatch } from '@services/model-batch'
import { Candidate, CrypticClueData, Pack, Puzzle } from '@types'
import { log, logError } from '@utils/logging'

jest.mock('@services/model-batch')
jest.mock('@utils/logging')
// MOCKED, and the default is the identity. reviewClues makes the type's second Bedrock call, so an
// unmocked one reaches getPromptById and fails into its own catch -- which returns the input and
// would make every row here pass for the wrong reason. The rows that care about the review say so
// with mockResolvedValueOnce.
jest.mock('@generators/crypticclue/review')
jest.mock('@generators/crypticclue/answers', () => ({
  SHORTLIST_SIZE: 40,
  drawAnswers: jest.fn(),
}))

// The 152,206-entry membership slice, replaced with the words these fixtures use. This suite is
// about the generator's WIRING; the oracle has its own asset test, and parsing two megabytes of
// array literal per worker is pure cost.
//
// IT HOLDS EVERY SIDE OF EVERY FIXTURE, which is what the synonym devices cost: verify step 12 runs
// the lexicon over every CUE TOKEN and every PART TEXT, and step 12b runs it over every definition
// token that is not a connective. A word missing here is an `unknown-part-word` or
// `unknown-definition-word` rejection, which reads in a failing row as "the generator dropped it"
// rather than "the fixture was not spelled out".
jest.mock('../../../../src/generators/crypticclue/data/known-words', () => ({
  knownWords: [
    'active',
    'animal',
    'bastard',
    'brandy',
    'building',
    'car',
    'covering',
    'departed',
    'enclosure',
    'enormous',
    'floor',
    'functioning',
    'fully',
    'governmental',
    'headquarters',
    'identifier',
    'imposing',
    'label',
    'mark',
    'on',
    'pen',
    'pet',
    'quill',
    'remaining',
    'spirit',
    'still',
    'tag',
    'vehicle',
  ],
}))

// A deterministic shortlist of exactly SHORTLIST_SIZE entries, holding every answer the fixtures
// below actually encode. drawAnswers samples 40 of 1,395 lemmas at random and is pinned by its own
// suite; what this file needs is a shortlist hand-written clues can be verified against.
const shortlist = (excluded: ReadonlySet<string> = new Set()): ReadonlyMap<string, string> =>
  new Map(
    ['CARPET', 'PENTAGON', 'BRAND', 'LEFT']
      .concat(Array.from({ length: SHORTLIST_SIZE - 4 }, (_unused, index) => `WORD${index}`))
      .filter((word) => !excluded.has(word))
      .map((word) => [word, word]),
  )

/*
 * ONE FIXTURE PER DEVICE, AND EVERY ONE OF THEM VERIFIES. These are not hand-shaped objects handed
 * to a builder: each goes through verifyClue on the nightly path, so a fixture that does not
 * decompose reports as a generator that dropped a candidate. Each was checked against the cover --
 * every token is inside the definition, inside a cue, or one of at most two connectives.
 *
 *   charade-2  `Floor covering from vehicle with animal`  CAR + PET = CARPET, seams FROM and WITH
 *   charade-3  `Building from quill label active`         PEN + TAG + ON = PENTAGON, seam FROM
 *   deletion   `Endless spirit is a mark`                 BRANDY less its last letter = BRAND, seam IS
 *   double     `Departed and still remaining`             two senses of LEFT, seam AND
 *
 * THE DOUBLE DEFINITION SAYS `and` WHERE THE PROMPT'S OWN EXAMPLE SAYS `but`, and that is not a
 * stylistic edit: BUT is not a member of CONNECTIVES, so `Departed but still remaining` is
 * `residue-out-of-position` and would have made this fixture a rejection row wearing a builder's
 * clothes.
 */
const charade = (overrides: Record<string, unknown> = {}) => ({
  answer: 'CARPET',
  clue: 'Floor covering from vehicle with animal',
  definition: 'Floor covering',
  device: 'charade',
  parts: [
    { cue: 'vehicle', text: 'CAR' },
    { cue: 'animal', text: 'PET' },
  ],
  ...overrides,
})

const threePartCharade = (overrides: Record<string, unknown> = {}) => ({
  answer: 'PENTAGON',
  clue: 'Building from quill label active',
  definition: 'Building',
  device: 'charade',
  parts: [
    { cue: 'quill', text: 'PEN' },
    { cue: 'label', text: 'TAG' },
    { cue: 'active', text: 'ON' },
  ],
  ...overrides,
})

const deletion = (overrides: Record<string, unknown> = {}) => ({
  answer: 'BRAND',
  clue: 'Endless spirit is a mark',
  definition: 'a mark',
  device: 'deletion',
  indicator: 'Endless',
  removal: 'last',
  source: { cue: 'spirit', text: 'BRANDY' },
  ...overrides,
})

const doubleDefinition = (overrides: Record<string, unknown> = {}) => ({
  answer: 'LEFT',
  clue: 'Departed and still remaining',
  definitions: ['Departed', 'still remaining'],
  device: 'doubledefinition',
  ...overrides,
})

/*
 * A CLUE THAT VERIFIES AND WHOSE REVEAL DOES NOT FIT, which is the one shape that separates a failed
 * explanation from a failed clue. The definition is four tokens (the cap), the cues are long, and one
 * of them is two words, so the composed reveal --
 * `"Enormous imposing governmental headquarters" = PEN (enclosure) + TAG (identifier) + ON (fully
 * functioning)` -- is 107 characters against MAX_EXPLANATION_LENGTH of 100. The clue itself is 86,
 * comfortably inside MAX_CLUE_LENGTH, which is the point: nothing else about it is wrong.
 */
const unrevealableCharade = () =>
  threePartCharade({
    clue: 'Enormous imposing governmental headquarters from enclosure identifier fully functioning',
    definition: 'Enormous imposing governmental headquarters',
    parts: [
      { cue: 'enclosure', text: 'PEN' },
      { cue: 'identifier', text: 'TAG' },
      { cue: 'fully functioning', text: 'ON' },
    ],
  })

const pack = (answer: string): Pack => ({
  complete: false,
  date: '2026-10-02',
  puzzles: [
    {
      data: { answer },
      difficulty: 3,
      estimatedSeconds: 120,
      id: '2026-10-02:crypticclue:abcd1234',
      type: 'crypticclue',
    } as Puzzle,
  ],
})

type CrypticRequest = BatchRequest<unknown, Candidate<CrypticClueData> & { answer: string }>

describe('crypticClueGenerator', () => {
  const mockRequestBatch = jest.mocked(requestBatch)
  const mockDrawAnswers = jest.mocked(drawAnswers)
  const mockReviewClues = jest.mocked(reviewClues)

  // What the faked model call comes back with, set by `fetch` below.
  let returned: unknown[] = []

  // Shared defaults, per CLAUDE.md. requestBatch is faked faithfully enough that `accept` really
  // runs over the elements a call returns -- which is what makes the funnel counts below a
  // measurement of the generator rather than of the fixture.
  beforeAll(() => {
    mockDrawAnswers.mockImplementation(shortlist)
    mockRequestBatch.mockImplementation(async (request) =>
      returned.map((item) => request.accept(item)).filter((item) => item !== undefined),
    )
    // The identity, which is also what the real reviewClues returns when the call fails. Rows that
    // exercise a drop or a fix override it per test.
    mockReviewClues.mockImplementation(async (clues) => clues)
  })

  const request = (): CrypticRequest => mockRequestBatch.mock.calls[0][0] as CrypticRequest

  const fetch = (
    count: number,
    recent: { puzzles: Puzzle[] }[] = [],
    items: unknown[] = [],
  ): Promise<Candidate<CrypticClueData>[]> => {
    returned = items
    return crypticClueGenerator.fetchCandidates(count, recent)
  }

  describe('the tool schema', () => {
    it('describes the top level and nothing below it', () => {
      expect(Object.keys(crypticTool.input_schema).sort()).toStrictEqual(['properties', 'required', 'type'])
      expect(crypticTool.input_schema.properties.clues).toStrictEqual({ items: {}, type: 'array' })
    })

    // Under an opaque element the description is the ONLY thing that specifies a clue to the model,
    // and it must agree with prompts/create-cryptic-clues.txt field for field. A field named in one
    // and not the other is a field half the batch gets wrong.
    it.each([
      ['`answer`'],
      ['`clue`'],
      ['`device`'],
      ['`gloss`'],
      ['`definition`'],
      ['`parts`'],
      ['`indicator`'],
      ['`removal`'],
      ['`source`'],
      ['`definitions`'],
      ['"charade"'],
      ['"deletion"'],
      ['"doubledefinition"'],
    ])('names %s, which the schema no longer describes', (fragment) => {
      expect(crypticTool.description).toContain(fragment)
    })

    // THE TWO CUE RULES, which are the two the verifier gained with these devices
    // (`cue-too-long`, `connective-in-cue`). A model told neither writes `bird of prey` and
    // `vehicle carrying nothing at all`, and both are rejections rather than clues.
    it('states both cue rules the verifier enforces', () => {
      expect(crypticTool.description).toContain('THREE WORDS')
      expect(crypticTool.description).toContain('NO LINKING WORD')
    })

    // The retired devices, asserted ABSENT rather than left to the rows above. A description that
    // still offered `hidden` would spend a batch on clues the verifier rejects at step 3, and every
    // row above it would still pass.
    it.each([['hidden'], ['anagram'], ['fodder']])('no longer offers %s', (retired) => {
      expect(crypticTool.description).not.toContain(retired)
    })
  })

  describe('fetchCandidates', () => {
    it('asks for eight candidates per puzzle', async () => {
      await fetch(1)

      expect(request().asked).toEqual(8)
      expect(request().context.clueCount).toEqual(8)
    })

    it('scales the over-ask with the count asked of it', async () => {
      await fetch(2)

      expect(request().asked).toEqual(16)
    })

    it('reads the recent packs through the narrowed exclusion reader', async () => {
      await fetch(1, [pack('CARPET')])

      expect(request().context.crypticAnswersAlreadyUsed).toStrictEqual(['CARPET'])
      // ACTUALLY PASSED. An earlier design claimed keyOf collapsed candidates "against the
      // exclusions" and never passed the field that does it.
      expect(request().excludedKeys).toStrictEqual(new Set(['CARPET']))
    })

    it('draws its shortlist against the same exclusions', async () => {
      await fetch(1, [pack('CARPET')])

      expect(mockDrawAnswers).toHaveBeenCalledWith(new Set(['CARPET']))
      expect(request().context.answerChoices).not.toContain('CARPET')
    })

    // KEYED BY REMOVAL KIND, which is the shape verify step 8 gates on: a model handed one flat list
    // would write `endless` on a clue that beheads and have it rejected for saying so.
    it('supplies the whole shortlist and the deletion indicators by removal kind', async () => {
      await fetch(1)

      expect(request().context.answerChoices).toHaveLength(SHORTLIST_SIZE)
      expect(request().context.deletionIndicators).toStrictEqual({
        first: expect.arrayContaining(['beheaded']),
        last: expect.arrayContaining(['endless']),
        middle: expect.arrayContaining(['heartless']),
      })
      expect(request().context.connectives).toContain('OF')
    })

    // The charset is NOT in the context object. The prompt text states it, and a second copy here is
    // a second place for it to drift out of agreement with CLUE_CHARSET.
    it('does not put the charset in the context', async () => {
      await fetch(1)

      expect(JSON.stringify(request().context)).not.toContain('A-Za-z')
    })

    it('names the prompt and the tool it was built for', async () => {
      await fetch(1)

      expect(request().tool).toBe(crypticTool)
      expect(request().type).toEqual('crypticclue')
    })

    it('reads the clues out of the payload, and an absent key as no clues', async () => {
      await fetch(1)

      expect(request().itemsOf({ clues: [1, 2] })).toStrictEqual([1, 2])
      expect(request().itemsOf({})).toStrictEqual([])
      expect(request().itemsOf(undefined)).toStrictEqual([])
    })

    it('costs one candidate rather than the batch when one is bad', async () => {
      const kept = await fetch(1, [], [charade({ clue: 'Floor covering from vehicle with animal ,' }), charade()])

      expect(kept).toHaveLength(1)
    })

    it('collapses two clues on one answer', async () => {
      const kept = await fetch(1, [], [charade()])

      expect(request().keyOf(kept[0] as Candidate<CrypticClueData> & { answer: string })).toEqual('CARPET')
    })

    /*
     * THE DIAL, and it is the only thing that makes this type's second daily puzzle a different
     * puzzle rather than a second copy of the first. It COUNTS UNKNOWNS AND SIGNPOSTS: a deletion has
     * one unknown and an indicator that names the operation; a two-part charade has two unknowns and
     * no signpost at all; a three-part charade has three; a double definition has no letter mechanics
     * whatever and a device the player must first recognize.
     *
     * BAND 5 TAKES TWO DEVICES ON PURPOSE. This type can starve a band on DEVICE MIX rather than on
     * clue quality, so one device per band is the hazard rather than the tidy answer -- a night with
     * no usable double definition still fills band 5 from a three-part charade.
     *
     * ONE BAND EACH, ASSERTED AS toStrictEqual RATHER THAN toContain. A candidate usable at both
     * bands is one the selection loop can spend anywhere, and a run of deletions would then fill band
     * 5 with the type's gentlest shape -- which is a `toContain` passing over the exact failure the
     * dial exists to prevent.
     */
    it.each([
      ['deletion', deletion(), 3],
      ['two-part charade', charade(), 3],
      ['three-part charade', threePartCharade(), 5],
      ['double definition', doubleDefinition(), 5],
    ])('bands a %s at difficulty %i and nothing else', async (_device, raw, difficulty) => {
      const kept = await fetch(2, [], [raw])

      expect(kept[0].usableAt).toStrictEqual([difficulty])
    })

    // The band reaches estimatedSeconds through the contribution's own base and step, so the band-5
    // puzzle is longer on the shelf as well as harder in the hand. Derived rather than pinned to a
    // literal, so a change to either constant moves this and the registry's ceiling assertion
    // together.
    it('estimates the harder band from the contribution rather than from a literal', async () => {
      const { baseSeconds, secondsPerDifficulty } = crypticClueContribution
      const kept = await fetch(2, [], [doubleDefinition()])

      expect((await kept[0].build('2026-10-02', 5, () => 'abcd1234')).estimatedSeconds).toEqual(
        baseSeconds + secondsPerDifficulty * 4,
      )
    })

    /*
     * A FAILED EXPLANATION COSTS THE PUZZLE, where a failed gloss costs one rung. The clue itself is
     * impeccable -- it decomposes, every token is covered, the ladder builds -- and it still does not
     * ship, because a player who solves it and taps to reveal would get nothing: CAR and BRANDY are
     * not written in the clue, so there is no fallback the client could compose itself.
     *
     * IT IS INVISIBLE IN THE FUNNEL, and that is asserted rather than merely true. `rejections` counts
     * verifier codes and `verified` counts what reached toCandidate's end, so an explanation drop
     * shows up as `returned: 1, verified: 0, rejections: {}` -- a gap with no reason beside it. The
     * `Dropped a cryptic explanation` line is the only instrument that names it, which is why this row
     * asserts the line and not just the empty result.
     */
    it('drops a candidate whose explanation cannot fit its cap', async () => {
      const kept = await fetch(1, [], [unrevealableCharade()])

      expect(kept).toStrictEqual([])
      expect(log).toHaveBeenCalledWith('Dropped a cryptic explanation', {
        answer: 'PENTAGON',
        length: 107,
        reason: 'explanation-gate',
        type: 'crypticclue',
      })
      expect(log).toHaveBeenCalledWith(
        'Fetched cryptic clues',
        expect.objectContaining({ kept: 0, rejections: {}, returned: 1, verified: 0 }),
      )
    })

    // The funnel is a DELIVERABLE rather than telemetry garnish: the cheap kill criterion reads it,
    // and the per-reason counts are what turn "the model is bad at cryptics" into a clause to argue
    // about. It is a `log` because this type declares bestEffort -- a short cryptic night is a
    // declared-acceptable outcome, and a second ERROR into a stack whose only alarm channel is a
    // level="ERROR" subscription is exactly the noise that design exists to avoid.
    it('logs the funnel on one line, at log rather than logError', async () => {
      await fetch(1, [], [charade()])

      expect(log).toHaveBeenCalledWith('Fetched cryptic clues', {
        asked: 8,
        glossed: 0,
        kept: 1,
        rejections: {},
        returned: 1,
        reviewDropped: 0,
        type: 'crypticclue',
        verified: 1,
      })
      expect(logError).not.toHaveBeenCalled()
    })

    // `verified` counts what the DECOMPOSITION accepted and `kept` counts what SHIPS, and
    // `reviewDropped` is what names the review's share of the gap. It is NOT the only thing that can
    // open one: requestBatch dedupes on the normalized answer AFTER `accept` returns, so two clues
    // for the same word separate the two figures with `reviewDropped: 0`. An operator reading a
    // `verified > kept` gap has three candidate causes -- the dedupe, the reviewer, and a dropped
    // explanation -- and this field is how they tell the second from the others.
    it('reports a reviewer drop as its own funnel figure, not as a rejection', async () => {
      mockReviewClues.mockResolvedValueOnce([])

      const kept = await fetch(1, [], [charade()])

      expect(kept).toStrictEqual([])
      expect(log).toHaveBeenCalledWith(
        'Fetched cryptic clues',
        expect.objectContaining({ kept: 0, rejections: {}, reviewDropped: 1, verified: 1 }),
      )
    })

    it('hands the reviewer the verified clues rather than the built candidates', async () => {
      await fetch(1, [], [charade()])

      expect(mockReviewClues).toHaveBeenCalledWith([
        expect.objectContaining({ answer: 'CARPET', clue: 'Floor covering from vehicle with animal' }),
      ])
    })

    // THE GLOSS THE REVIEWER READS IS THE GLOSS THE PLAYER WOULD HAVE SEEN, which is what the gate
    // moving into `accept` buys. Before it moved, review.ts sent the RAW model string to a second
    // Bedrock call under a prompt calling it "the first hint the player is shown" -- so a gloss the
    // gates had already dropped still arrived looking shippable, and a reviewer judging a rung
    // nobody will ever see has no reason to return the `fix` that would restore one. It was also the
    // only field on VerifiedClue reaching a model with no length bound.
    //
    // ONE ROW PER GATE, because a gate that quietly stops firing is invisible to a row that only
    // exercises the common case, and these four are the whole of gatedGloss.
    //
    // THE REASON IS ASSERTED, NOT JUST THE ABSENCE, and that is what makes "one row per gate" a
    // pinned property rather than a comment: `toBeUndefined` alone passes for any gloss the gate
    // rejects for any reason, so a gate that stopped firing would still pass its row on another
    // gate's rejection. The first two rows SHARE `gloss-gate` -- the length cap and the answer-leak
    // row both live inside one passesStringGates call -- which is the arithmetic behind gatedGloss'
    // "seven rows in three gate checks", and is exactly why the row names cannot be trusted to the
    // fixtures alone.
    it.each([
      ['runs past the length cap', 'x'.repeat(MAX_GLOSS_LENGTH + 1), 'gloss-gate'],
      ['names the answer', 'A carpet is soft underfoot.', 'gloss-gate'],
      ['carries an inflection of the answer', 'Carpets keep a room warm.', 'gloss-inflection'],
      ['restates the definition', 'A covering for a room.', 'gloss-restates-definition'],
    ])('hands the reviewer no gloss at all when the gloss %s', async (_case, gloss, reason) => {
      await fetch(1, [], [charade({ gloss })])

      expect(mockReviewClues.mock.calls[0][0][0].gloss).toBeUndefined()
      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'CARPET',
        reason,
        source: 'generator',
        type: 'crypticclue',
      })
    })

    // THE UNION OF BOTH HALVES, and this row is what holds `accept`'s definition derivation equal to
    // the one inside buildHints. The gloss restates the SECOND definition and nothing else, so a
    // derivation that read only `definitionSpans[0]` -- or destructured a `definitionSpan` that does
    // not exist on this arm -- keeps it. The second half is the one the player is likelier to be
    // stuck on, since the first is the one they have already tried to read as a definition.
    it('gates a double definition gloss against both halves, not only the first', async () => {
      await fetch(1, [], [doubleDefinition({ gloss: 'Remaining behind after the others go.' })])

      expect(mockReviewClues.mock.calls[0][0][0].gloss).toBeUndefined()
      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'LEFT',
        reason: 'gloss-restates-definition',
        source: 'generator',
        type: 'crypticclue',
      })
    })

    it('hands the reviewer a gloss that passes its gates, unchanged', async () => {
      await fetch(1, [], [charade({ gloss: 'Woven, warm, and rolled out across a room.' })])

      expect(mockReviewClues.mock.calls[0][0][0].gloss).toEqual('Woven, warm, and rolled out across a room.')
    })

    // THE GATE NOW RUNS TWICE on this path -- once in `accept`, once inside buildHints -- and the
    // second call MUST stay, because buildHints is the only entry point to a ladder and a builder
    // that trusts its caller ships an ungated rung the day someone adds a second caller. It is free
    // rather than merely cheap: a dropped gloss arrives at the second call as `undefined` and
    // returns above every drop(). Measured here rather than asserted in a comment, because the
    // alternative someone reaches for on seeing a doubled line is a `quiet` flag threaded through a
    // pure gate.
    it('logs a dropped gloss exactly once, however many times the gate runs', async () => {
      await fetch(1, [], [charade({ gloss: 'A covering for a room.' })])

      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'CARPET',
        reason: 'gloss-restates-definition',
        source: 'generator',
        type: 'crypticclue',
      })
      expect(jest.mocked(log).mock.calls.filter(([message]) => message === 'Dropped a cryptic gloss')).toHaveLength(1)
    })

    // THE ROW THAT WOULD CATCH A STALE LADDER. `build` closes over the VerifiedClue it was made
    // from, so a reviewer-replaced gloss that does not go back through toCandidate ships a ladder
    // composed from the ORIGINAL gloss -- a puzzle whose first hint is the sentence the reviewer
    // rejected, with nothing anywhere to show it happened.
    it('rebuilds the ladder when the reviewer replaces a gloss', async () => {
      const withGloss = (gloss: string): VerifiedClue => ({
        ...(verifyClue(
          charade({ gloss: 'Underfoot, and it muffles a step.' }),
          shortlist(),
          () => true,
        ) as VerifiedClue),
        gloss,
      })
      mockReviewClues.mockResolvedValueOnce([withGloss('Woven, warm, and rolled out across a room.')])

      const [candidate] = await fetch(1, [], [charade({ gloss: 'Underfoot, and it muffles a step.' })])
      const puzzle = await candidate.build('2026-10-02', 3, () => 'abcd1234')

      expect(puzzle.data.hints[0].text).toEqual('Woven, warm, and rolled out across a room.')
    })

    // THE TRANSITION THE MOVED GATE MAKES REACHABLE, and the reason the move is worth making rather
    // than only worth noting: `undefined -> string`. A dropped gloss now reaches the reviewer absent
    // instead of disguised as shippable, so a `fix` CREATES the type's only semantic rung rather
    // than replacing one -- and the rebuild guard needs no new arm for it, since a candidate built
    // with no gloss and a clue returned with one differ under the VALUE comparison exactly as a
    // replacement does. Without the rebuild this ships the backfilled ladder and the fix is lost
    // silently.
    it('creates the rung when the reviewer fixes a gloss that was dropped', async () => {
      const dropped = charade({ gloss: 'A covering for a room.' })
      const fixed: VerifiedClue = {
        ...(verifyClue(dropped, shortlist(), () => true) as VerifiedClue),
        gloss: 'Underfoot, and it muffles a step.',
      }
      mockReviewClues.mockResolvedValueOnce([fixed])

      const [candidate] = await fetch(1, [], [dropped])
      const puzzle = await candidate.build('2026-10-02', 3, () => 'abcd1234')

      expect(puzzle.data.hints[0].text).toEqual('Underfoot, and it muffles a step.')
    })

    it('counts each rejection under its own reason code', async () => {
      await fetch(
        1,
        [],
        [charade({ clue: 'Floor covering from vehicle with animal quickly' }), charade({ answer: 'WALTZ' })],
      )

      expect(log).toHaveBeenCalledWith(
        'Fetched cryptic clues',
        expect.objectContaining({
          kept: 0,
          rejections: { 'answer-not-on-shortlist': 1, 'residue-out-of-position': 1 },
          returned: 2,
          verified: 0,
        }),
      )
    })

    it('rejects a cue word the membership oracle does not know', async () => {
      const kept = await fetch(
        1,
        [],
        [
          charade({
            clue: 'Floor covering from vehiclex with animal',
            parts: [
              { cue: 'vehiclex', text: 'CAR' },
              { cue: 'animal', text: 'PET' },
            ],
          }),
        ],
      )

      expect(kept).toStrictEqual([])
    })

    // The clue's own G1-G4 pass, which verify.ts does not make: G4, the charged-term check, has no
    // counterpart in the verifier at all, and the definition rung and the explanation both quote
    // slices of this string.
    it('rejects a clue carrying a charged term, which no verifier clause catches', async () => {
      const kept = await fetch(
        1,
        [],
        [charade({ clue: 'Bastard covering from vehicle with animal', definition: 'Bastard covering' })],
      )

      expect(kept).toStrictEqual([])
    })
  })

  describe('build', () => {
    const built = async (
      raw: Record<string, unknown> = charade(),
      difficulty: 3 | 5 = 3,
    ): Promise<Puzzle<CrypticClueData>> => {
      const kept = await fetch(1, [], [raw])
      return (await kept[0].build('2026-10-02', difficulty, () => 'abcd1234')) as Puzzle<CrypticClueData>
    }

    it('stamps the id, the type and the estimated seconds', async () => {
      expect(await built()).toEqual(
        expect.objectContaining({
          difficulty: 3,
          estimatedSeconds: 120,
          id: '2026-10-02:crypticclue:abcd1234',
          type: 'crypticclue',
        }),
      )
    })

    // Derived rather than pinned to a literal, so a change to either constant on the contribution
    // moves this and the registry's ceiling assertion together.
    it('derives estimatedSeconds from the contribution rather than from a literal', async () => {
      const { baseSeconds, secondsPerDifficulty } = crypticClueContribution

      expect((await built()).estimatedSeconds).toEqual(baseSeconds + secondsPerDifficulty * 2)
    })

    it('ships the code-supplied answer, never the model spelling of it', async () => {
      expect((await built(charade({ answer: 'carpet' }))).data.answer).toEqual('CARPET')
    })

    it('derives the enumeration from the answer', async () => {
      expect((await built()).data.enumeration).toStrictEqual([6])
    })

    // ONE ROW PER DEVICE, over the field that REPLACED the two spans and `device`. It is the whole
    // post-solve reveal, and under these devices it is the only thing that can tell the player how
    // the clue worked: CAR, PET and BRANDY are not written in the clue, so no amount of re-reading
    // the surface produces the decomposition.
    it.each([
      ['charade', charade(), '"Floor covering" = CAR (vehicle) + PET (animal)'],
      ['three-part charade', threePartCharade(), '"Building" = PEN (quill) + TAG (label) + ON (active)'],
      ['deletion', deletion(), '"a mark" = BRANDY (spirit) minus its last letter'],
      ['double definition', doubleDefinition(), 'Two definitions: "Departed" and "still remaining"'],
    ])('ships the composed reveal for a %s', async (_device, raw, expected) => {
      expect((await built(raw, 5)).data.explanation).toEqual(expected)
    })

    // ABSENT BY DESIGN rather than hidden: the definition half IS the category, it is always on the
    // wire because it is inside the clue, and hiding it is not available.
    it('ships no category, by design rather than by omission', async () => {
      expect('category' in (await built()).data).toBe(false)
    })

    // THE THREE FIELDS THAT CAME OFF THE WIRE, asserted absent rather than assumed gone. None of
    // them survives these devices on its own terms -- a charade's parts are two or three spans and
    // CAR is in none of them, a deletion's BRANDY is not in the clue at all, and a double definition
    // has two definitions and no wordplay half -- and a span with no renderer rots.
    it.each([['definitionSpan'], ['device'], ['fodderSpan'], ['indicatorSpan']])(
      'ships no %s, because nothing renders one',
      async (field) => {
        expect(field in (await built()).data).toBe(false)
      },
    )

    // The fixture clue is `Floor covering from vehicle with animal`: it carries no indicator, so the
    // device rung is new information, and its definition is two words, so quoting it says WHICH words
    // define the answer. With no gloss the ladder is three facts the player did not have, and the
    // complete solve -- `The answer is CAR + PET.` -- stays in the pool, unreached. hints.test.ts owns
    // the rule; this row proves the generator ships what the rule produces.
    it('ships three rungs, none of them restating the clue and none of them the whole answer', async () => {
      const { hints } = (await built()).data

      expect(hints.map((hint) => hint.text)).toStrictEqual([
        'The answer is built from two or more shorter words, one after the other.',
        'The definition is "Floor covering".',
        'The first part is CAR.',
      ])
    })

    /*
     * THE STORED-CLUE ROUND-TRIP -- one of the two most important tests in this change, and it
     * survives the spans leaving the wire because it never was about the wire. `explanation` and
     * every quoting rung are composed from slices taken against spans computed over THIS string, so
     * any future normalization on the way out -- a trim, a whitespace collapse, a re-encode -- ships
     * a reveal quoting words the clue no longer holds at those offsets. Nothing else would catch it:
     * the composed strings still typecheck and still render SOMETHING.
     *
     * Insert a .trim() on the clue written into `data`, give the fixture a leading space, and the
     * re-verification below is what goes red -- because verify step 0 rejects a clue differing from
     * its own trim, so a stored clue that still verifies is a stored clue nobody rewrote.
     */
    it('round-trips the clue and the reveal through a serialized-and-parsed data', async () => {
      const stored = JSON.parse(JSON.stringify((await built()).data)) as CrypticClueData

      expect(stored.clue).toEqual('Floor covering from vehicle with animal')
      expect(stored.explanation).toEqual('"Floor covering" = CAR (vehicle) + PET (animal)')
      expect(verifyClue(charade({ clue: stored.clue }), shortlist(), () => true)).toBeDefined()
    })
  })
})
