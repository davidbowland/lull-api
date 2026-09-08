import { CRYPTIC_VERDICTS, crypticReviewTool, reviewClues } from '@generators/crypticclue/review'
import { VerifiedCharade, VerifiedDeletion, VerifiedDoubleDefinition } from '@generators/crypticclue/verify'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { Prompt } from '@types'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

// EVERY SPAN BELOW IS A GENUINE OFFSET INTO ITS OWN CLUE, checked by slicing rather than by eye --
// the context tests assert the SLICES, so a transposed pair would fail loudly, but the fixtures are
// also meant to be clues the verifier would actually pass, and a reader has no way to confirm that
// against offsets nobody derived.
//
//   `Floor covering from vehicle with animal`  CAR + PET, two connective seams (FROM, WITH)
//   `A mark from spirit cut short`             BRANDY less its last letter, one seam (FROM)
//   `Departed and still remaining`             LEFT twice, one seam (AND)

// The default fixture for everything below the context block. A charade because it is the device
// with more than one cue, so a payload that collapsed `parts` to a single pair would show up here
// rather than only in the charade row.
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

    // Under an opaque element the description is the ONLY specification the reviewer gets, so the
    // words the code branches on are pinned to the words the description uses.
    it.each([...CRYPTIC_VERDICTS])('names the %s verdict the schema no longer describes', (verdict) => {
      expect(crypticReviewTool.description).toContain(verdict)
    })

    // THE FIELDS THE PAYLOAD ACTUALLY CARRIES, one row each. The description and getModelContext are
    // the two halves of one agreement, and under `items: {}` nothing else holds them together: a
    // description naming `fodder` after the payload stopped sending one would ask the reviewer to
    // judge a field that is not there, and no schema error would say so.
    it.each([['parts'], ['source'], ['definitions'], ['removal'], ['definition']])(
      'names the %s field the payload sends',
      (field) => {
        expect(crypticReviewTool.description).toContain(field)
      },
    )

    // Every string the verifier proved, named in the one place the reviewer reads. `fix` sets the
    // gloss; the clue is stored byte for byte and every span on it indexes that string, so a reviewer
    // edit anywhere in it invalidates offsets that still typecheck.
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
    // THE SPANS ARE WITHHELD. The reviewer is asked whether a cue MEANS a word, and an offset cannot
    // help it answer that -- while a span in the payload invites a model to reason about the proof
    // instead of the meaning.
    //
    // `text` IS NOT A SLICE and cannot be: CAR appears nowhere in `Floor covering from vehicle with
    // animal`. That asymmetry with `cue` is the whole reason this call became load-bearing.
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

    // `removal` TRAVELS AND THE INDICATOR DOES NOT. Without which end came off, "does `spirit` mean
    // BRANDY" is asked about a word the reviewer cannot reconstruct from BRAND. Which words signal
    // the removal is a committed-list membership verify step 8 already decided, so the indicator is
    // withheld for the same reason the spans are.
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

    // NO `definition`, NO `parts`, NO INDICATOR. Neither half is "the" definition and the device has
    // no wordplay at all, so there is no cue to judge -- which is exactly why this device rests
    // entirely on the pass this payload feeds.
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

    // Sliced from the clue, never taken from the model's own part strings -- verify step 9 threw
    // those away, and the reviewer must judge the decomposition that was PROVED. That was true when
    // the fodder was the thing sliced and it did not die with the fodder; it is now true once per
    // cue, so there are MORE places for a second copy to disagree rather than fewer.
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

    // Indices are assigned across the whole batch regardless of device, because that is the only
    // handle a verdict has. A per-device grouping would renumber them.
    it('numbers a mixed batch by position, not by device', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, verdict: 'keep' }] })

      await reviewClues([charade(), deletion(), doubleDefinition()])

      expect(context().clues.map((clue: Record<string, unknown>) => [clue.index, clue.device])).toStrictEqual([
        [0, 'charade'],
        [1, 'deletion'],
        [2, 'doubledefinition'],
      ])
    })

    // THE SHAPE THE GATE MOVE MADE COMMON, pinned as a property rather than left incidental. The
    // prompt's ABSENT bullet is written against exactly this shape, so a change here that started
    // sending `null` or an empty string would leave that instruction describing something the model
    // never receives.
    //
    // ASSERTED ON THE SERIALIZED FORM, and the distinction is the point rather than pedantry: the
    // in-memory object DOES carry a `gloss` key holding undefined, and only JSON.stringify --
    // bedrock.ts's buildPromptContents -- drops it. What the model receives is the serialized form,
    // so that is the thing the prompt's ABSENT bullet is written against and the thing worth pinning.
    // A `'gloss' in object` assertion here reads correct and passes for the wrong reason.
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

    // The line this whole call exists to produce: a definition that does not mean its answer, or a
    // cue that does not mean its letters, is unsolvable and indistinguishable from a correct clue to
    // every check in verify.ts.
    // TWO clues, and the second is load-bearing: dropping the only clue in a batch trips the
    // dropped-everything guard below and comes back unreviewed, so a one-clue fixture would assert
    // the opposite of what it reads like.
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

    // TWO clues so ONE goes unjudged: judging none at all trips the guard below and is a different
    // event with a different log level.
    it('keeps a clue the reviewer returned no verdict for', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 1, verdict: 'keep' }] })

      expect(await reviewClues([charade(), charade({ answer: 'CARPORT' })])).toHaveLength(2)
      expect(log).toHaveBeenCalledWith('Kept cryptic clues the reviewer returned no verdict for', { count: 1 })
    })

    // THE SILENT FAILURE THIS GUARD EXISTS FOR, and it is the more likely of the two malfunctions.
    // indexVerdicts correctly ignores verdicts it cannot address -- a model keying them `clueIndex`,
    // or returning bare strings, both of which the opaque `items: {}` schema admits -- but every clue
    // then falls through to `unjudged`, is kept, and the summary prints `dropped: 0, fixed: 0`, which
    // is exactly what a healthy night where the reviewer approved everything prints. The meaning
    // check -- every one of it, since nothing else in the repo makes one -- would have stopped
    // running with nothing in the one alarm channel to say so.
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

    // The partial case gets no ERROR -- one usable verdict means the reviewer is alive -- so the
    // count rides on the summary line instead, where three ordinary-looking figures would otherwise
    // hide it.
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

    // Without the verdict-word check an unrecognized or non-string verdict falls through into a
    // silent keep, so a reviewer's `drop` arriving as `"DROP"` would ship a clue it judged
    // unsolvable.
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

    // THE INVARIANT A FIX MUST NOT BREAK. `clue` is byte-identical to the string the verifier proved
    // and EVERY span on it indexes that string -- a definition span and one cue span per part here,
    // an indicator span as well on a deletion -- so a reviewer edit anywhere in it invalidates
    // offsets that still typecheck and still render SOMETHING. The count of them grew with the
    // device set; the argument did not. The prompt says so; this is what makes it true whatever the
    // prompt says.
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

    // THE LINE THAT SEPARATES A NIGHT OF REWRITES FROM A NIGHT OF NONE. A third of
    // review-cryptic-clues.txt is gloss instruction and a successful fix changes no count, so
    // without this the two nights log identically and the instruction cannot be judged.
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

    // CREATED, NOT REPLACED, and the distinction is the one the prompt is tuned against: the ABSENT
    // case is the only fix that ADDS a rung, and "replaced" is literally false when there was nothing
    // to replace. Folding it into `replaced` makes the number the prompt is tuned against unreadable.
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

    // A REPLACEMENT EQUAL TO THE ORIGINAL IS NOT A FIX. gatedGloss returns its input on success and
    // applyFix spreads unconditionally, so a reviewer echoing the gloss it was shown produces a NEW
    // OBJECT holding the SAME string -- which an identity test upstream counts as a fix while
    // generator.ts's rebuild guard, comparing VALUES, correctly ships nothing new. This row is what
    // stops a night being reported as "the gloss instruction is working" with no shipped byte
    // changed. The whitespace variant proves `.trim()` cannot smuggle one past it either.
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

    // WHAT WAS APPLIED, never what was asked for. A `fixed` figure counting rejected replacements
    // would report the gloss instruction working on a night it changed nothing that ships. Asserted
    // over EVERY arm that leaves the clue untouched, because a naive `fixed = number of fix verdicts`
    // satisfies the single-row version of this test.
    it.each([
      ['the replacement fails re-gating', 'A carpet in every room.'],
      ['no replacement is supplied', undefined],
      ['the replacement is not a string', 42],
    ])('counts no fix when %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      await reviewClues([charade()])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 1, unjudged: 0 })
    })

    // A reviewer that correctly spots a weak gloss and then writes a worse one must not be able to
    // ship it. Falling back to the ORIGINAL rather than dropping: the reviewer kept the clue, and
    // only the gloss was ever in question.
    it.each([
      ['names the answer', 'A carpet in every room.'],
      ['restates the definition', 'It hides the floor.'],
      ['is over the cap', 'x'.repeat(200)],
      ['is not a string', 42],
    ])('keeps the original gloss when the replacement %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      expect((await reviewClues([charade()]))[0].gloss).toEqual('It softens a room underfoot.')
    })

    // THE GATE RUNS OVER BOTH HALVES OF A DOUBLE DEFINITION, which is what the prompt promises in as
    // many words and what a single `definitionSpan` slice could not deliver -- the device does not
    // have one. Both rows restate ONE half, so passing either half alone would let the other row
    // through: `remaining` is invisible to a gate holding only "Departed", and vice versa.
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

    // The same gate on the device that DOES have a single definition, so the row above is read as
    // "both halves" rather than as "double definitions never accept a fix".
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

    // THE TWO FALLBACKS ARE NOT THE SAME EVENT, and one line reporting a gloss "kept" described a
    // string that does not exist on the second. Since generator.ts gates before this module reads
    // the clue, a clue can arrive with no gloss at all -- so a rejected replacement there leaves the
    // ladder with no semantic rung, which is the outcome worth counting, not a successful fallback.
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

    // ONE MESSAGE NAME ACROSS EVERY OUTCOME, which is the rule model-batch.ts states for its own
    // `Rejected an item` and gives the Insights query for. Four outcomes under four message names is
    // four strings that drift apart; this row is what keeps `stats count() by outcome` a complete
    // accounting of what applyFix decided.
    //
    // It DRIVES all four rather than reading the mock, because a row that only inspects log.mock
    // asserts against an empty array under clearMocks and passes whatever the code does. Identified
    // by the `outcome` key rather than by message, so a rename shows up as a second message name
    // here instead of quietly slipping out of the filter.
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
    // logError, not log: the caller returns normally either way, and shipping a clue whose meaning
    // nothing has checked is worth an alarm.
    it('ships the batch unreviewed when the call throws', async () => {
      mockInvokeModel.mockRejectedValueOnce(new Error('Bedrock said no'))
      const original = charade()

      expect(await reviewClues([original])).toStrictEqual([original])
      expect(logError).toHaveBeenCalledWith('Could not review cryptic clues; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
    })

    // WARN when the reviewer was unreachable rather than wrong. Every one of verify.ts's string gates
    // has still run; what is missing is the meaning check, which is the documented degrade -- and it
    // is a worse degrade than it was, because a double definition has no letter arithmetic behind it
    // at all. Still a WARN: the alternative is the type shipping nothing whenever Bedrock throttles.
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

    // A batch of answers long enough to drive both sides of the floor. Distinct because requestBatch
    // dedupes on normalized answer upstream, so two clues sharing one never reach the reviewer.
    const answers = ['CARPET', 'CARPORT', 'CATNIP', 'PIGPEN', 'DOGCART', 'HATBOX', 'RATTAN', 'TOMCAT']
    const unanimousDrop = (size: number): ReturnType<typeof charade>[] =>
      answers.slice(0, size).map((answer) => charade({ answer }))

    // ON A BATCH BIG ENOUGH FOR UNANIMITY TO BE SURPRISING. At the over-ask ratio the pass rate would
    // have had to clear 50% on a type generator.ts says rejects more than two thirds, so the reviewer
    // condemning every clue is more likely a malfunction than eight wrong meanings, and the batch
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

    // THE ROWS THE GUARD GOT WRONG TWICE, and they are the batch sizes that occur. `asked` is
    // count * CANDIDATES_PER_PUZZLE = 2 * 8 = SIXTEEN -- not the eight an earlier derivation used --
    // and generator.ts says this type has the lowest pass rate in the catalog and rejects more than
    // two thirds of what it asks for, which puts the verified batch at about five or fewer. The
    // synonym devices reject harder still: `parts-out-of-order`, `ambiguous-removal`,
    // `definitions-not-distinct` and a `unknown-part-word` running over every cue token AND every
    // part text are codes that did not exist when that figure was made.
    //
    // At these sizes "dropped everything" and "correctly dropped the one clue whose cue does not mean
    // its letters" are the same event, and overriding it turns the only meaning check in the repo off
    // exactly where it is most likely to be right -- on a device whose derivation arm verify.ts
    // leaves empty by design. Below the floor the drops are HONORED: the type ships nothing, which is
    // legal for bestEffort, and the ERROR still fires.
    //
    // ONE ROW PER SIZE UP TO THE FLOOR rather than a sample of them, because a floor is exactly the
    // kind of number that gets lowered by one and passes a test that only checks 1 and 2.
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
