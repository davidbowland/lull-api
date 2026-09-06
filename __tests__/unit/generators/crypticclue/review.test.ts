import { CRYPTIC_VERDICTS, crypticReviewTool, reviewClues } from '@generators/crypticclue/review'
import { VerifiedClue } from '@generators/crypticclue/verify'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { Prompt } from '@types'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

// `Dance hidden in instant angora` -- definition "Dance", fodder "instant angora", answer TANGO.
const clue = (overrides: Partial<VerifiedClue> = {}): VerifiedClue => ({
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  definitionSpan: { end: 5, start: 0 },
  device: 'hidden',
  fodderSpan: { end: 30, start: 16 },
  gloss: 'Danced in pairs, and it takes two.',
  indicatorSpan: { end: 15, start: 6 },
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

    it('tells the reviewer it may not rewrite the clue', () => {
      expect(crypticReviewTool.description).toContain('Never rewrite the clue')
    })
  })

  describe('the context', () => {
    // THE SPANS ARE WITHHELD. The reviewer is asked whether the definition MEANS the answer, and an
    // offset cannot help it answer that -- while a span in the payload invites a model to reason
    // about the proof instead of the meaning.
    it('sends the parts as slices and no spans at all', async () => {
      await reviewClues([clue()])

      expect(context().clues[0]).toStrictEqual({
        answer: 'TANGO',
        clue: 'Dance hidden in instant angora',
        definition: 'Dance',
        device: 'hidden',
        fodder: 'instant angora',
        gloss: 'Danced in pairs, and it takes two.',
        index: 0,
      })
    })

    // Sliced from the clue, never taken from the model's own part strings -- verify step 9 threw
    // those away, and the reviewer must judge the decomposition that was PROVED.
    it('slices the definition out of the clue rather than trusting a second copy', async () => {
      await reviewClues([clue({ definitionSpan: { end: 30, start: 16 } })])

      expect(context().clues[0].definition).toEqual('instant angora')
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
    // An `'gloss' in object` assertion here reads correct and passes for the wrong reason.
    it('omits the key entirely for a gloss its gates dropped, rather than sending an empty one', async () => {
      await reviewClues([clue({ gloss: undefined })])

      expect(JSON.parse(JSON.stringify(context())).clues[0]).toStrictEqual({
        answer: 'TANGO',
        clue: 'Dance hidden in instant angora',
        definition: 'Dance',
        device: 'hidden',
        fodder: 'instant angora',
        index: 0,
      })
    })

    it('makes no call at all for an empty batch', async () => {
      expect(await reviewClues([])).toStrictEqual([])
      expect(mockInvokeModel).not.toHaveBeenCalled()
    })
  })

  describe('verdicts', () => {
    it('keeps a clue the reviewer kept, unchanged', async () => {
      const original = clue()

      expect(await reviewClues([original])).toStrictEqual([original])
    })

    // The line this whole call exists to produce: a clue whose definition does not mean its answer
    // is unsolvable and indistinguishable from a correct one to every check in verify.ts.
    // TWO clues, and the second is load-bearing: dropping the only clue in a batch trips the
    // dropped-everything guard below and comes back unreviewed, so a one-clue fixture would assert
    // the opposite of what it reads like.
    it('drops a clue the reviewer dropped, and logs why', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, reason: 'Dance is not TANGO', verdict: 'drop' }] })

      expect(await reviewClues([clue(), clue({ answer: 'WALTZ' })])).toStrictEqual([clue({ answer: 'WALTZ' })])
      expect(log).toHaveBeenCalledWith('Reviewer dropped a cryptic clue', {
        answer: 'TANGO',
        clue: 'Dance hidden in instant angora',
        reason: 'Dance is not TANGO',
      })
    })

    // TWO clues so ONE goes unjudged: judging none at all trips the guard below and is a different
    // event with a different log level.
    it('keeps a clue the reviewer returned no verdict for', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 1, verdict: 'keep' }] })

      expect(await reviewClues([clue(), clue({ answer: 'WALTZ' })])).toHaveLength(2)
      expect(log).toHaveBeenCalledWith('Kept cryptic clues the reviewer returned no verdict for', { count: 1 })
    })

    // THE SILENT FAILURE THIS GUARD EXISTS FOR, and it is the more likely of the two malfunctions.
    // indexVerdicts correctly ignores verdicts it cannot address -- a model keying them `clueIndex`,
    // or returning bare strings, both of which the opaque `items: {}` schema admits -- but every clue
    // then falls through to `unjudged`, is kept, and the summary prints `dropped: 0, fixed: 0`, which
    // is exactly what a healthy night where the reviewer approved everything prints. The definition
    // check would have stopped running with nothing in the one alarm channel to say so.
    it.each([
      ['keys them by the wrong field', [{ clueIndex: 0, verdict: 'keep' }]],
      ['returns bare strings', ['keep', 'keep']],
      ['returns an empty array', []],
    ])('raises an ERROR when the reviewer %s, judging nothing', async (_case, verdicts) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts })

      expect(await reviewClues([clue(), clue({ answer: 'WALTZ' })])).toHaveLength(2)
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

      await reviewClues([clue(), clue({ answer: 'WALTZ' })])

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

        await reviewClues([clue()])

        expect(log).toHaveBeenCalledWith('Ignored an unusable cryptic verdict', { index: 0, verdict })
      },
    )

    it.each([[-1], [1], [1.5], ['0']])('ignores a verdict addressed to index %s', async (index) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index, verdict: 'drop' }] })

      expect(await reviewClues([clue()])).toHaveLength(1)
    })

    it('ignores a second verdict for an index already judged', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { index: 0, verdict: 'keep' },
          { index: 0, verdict: 'drop' },
        ],
      })

      expect(await reviewClues([clue()])).toHaveLength(1)
    })
  })

  describe('a fix', () => {
    it('replaces the gloss', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'It takes two, in step.', index: 0, verdict: 'fix' }],
      })

      expect((await reviewClues([clue()]))[0].gloss).toEqual('It takes two, in step.')
    })

    // THE INVARIANT A FIX MUST NOT BREAK. `clue` is byte-identical to the string the verifier proved
    // and both spans index it, so a reviewer edit anywhere in it invalidates two offsets that still
    // typecheck and still render SOMETHING. The prompt says so; this is what makes it true whatever
    // the prompt says.
    it('changes nothing but the gloss, whatever else the verdict carries', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          {
            answer: 'WALTZ',
            clue: 'Dance concealed in instant angora',
            definitionSpan: { end: 99, start: 99 },
            gloss: 'It takes two, in step.',
            index: 0,
            verdict: 'fix',
          },
        ],
      })

      expect(await reviewClues([clue()])).toStrictEqual([clue({ gloss: 'It takes two, in step.' })])
    })

    // THE LINE THAT SEPARATES A NIGHT OF REWRITES FROM A NIGHT OF NONE. A third of
    // review-cryptic-clues.txt is gloss instruction and a successful fix changes no count, so
    // without this the two nights log identically and the instruction cannot be judged.
    it("logs a replacement with the reviewer's own reason", async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { gloss: 'It takes two, in step.', index: 0, reason: 'The original named the dance', verdict: 'fix' },
        ],
      })

      await reviewClues([clue()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'TANGO',
        outcome: 'replaced',
        reason: 'The original named the dance',
      })
    })

    // CREATED, NOT REPLACED, and the distinction is the one the prompt is tuned against: the ABSENT
    // case is the only fix that ADDS a rung, and "replaced" is literally false when there was nothing
    // to replace. Folding it into `replaced` makes the number the prompt is tuned against unreadable.
    it('calls a fix on a clue with no gloss a creation', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'It takes two, in step.', index: 0, verdict: 'fix' }],
      })

      await reviewClues([clue({ gloss: undefined })])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'TANGO',
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
      ['echoes the original exactly', 'Danced in pairs, and it takes two.'],
      ['differs only in whitespace', '  Danced in pairs, and it takes two.  '],
    ])('counts no fix when the replacement %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      await reviewClues([clue()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', { answer: 'TANGO', outcome: 'unchanged' })
      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 1, unjudged: 0 })
    })

    it('counts the replacements it applied on the summary line', async () => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [
          { gloss: 'It takes two, in step.', index: 0, verdict: 'fix' },
          { index: 1, verdict: 'keep' },
        ],
      })

      await reviewClues([clue(), clue({ answer: 'WALTZ' })])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 1, kept: 2, unjudged: 0 })
    })

    // WHAT WAS APPLIED, never what was asked for. A `fixed` figure counting rejected replacements
    // would report the gloss instruction working on a night it changed nothing that ships. Asserted
    // over EVERY arm that leaves the clue untouched, because a naive `fixed = number of fix verdicts`
    // satisfies the single-row version of this test.
    it.each([
      ['the replacement fails re-gating', 'A tango danced in pairs.'],
      ['no replacement is supplied', undefined],
      ['the replacement is not a string', 42],
    ])('counts no fix when %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      await reviewClues([clue()])

      expect(log).toHaveBeenCalledWith('Reviewed cryptic clues', { dropped: 0, fixed: 0, kept: 1, unjudged: 0 })
    })

    // A reviewer that correctly spots a weak gloss and then writes a worse one must not be able to
    // ship it. Falling back to the ORIGINAL rather than dropping: the reviewer kept the clue, and
    // only the gloss was ever in question.
    it.each([
      ['names the answer', 'A tango danced in pairs.'],
      ['restates the definition', 'A dance for two.'],
      ['is over the cap', 'x'.repeat(200)],
      ['is not a string', 42],
    ])('keeps the original gloss when the replacement %s', async (_case, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ gloss, index: 0, verdict: 'fix' }] })

      expect((await reviewClues([clue()]))[0].gloss).toEqual('Danced in pairs, and it takes two.')
    })

    // THE TWO FALLBACKS ARE NOT THE SAME EVENT, and one line reporting a gloss "kept" described a
    // string that does not exist on the second. Since generator.ts gates before this module reads
    // the clue, a clue can arrive with no gloss at all -- so a rejected replacement there leaves the
    // ladder with no semantic rung, which is the outcome worth counting, not a successful fallback.
    it.each([
      ['original', 'Danced in pairs, and it takes two.'],
      ['none', undefined],
    ])('names the %s fallback when the replacement fails re-gating', async (fallback, gloss) => {
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: [{ gloss: 'A tango danced in pairs.', index: 0, verdict: 'fix' }],
      })

      await reviewClues([clue({ gloss })])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', {
        answer: 'TANGO',
        fallback,
        outcome: 'rejected',
      })
    })

    it('treats a fix carrying no replacement as a keep', async () => {
      mockInvokeModel.mockResolvedValueOnce({ verdicts: [{ index: 0, verdict: 'fix' }] })

      await reviewClues([clue()])

      expect(log).toHaveBeenCalledWith('Applied a cryptic fix', { answer: 'TANGO', outcome: 'no-replacement' })
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
          { gloss: 'It takes two, in step.', index: 0, verdict: 'fix' },
          { gloss: 'It takes two, in step.', index: 1, verdict: 'fix' },
          { gloss: 'A tango danced in pairs.', index: 2, verdict: 'fix' },
          { index: 3, verdict: 'fix' },
        ],
      })

      await reviewClues([clue(), clue({ gloss: undefined }), clue(), clue()])
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
    // logError, not log: the caller returns normally either way, and shipping a clue whose
    // definition nothing has checked is worth an alarm.
    it('ships the batch unreviewed when the call throws', async () => {
      mockInvokeModel.mockRejectedValueOnce(new Error('Bedrock said no'))
      const original = clue()

      expect(await reviewClues([original])).toStrictEqual([original])
      expect(logError).toHaveBeenCalledWith('Could not review cryptic clues; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
    })

    // WARN when the reviewer was unreachable rather than wrong. verify.ts's thirteen string gates
    // have all still run; what is missing is the meaning check, which is the documented degrade.
    it('warns rather than alarming when the reviewer is unavailable', async () => {
      mockInvokeModel.mockRejectedValueOnce(
        Object.assign(new Error('Bedrock is unable to process your request'), {
          $fault: 'server',
          $metadata: { attempts: 4, httpStatusCode: 503 },
        }),
      )
      const original = clue()

      expect(await reviewClues([original])).toStrictEqual([original])
      expect(logWarning).toHaveBeenCalledWith('Could not review cryptic clues; shipping the batch unreviewed', {
        error: expect.any(Error),
      })
      expect(logError).not.toHaveBeenCalled()
    })

    it('ships the batch unreviewed when the prompt cannot be read', async () => {
      mockGetPromptById.mockRejectedValueOnce(new Error('No such prompt'))

      expect(await reviewClues([clue()])).toHaveLength(1)
      expect(logError).toHaveBeenCalled()
    })

    // ON A BATCH BIG ENOUGH FOR UNANIMITY TO BE SURPRISING. At four the reviewer condemning every
    // clue is more likely a malfunction than four wrong definitions, so the batch ships unreviewed
    // rather than costing the type its night over one malformed response.
    it('keeps a large batch when the reviewer drops every clue', async () => {
      const batch = ['TANGO', 'WALTZ', 'RUMBA', 'POLKA'].map((answer) => clue({ answer }))
      mockInvokeModel.mockResolvedValueOnce({
        verdicts: batch.map((_clue, index) => ({ index, verdict: 'drop' })),
      })

      expect(await reviewClues(batch)).toHaveLength(4)
      expect(logError).toHaveBeenCalledWith('Reviewer dropped every cryptic clue; keeping the batch unreviewed', {
        count: 4,
      })
    })

    // THE ROW THE GUARD'S FIRST VERSION GOT WRONG, and it is the batch size that actually occurs.
    // generator.ts opens by saying this type has the lowest pass rate in the catalog and rejects more
    // than two thirds of eight, so a normal night reaches the reviewer with ONE to THREE clues. At
    // that size "dropped everything" and "correctly dropped the one clue whose definition does not
    // mean its answer" are the same event -- and overriding it made the only semantic check in the
    // repo inoperative exactly where it was most likely to be right. Below the floor the drops are
    // HONORED: the type ships nothing, which is legal for bestEffort, and the ERROR still fires.
    it.each([[1], [2], [3]])('honors a unanimous drop on a batch of %s', async (size) => {
      const batch = ['TANGO', 'WALTZ', 'RUMBA'].slice(0, size).map((answer) => clue({ answer }))
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

      expect(await reviewClues([clue()])).toHaveLength(1)
    })
  })
})
