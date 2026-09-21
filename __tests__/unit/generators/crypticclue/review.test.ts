import { CRYPTIC_VERDICTS, crypticReviewTool, reviewClues } from '@generators/crypticclue/review'
import { VerifiedCharade, VerifiedDeletion, VerifiedDoubleDefinition } from '@generators/crypticclue/verify'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { Prompt } from '@types'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

// Every span below is a genuine offset into its own clue, and the context tests assert the slices.

// The default fixture: a charade, because it is the device with more than one cue, so a payload
// collapsing `parts` to a single pair shows up in every row rather than only in the charade row.
const charade = (overrides: Partial<VerifiedCharade> = {}): VerifiedCharade => ({
  answer: 'CARPET',
  clue: 'Floor covering from vehicle with animal',
  definitionSpan: { end: 14, start: 0 },
  device: 'charade',
  gloss: 'It softens a room underfoot.',
  parts: [
    { cueSpan: { end: 27, start: 20 }, text: 'CAR' },
    { cueSpan: { end: 39, start: 33 }, text: 'PET' },
  ],
  ...overrides,
})

const deletion = (overrides: Partial<VerifiedDeletion> = {}): VerifiedDeletion => ({
  answer: 'BRAND',
  clue: 'A mark from spirit cut short',
  definitionSpan: { end: 6, start: 0 },
  device: 'deletion',
  gloss: 'Burned onto cattle by a hot iron.',
  indicatorSpan: { end: 28, start: 19 },
  removal: 'last',
  source: { cueSpan: { end: 18, start: 12 }, text: 'BRANDY' },
  ...overrides,
})

const doubleDefinition = (overrides: Partial<VerifiedDoubleDefinition> = {}): VerifiedDoubleDefinition => ({
  answer: 'LEFT',
  clue: 'Departed and still remaining',
  definitionSpans: [
    { end: 8, start: 0 },
    { end: 28, start: 13 },
  ],
  device: 'doubledefinition',
  gloss: 'The opposite of the starboard side.',
  ...overrides,
})

describe('reviewClues', () => {
  const mockInvokeModel = jest.mocked(invokeModel)
  const mockGetPromptById = jest.mocked(getPromptById)

  beforeAll(() => {
    mockGetPromptById.mockResolvedValue({} as Prompt)
    mockInvokeModel.mockResolvedValue({ verdicts: [{ index: 0, verdict: 'keep' }] })
  })

  const context = (): Record<string, any> => mockInvokeModel.mock.calls[0][2] as Record<string, any>

  describe('the tool schema', () => {
    it('describes the top level and nothing below it', () => {
      expect(Object.keys(crypticReviewTool.input_schema).sort()).toStrictEqual(['properties', 'required', 'type'])
      expect(crypticReviewTool.input_schema.properties.verdicts).toStrictEqual({ items: {}, type: 'array' })
    })

    // Under an opaque element the description is the only spec the reviewer gets.
    it.each([...CRYPTIC_VERDICTS])('names the %s verdict the schema no longer describes', (verdict) => {
      expect(crypticReviewTool.description).toContain(verdict)
    })

    // Under `items: {}` nothing else holds the description and getModelContext in agreement.
    it.each([['parts'], ['source'], ['definitions'], ['removal'], ['definition']])(
      'names the %s field the payload sends',
      (field) => {
        expect(crypticReviewTool.description).toContain(field)
      },
    )

    it('tells the reviewer it may not rewrite the clue', () => {
      expect(crypticReviewTool.description).toContain(
        'Never rewrite the clue, the definition, the definitions, the parts, the source, the indicator or the answer.',
      )
    })

    it('says a fix sets only the gloss', () => {
      expect(crypticReviewTool.description).toContain('fix sets ONLY its gloss')
    })
  })

  describe('the context', () => {
    // The spans are withheld: the reviewer judges whether a cue means a word, and an offset only
    // invites it to reason about the proof. `text` is not a slice -- CAR is nowhere in the clue.
    it('sends a charade its definition and one cue-and-letters pair per part', async () => {
      await reviewClues([charade()])

      expect(context().clues[0]).toStrictEqual({
        answer: 'CARPET',
        clue: 'Floor covering from vehicle with animal',
        definition: 'Floor covering',
        device: 'charade',
        gloss: 'It softens a room underfoot.',
        index: 0,
        parts: [
          { cue: 'vehicle', text: 'CAR' },
          { cue: 'animal', text: 'PET' },
        ],
      })
    })

    // Without which end came off, "does `spirit` mean BRANDY" asks about a word the reviewer cannot
    // reconstruct from BRAND. The indicator is withheld: verify step 8 already decided it.
    it('sends a deletion its source and removal, and no indicator', async () => {
      await reviewClues([deletion()])

      expect(context().clues[0]).toStrictEqual({
        answer: 'BRAND',
        clue: 'A mark from spirit cut short',
        definition: 'A mark',
        device: 'deletion',
        gloss: 'Burned onto cattle by a hot iron.',
        index: 0,
        removal: 'last',
        source: { cue: 'spirit', text: 'BRANDY' },
      })
    })

    // Neither half is "the" definition and there is no wordplay, so no cue to judge.
    it('sends a double definition both halves and no wordplay key at all', async () => {
      await reviewClues([doubleDefinition()])

      expect(context().clues[0]).toStrictEqual({
        answer: 'LEFT',
        clue: 'Departed and still remaining',
        definitions: ['Departed', 'still remaining'],
        device: 'doubledefinition',
        gloss: 'The opposite of the starboard side.',
        index: 0,
      })
    })

    // Sliced from the clue, never from the model's part strings: the reviewer judges what verify proved.
    it('slices every cue out of the clue rather than trusting a second copy', async () => {
      await reviewClues([
        charade({
          parts: [
            { cueSpan: { end: 14, start: 0 }, text: 'CAR' },
            { cueSpan: { end: 27, start: 20 }, text: 'PET' },
          ],
        }),
      ])

      expect(context().clues[0].parts).toStrictEqual([
        { cue: 'Floor covering', text: 'CAR' },
        { cue: 'vehicle', text: 'PET' },
      ])
    })

    it('slices the definition out of the clue rather than trusting a second copy', async () => {
      await reviewClues([charade({ definitionSpan: { end: 27, start: 20 } })])

      expect(context().clues[0].definition).toEqual('vehicle')
    })

    // The index is the only handle a verdict has, so a per-device grouping would renumber them.
    it('numbers a mixed batch by position, not by device', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, verdict: 'keep' }] })

      await reviewClues([charade(), deletion(), doubleDefinition()])

      expect(context().clues.map((clue: Record<string, unknown>) => [clue.index, clue.device])).toStrictEqual([
        [0, 'charade'],
        [1, 'deletion'],
        [2, 'doubledefinition'],
      ])
    })

    // Asserted on the serialized form: the in-memory object does carry a `gloss` key holding
    // undefined and only JSON.stringify drops it, so `'gloss' in object` passes for the wrong reason.
    it('omits the key entirely for a gloss its gates dropped, rather than sending an empty one', async () => {
      await reviewClues([charade({ gloss: undefined })])

      expect(JSON.parse(JSON.stringify(context())).clues[0]).toStrictEqual({
        answer: 'CARPET',
        clue: 'Floor covering from vehicle with animal',
        definition: 'Floor covering',
        device: 'charade',
        index: 0,
        parts: [
          { cue: 'vehicle', text: 'CAR' },
          { cue: 'animal', text: 'PET' },
        ],
      })
    })

    it('makes no call at all for an empty batch', async () => {
      expect(await reviewClues([])).toStrictEqual([])
      expect(mockInvokeModel).not.toHaveBeenCalled()
    })
  })

  describe('verdicts', () => {
    it('keeps a clue the reviewer kept, unchanged', async () => {
      const original = charade()

      expect(await reviewClues([original])).toStrictEqual([original])
    })

    // Two clues, because dropping the only clue in a batch trips the dropped-everything guard below
    // and comes back unreviewed -- a one-clue fixture would assert the opposite of what it reads like.
    it('drops a clue the reviewer dropped, and logs why', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ index: 0, reason: 'vehicle does not mean CAT', verdict: 'drop' }],
      })

      expect(await reviewClues([charade(), charade({ answer: 'CARPORT' })])).toStrictEqual([
        charade({ answer: 'CARPORT' }),
      ])
      expect(log).toHaveBeenCalledWith('Reviewer dropped a cryptic clue', {
        answer: 'CARPET',
        clue: 'Floor covering from vehicle with animal',
        reason: 'vehicle does not mean CAT',
      })
    })

    // Two clues so one goes unjudged: judging none trips the guard below, a different event.
    it('keeps a clue the reviewer returned no verdict for', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 1, verdict: 'keep' }] })

      expect(await reviewClues([charade(), charade({ answer: 'CARPORT' })])).toHaveLength(2)
      expect(log).toHaveBeenCalledWith('Kept cryptic clues the reviewer returned no verdict for', { count: 1 })
    })

    // Verdicts indexVerdicts cannot address leave every clue `unjudged` and kept, and the summary
    // then prints what a healthy night prints -- so without the ERROR the check stops silently.
    it.each([
      ['keys them by the wrong field', [{ clueIndex: 0, verdict: 'keep' }]],
      ['returns bare strings', ['keep', 'keep']],
      ['returns an empty array', []],
    ])('raises an ERROR when the reviewer %s, judging nothing', async (_case, verdicts) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts })

      expect(await reviewClues([charade(), charade({ answer: 'CARPORT' })])).toHaveLength(2)
      expect(logError).toHaveBeenCalledWith('Reviewer judged no cryptic clue; keeping the batch unreviewed', {
        count: 2,
      })
    })

    // One usable verdict means the reviewer is alive, so the count rides on the summary line.
    it('reports partial garbage on the summary line rather than as an alarm', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, verdict: 'keep' },
          { clueIndex: 1, verdict: 'drop' },
        ],
      })

      await reviewClues([charade(), charade({ answer: 'CARPORT' })])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 2, unjudged: 1 })
      expect(logError).not.toHaveBeenCalled()
    })

    // Without the verdict-word check a `drop` arriving as `"DROP"` falls through into a silent keep.
    it.each([['DROP'], ['reject'], [null], [7]])(
      'ignores the unusable verdict %s rather than keeping silently',
      async (verdict) => {
        mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, verdict }] })

        await reviewClues([charade()])

        expect(log).toHaveBeenCalledWith('Ignored an unusable cryptic verdict', { index: 0, verdict })
      },
    )

    it.each([[-1], [1], [1.5], ['0']])('ignores a verdict addressed to index %s', async (index) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index, verdict: 'drop' }] })

      expect(await reviewClues([charade()])).toHaveLength(1)
    })

    it('ignores a second verdict for an index already judged', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, verdict: 'keep' },
          { index: 0, verdict: 'drop' },
        ],
      })

      expect(await reviewClues([charade()])).toHaveLength(1)
    })
  })

  describe('a fix', () => {
    it('replaces the gloss', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'You might vacuum it every week.', index: 0, verdict: 'fix' }],
      })

      expect((await reviewClues([charade()]))[0].gloss).toEqual('You might vacuum it every week.')
    })

    // `clue` is byte-identical to the string the verifier proved and every span indexes it, so a
    // reviewer edit invalidates offsets that still typecheck and still render something.
    it('changes nothing but the gloss, whatever else the verdict carries', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          {
            answer: 'CARPORT',
            clue: 'Floor cover from vehicle with animal',
            definitionSpan: { end: 99, start: 99 },
            gloss: 'You might vacuum it every week.',
            index: 0,
            parts: [],
            verdict: 'fix',
          },
        ],
      })

      expect(await reviewClues([charade()])).toStrictEqual([charade({ gloss: 'You might vacuum it every week.' })])
    })

    // A successful fix changes no other count, so a night of rewrites and a night of none log alike.
    it("logs a replacement with the reviewer's own reason", async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { gloss: 'You might vacuum it every week.', index: 0, reason: 'The original named the room', verdict: 'fix' },
        ],
      })

      await reviewClues([charade()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'CARPET',
        outcome: 'replaced',
        reason: 'The original named the room',
      })
    })

    // The absent case is the only fix that adds a rung; folding it into `replaced` hides that.
    it('calls a fix on a clue with no gloss a creation', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'You might vacuum it every week.', index: 0, verdict: 'fix' }],
      })

      await reviewClues([charade({ gloss: undefined })])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'CARPET',
        outcome: 'created',
        reason: undefined,
      })
    })

    // applyFix spreads unconditionally, so an echoed gloss produces a new object holding the same
    // string, which an identity test counts as a fix while nothing ships.
    it.each([
      ['echoes the original exactly', 'It softens a room underfoot.'],
      ['differs only in whitespace', '  It softens a room underfoot.  '],
    ])('counts no fix when the replacement %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      await reviewClues([charade()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', { answer: 'CARPET', outcome: 'unchanged' })
      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 1, unjudged: 0 })
    })

    it('counts the replacements it applied on the summary line', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { gloss: 'You might vacuum it every week.', index: 0, verdict: 'fix' },
          { index: 1, verdict: 'keep' },
        ],
      })

      await reviewClues([charade(), charade({ answer: 'CARPORT' })])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 1, kept: 2, unjudged: 0 })
    })

    // One row per arm that leaves the clue untouched: `fixed = count of fix verdicts` passes any one.
    it.each([
      ['the replacement fails re-gating', 'A carpet in every room.'],
      ['no replacement is supplied', undefined],
      ['the replacement is not a string', 42],
    ])('counts no fix when %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      await reviewClues([charade()])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 1, unjudged: 0 })
    })

    // A worse replacement falls back to the original rather than dropping the clue.
    it.each([
      ['names the answer', 'A carpet in every room.'],
      ['restates the definition', 'It hides the floor.'],
      ['is over the cap', 'x'.repeat(200)],
      ['is not a string', 42],
    ])('keeps the original gloss when the replacement %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      expect((await reviewClues([charade()]))[0].gloss).toEqual('It softens a room underfoot.')
    })

    // Each row restates one half only, so a gate holding just one half lets the other row through.
    it.each([
      ['the first half', 'Everyone departed by that side.'],
      ['the second half', 'What is remaining after a departure.'],
    ])('rejects a replacement restating %s of a double definition', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      expect((await reviewClues([doubleDefinition()]))[0].gloss).toEqual('The opposite of the starboard side.')
      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'LEFT',
        fallback: 'original',
        outcome: 'rejected',
      })
    })

    // Keeps the row above from passing vacuously as "double definitions never accept a fix".
    it('accepts a replacement on a double definition that restates neither half', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'A direction, or what a departure produces.', index: 0, verdict: 'fix' }],
      })

      expect((await reviewClues([doubleDefinition()]))[0].gloss).toEqual('A direction, or what a departure produces.')
    })

    it('re-gates a deletion replacement against its own definition', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'A mark burned into a hide.', index: 0, verdict: 'fix' }],
      })

      expect((await reviewClues([deletion()]))[0].gloss).toEqual('Burned onto cattle by a hot iron.')
    })

    // A clue can arrive with no gloss at all, so a rejected replacement there leaves the ladder with
    // no semantic rung -- a different event from falling back to an original.
    it.each([
      ['original', 'It softens a room underfoot.'],
      ['none', undefined],
    ])('names the %s fallback when the replacement fails re-gating', async (fallback, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'A carpet in every room.', index: 0, verdict: 'fix' }],
      })

      await reviewClues([charade({ gloss })])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'CARPET',
        fallback,
        outcome: 'rejected',
      })
    })

    it('treats a fix carrying no replacement as a keep', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, verdict: 'fix' }] })

      await reviewClues([charade()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', { answer: 'CARPET', outcome: 'no-replacement' })
    })

    // One message name keeps `stats count() by outcome` a complete accounting of applyFix. All four
    // are driven rather than read off the mock, which under clearMocks would be an empty array.
    it('reports all four fix outcomes under one message name', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { gloss: 'You might vacuum it every week.', index: 0, verdict: 'fix' },
          { gloss: 'You might vacuum it every week.', index: 1, verdict: 'fix' },
          { gloss: 'A carpet in every room.', index: 2, verdict: 'fix' },
          { index: 3, verdict: 'fix' },
        ],
      })

      await reviewClues([charade(), charade({ gloss: undefined }), charade(), charade()])
      const fixLines = jest
        .mocked(log)
        .mock.calls.filter(([, detail]) => (detail as Record<string, unknown>)?.outcome !== undefined)

      expect(fixLines.map(([message]) => message)).toStrictEqual(Array(4).fill('Applied a cryptic fix'))
      expect(fixLines.map(([, detail]) => (detail as Record<string, unknown>).outcome).sort()).toStrictEqual([
        'created',
        'no-replacement',
        'rejected',
        'replaced',
      ])
    })
  })

  describe('failure', () => {
    // logError: the caller returns normally either way, so nothing else marks an unchecked clue.
    it('ships the batch unreviewed when the call throws', async () => {
      mockInvokeModel.mockRejectedValueOnce(new Error('Bedrock said no'))
      const original = charade()

      expect(await reviewClues([original])).toStrictEqual([original])
      expect(logError).toHaveBeenCalledWith('Could not review cryptic clues; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
    })

    // WARN when the reviewer was unreachable rather than wrong: verify.ts's gates have all run, and
    // the alternative is the type shipping nothing whenever Bedrock throttles.
    it('warns rather than alarming when the reviewer is unavailable', async () => {
      mockInvokeModel.mockRejectedValueOnce(
        Object.assign(new Error('Bedrock is unable to process your request'), {
          $fault: 'server',
          $metadata: { attempts: 4, httpStatusCode: 503 },
        }),
      )
      const original = charade()

      expect(await reviewClues([original])).toStrictEqual([original])
      expect(logWarning).toHaveBeenCalledWith('Could not review cryptic clues; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
      expect(logError).not.toHaveBeenCalled()
    })

    it('ships the batch unreviewed when the prompt cannot be read', async () => {
      mockGetPromptById.mockRejectedValueOnce(new Error('No such prompt'))

      expect(await reviewClues([charade()])).toHaveLength(1)
      expect(logError).toHaveBeenCalled()
    })

    // Long enough to drive both sides of the floor; distinct because requestBatch dedupes upstream.
    const answers = ['CARPET', 'CARPORT', 'CATNIP', 'PIGPEN', 'DOGCART', 'HATBOX', 'RATTAN', 'TOMCAT']
    const unanimousDrop = (size: number): ReturnType<typeof charade>[] =>
      answers.slice(0, size).map((answer) => charade({ answer }))

    // At this size unanimity is likelier a malfunction than eight wrong meanings, so the batch
    // ships unreviewed rather than costing the type its night over one malformed response.
    it('keeps a batch at the floor when the reviewer drops every clue', async () => {
      const batch = unanimousDrop(8)
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: batch.map((_clue, index) => ({ index, verdict: 'drop' })),
      })

      expect(await reviewClues(batch)).toHaveLength(8)
      expect(logError).toHaveBeenCalledWith('Reviewer dropped every cryptic clue; keeping the batch unreviewed', {
        count: 8,
      })
    })

    // The sizes that occur: this type rejects more than two thirds of what it asks for. Below the
    // floor "dropped everything" and "dropped the one bad clue" are the same event, so the drops
    // are honored. One row per size, because a floor lowered by one passes a test checking 1 and 2.
    it.each([[1], [2], [3], [4], [5], [6], [7]])('honors a unanimous drop on a batch of %s', async (size) => {
      const batch = unanimousDrop(size)
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: batch.map((_clue, index) => ({ index, verdict: 'drop' })),
      })

      expect(await reviewClues(batch)).toStrictEqual([])
      expect(logError).toHaveBeenCalledWith('Reviewer dropped every cryptic clue; shipping none of them', {
        count: size,
      })
    })

    it('survives a response carrying no verdicts array at all', async () => {
      mockInvokeModel.mockResolvedValueOnce({})

      expect(await reviewClues([charade()])).toHaveLength(1)
    })
  })
})
