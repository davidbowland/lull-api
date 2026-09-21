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
// Mocked because an unmocked reviewClues reaches getPromptById, fails into its own catch and returns
// its input -- so every row here would pass for the wrong reason.
jest.mock('@generators/crypticclue/review')
jest.mock('@generators/crypticclue/answers', () => ({
  SHORTLIST_SIZE: 40,
  drawAnswers: jest.fn(),
}))

// The 152,206-entry membership slice replaced with the words these fixtures use; the oracle has its
// own asset test. Verify steps 12 and 12b run the lexicon over every cue token, every part text and
// every non-connective definition token, so a word missing here reads as a dropped candidate.
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

// A deterministic shortlist of exactly SHORTLIST_SIZE entries holding every answer the fixtures
// encode; the real drawAnswers samples at random and is pinned by its own suite.
const shortlist = (excluded: ReadonlySet<string> = new Set()): ReadonlyMap<string, string> =>
  new Map(
    ['CARPET', 'PENTAGON', 'BRAND', 'LEFT']
      .concat(Array.from({ length: SHORTLIST_SIZE - 4 }, (_unused, index) => `WORD${index}`))
      .filter((word) => !excluded.has(word))
      .map((word) => [word, word]),
  )

// One fixture per device, and each goes through verifyClue on the nightly path, so a fixture that
// does not decompose reports as a generator that dropped a candidate. The double definition joins
// with `and` because BUT is not in CONNECTIVES: `but` makes it a `residue-out-of-position` rejection.
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

// A clue that verifies and whose reveal does not fit, which is the one shape separating a failed
// explanation from a failed clue. A four-token definition and long cues put the composed reveal at
// 107 characters against MAX_EXPLANATION_LENGTH of 100, while the clue itself is 86.
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

  // The fake runs `accept` over what a call returns, so the funnel counts measure the generator.
  beforeAll(() => {
    mockDrawAnswers.mockImplementation(shortlist)
    mockRequestBatch.mockImplementation(async (request) =>
      returned.map((item) => request.accept(item)).filter((item) => item !== undefined),
    )
    // The identity, which is also what the real reviewClues returns when the call fails.
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

    // Under an opaque element the description is the only spec the model gets, and it must agree
    // with prompts/create-cryptic-clues.txt field for field.
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

    // A model told neither writes `bird of prey`, which is a `cue-too-long` rejection, not a clue.
    it('states both cue rules the verifier enforces', () => {
      expect(crypticTool.description).toContain('THREE WORDS')
      expect(crypticTool.description).toContain('NO LINKING WORD')
    })

    // A description still offering `hidden` spends a batch on clues verify step 3 rejects.
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
      expect(request().excludedKeys).toStrictEqual(new Set(['CARPET']))
    })

    it('draws its shortlist against the same exclusions', async () => {
      await fetch(1, [pack('CARPET')])

      expect(mockDrawAnswers).toHaveBeenCalledWith(new Set(['CARPET']))
      expect(request().context.answerChoices).not.toContain('CARPET')
    })

    // Verify step 8 gates on removal kind: a model handed one flat list writes `endless` on a clue
    // that beheads.
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

    // The prompt states the charset; a copy in the context is a second place to drift from it.
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

    // Band 5 takes two devices so a night with no double definition can still fill it. toStrictEqual
    // rather than toContain: a candidate usable at both bands lets deletions fill the harder band.
    it.each([
      ['deletion', deletion(), 3],
      ['two-part charade', charade(), 3],
      ['three-part charade', threePartCharade(), 5],
      ['double definition', doubleDefinition(), 5],
    ])('bands a %s at difficulty %i and nothing else', async (_device, raw, difficulty) => {
      const kept = await fetch(2, [], [raw])

      expect(kept[0].usableAt).toStrictEqual([difficulty])
    })

    it('estimates the harder band from the contribution rather than from a literal', async () => {
      const { baseSeconds, secondsPerDifficulty } = crypticClueContribution
      const kept = await fetch(2, [], [doubleDefinition()])

      expect((await kept[0].build('2026-10-02', 5, () => 'abcd1234')).estimatedSeconds).toEqual(
        baseSeconds + secondsPerDifficulty * 4,
      )
    })

    // A failed explanation costs the whole puzzle, where a failed gloss costs one rung. The drop is
    // invisible in the funnel (`verified: 0, rejections: {}`), so the log line is asserted too.
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

    // `log`, not `logError`: this type declares bestEffort, so a short cryptic night is acceptable.
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
        wordGlossed: 0,
      })
      expect(logError).not.toHaveBeenCalled()
    })

    // `wordGlossed` counts the raw field; `glossed` counts the survivor of its gate in `accept`.
    it('counts the clues that arrived with each model string', async () => {
      await fetch(
        1,
        [],
        [charade({ gloss: 'Woven, warm, and rolled out across a room.', wordGloss: 'a thing driven on roads' })],
      )

      expect(log).toHaveBeenCalledWith('Fetched cryptic clues', expect.objectContaining({ glossed: 1, wordGlossed: 1 }))
    })

    // A `verified > kept` gap can also come from the upstream dedupe or a dropped explanation, so
    // `reviewDropped` is what names the reviewer's share of it.
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

    // One row per gate in gatedGloss, asserting the reason rather than only the absence, since
    // `toBeUndefined` alone passes on any other gate's rejection. The first two rows share
    // `gloss-gate` because the length cap and the answer leak are one passesStringGates call.
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

    // The gloss restates only the second definition, so a derivation reading `definitionSpans[0]`
    // alone -- or a `definitionSpan` this arm does not have -- would keep it.
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

    // The gate runs twice, in `accept` and inside buildHints, which keeps its own call because a
    // builder trusting its caller ships an ungated rung the day a second caller appears.
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

    // `build` closes over the VerifiedClue it was made from, so a reviewer-replaced gloss that does
    // not go back through toCandidate ships a ladder opening on the sentence the reviewer rejected.
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

    // The `undefined -> string` transition: a dropped gloss reaches the reviewer absent, so a `fix`
    // creates the type's only semantic rung rather than replacing one. Without the rebuild it is lost.
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

    // G4, the charged-term check, has no counterpart in verify.ts, and the definition rung and the
    // explanation both quote slices of this string.
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

    // Derived so a change to either constant moves this and the registry's ceiling assertion together.
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

    // The reveal is all the player gets: CAR, PET and BRANDY are nowhere in the clue.
    it.each([
      ['charade', charade(), '"Floor covering" = CAR (vehicle) + PET (animal)'],
      ['three-part charade', threePartCharade(), '"Building" = PEN (quill) + TAG (label) + ON (active)'],
      ['deletion', deletion(), '"a mark" = BRANDY (spirit) minus its last letter'],
      ['double definition', doubleDefinition(), 'Two definitions: "Departed" and "still remaining"'],
    ])('ships the composed reveal for a %s', async (_device, raw, expected) => {
      expect((await built(raw, 5)).data.explanation).toEqual(expected)
    })

    // The definition half is the category, and it is always on the wire because it is in the clue.
    it('ships no category, by design rather than by omission', async () => {
      expect('category' in (await built()).data).toBe(false)
    })

    // None of these survives the device set -- a deletion's BRANDY is not in the clue at all -- and
    // a span with no renderer rots.
    it.each([['definitionSpan'], ['device'], ['fodderSpan'], ['indicatorSpan']])(
      'ships no %s, because nothing renders one',
      async (field) => {
        expect(field in (await built()).data).toBe(false)
      },
    )

    // The bare fixture carries neither model string: two structural rungs, complete solve last.
    it('ships the structural rungs alone when the model supplied no prose', async () => {
      const { hints } = (await built()).data

      expect(hints.map((hint) => hint.text)).toStrictEqual(['The first part is CAR.', 'The answer is CAR + PET.'])
    })

    // End to end through the generator: a sentence about the answer, a phrase about a word the clue
    // never prints, then the letters of that word.
    it('ships a gloss, a word gloss and the letters, in that order', async () => {
      const raw = charade({ gloss: 'Woven, warm, and rolled out across a room.', wordGloss: 'a thing driven on roads' })
      const { hints } = (await built(raw)).data

      expect(hints.map((hint) => hint.text)).toStrictEqual([
        'Woven, warm, and rolled out across a room.',
        'The first part is a thing driven on roads.',
        'The first part is CAR.',
      ])
    })

    // One row per device, because the frame is chosen by the discriminant and one arm ships wrong.
    it.each([
      ['charade', charade({ wordGloss: 'a thing driven on roads' }), 'The first part is a thing driven on roads.'],
      ['deletion', deletion({ wordGloss: 'a drink aged in oak' }), 'The longer word is a drink aged in oak.'],
      [
        'doubledefinition',
        doubleDefinition({ wordGloss: 'the side opposite right' }),
        'The answer also means the side opposite right.',
      ],
    ])('frames the %s word gloss into its own rung', async (_device, raw, expected) => {
      const { hints } = (await built(raw)).data

      expect(hints.map((hint) => hint.text)).toContain(expected)
    })

    // `explanation` and every quoting rung are sliced against spans over this exact string, so any
    // normalization on the way out ships a reveal quoting words the clue no longer holds at those
    // offsets, and still typechecks. Verify step 0 rejects a clue differing from its own trim.
    it('round-trips the clue and the reveal through a serialized-and-parsed data', async () => {
      const stored = JSON.parse(JSON.stringify((await built()).data)) as CrypticClueData

      expect(stored.clue).toEqual('Floor covering from vehicle with animal')
      expect(stored.explanation).toEqual('"Floor covering" = CAR (vehicle) + PET (animal)')
      expect(verifyClue(charade({ clue: stored.clue }), shortlist(), () => true)).toBeDefined()
    })
  })
})
