import {
  attemptSolve,
  AuditOptions,
  auditDates,
  classify,
  parseArgs,
  readPacks,
  selectRows,
  summarize,
  withheldContext,
} from '../../../scripts/audit-hints'
import { cryptogramPuzzle, goFigurePuzzle, missingVowelsPuzzle, packDate } from '../__mocks__'
import { invokeModel } from '@services/bedrock'
import { Pack } from '@types'

// The whole SDK, mocked the way __tests__/unit/services/dynamodb.test.ts:6-20 does it. The script
// constructs its client at module scope, so this has to be in place before the import above is
// evaluated -- jest hoists jest.mock calls above imports, which is what makes that work.
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))

// The script imports `../src/services/bedrock`; this alias resolves to the same file through
// moduleNameMapper (jest.config.ts:88-97), and Jest's registry is keyed on the resolved path -- the
// same trick __tests__/unit/services/review.test.ts:9 uses against review.ts's relative './bedrock'.
// Mocked rather than exercised: the real module builds a BedrockRuntimeClient at import.
jest.mock('@services/bedrock')

// A FIXED clock, injected. recentPackDates(todayPackDate(), n) is wall-clock dependent by
// construction, so every date assertion in this file would rot overnight without it. Tests run
// under TZ=UTC (jest.setup-test-env.js), and a pack date is a UTC calendar date, so this is
// 2026-08-20 everywhere.
const clock = (): number => Date.parse('2026-08-20T12:34:56.000Z')

// One pack carrying all three types, in an order that makes the index assertions mean something:
// the goFigure sits at index 0, so a row that reported its position among the SELECTED puzzles
// would say 0 and 1 where the truth is 1 and 2. missingVowels shows its category ("Film");
// cryptogram is difficulty 3, which hides it -- so the fixture covers both category cases too.
const auditPack: Pack = {
  complete: true,
  date: packDate,
  puzzles: [goFigurePuzzle, missingVowelsPuzzle, cryptogramPuzzle],
}

const options = (overrides: Partial<AuditOptions> = {}): AuditOptions => ({
  days: 20,
  tableName: 'lull-api-packs-test',
  useModel: true,
  ...overrides,
})

describe('audit-hints', () => {
  describe('parseArgs', () => {
    it('defaults to the test table, 20 days, and a real model call', () => {
      expect(parseArgs([])).toEqual({ days: 20, since: undefined, tableName: 'lull-api-packs-test', useModel: true })
    })

    // The one positional argument, matching scripts/deploy-prompts.ts:88. Auditing production is
    // opt-in: a bare run can only ever read the test table.
    it('takes the table name from the first positional argument', () => {
      expect(parseArgs(['lull-api-packs']).tableName).toBe('lull-api-packs')
    })

    it('reads flags in any order around the table name', () => {
      expect(parseArgs(['--days', '5', 'lull-api-packs', '--no-model'])).toEqual({
        days: 5,
        since: undefined,
        tableName: 'lull-api-packs',
        useModel: false,
      })
    })

    it('reads a since date', () => {
      expect(parseArgs(['--since', '2026-08-01']).since).toBe('2026-08-01')
    })

    // A --days that reaches a BatchGetItem key list unvalidated is an unbounded key list, and the
    // three bad values below are the three shapes it arrives in.
    it.each([['abc'], ['0'], ['1.5'], ['999'], [undefined]])('rejects --days %s', (value) => {
      const argv = value === undefined ? ['--days'] : ['--days', value]

      expect(() => parseArgs(argv)).toThrow('--days must be a whole number from 1 to 60')
    })

    // '2026-02-30' is not NaN -- it rolls forward to March 2nd, and only isPackDateFormat's round
    // trip catches it.
    it.each([['yesterday'], ['2026-2-1'], ['2026-02-30'], [undefined]])('rejects --since %s', (value) => {
      const argv = value === undefined ? ['--since'] : ['--since', value]

      expect(() => parseArgs(argv)).toThrow('--since must be a YYYY-MM-DD calendar date')
    })

    it('rejects an unknown flag rather than ignoring it', () => {
      expect(() => parseArgs(['--verbose'])).toThrow('Unknown flag: --verbose')
    })

    it('rejects a second positional argument', () => {
      expect(() => parseArgs(['lull-api-packs', 'lull-api-packs-test'])).toThrow(
        'Unexpected argument: lull-api-packs-test',
      )
    })
  })

  describe('auditDates', () => {
    // ENDING WITH TOMORROW, and this is the assertion that matters most in the file. The nightly
    // builds nextPackDate (create-pack.ts:20), so tomorrow is the newest pack that exists, while
    // recentPackDates returns the dates ending the day BEFORE its argument (pack-date.ts:43). An
    // implementation anchored on today silently drops both tomorrow and today -- so an audit run
    // right after a prompt change would measure packs built by the OLD prompt and report the number
    // as the new one's leak rate. Wrong, and indistinguishable from right.
    it('returns the requested number of dates, newest first, ending with tomorrow', () => {
      expect(auditDates(options({ days: 3 }), clock)).toEqual(['2026-08-21', '2026-08-20', '2026-08-19'])
    })

    it('includes tomorrow even for a single-day window', () => {
      expect(auditDates(options({ days: 1 }), clock)).toEqual(['2026-08-21'])
    })

    it('defaults to a 20-day window', () => {
      expect(auditDates(options(), clock)).toHaveLength(20)
    })

    it('runs a since date through to tomorrow, inclusive of both ends', () => {
      expect(auditDates(options({ since: '2026-08-19' }), clock)).toEqual(['2026-08-21', '2026-08-20', '2026-08-19'])
    })

    it('throws when --since is later than tomorrow', () => {
      expect(() => auditDates(options({ since: '2026-08-22' }), clock)).toThrow(
        '--since must not be later than tomorrow (2026-08-21)',
      )
    })

    it('throws when --since spans more days than one BatchGetItem can carry', () => {
      expect(() => auditDates(options({ since: '2026-01-01' }), clock)).toThrow('the maximum is 60')
    })

    // The upper boundary, pinned exactly on the span path. Without it, `> MAX_DAYS` could become
    // `> MAX_DAYS + 1` and nothing would notice -- 61 keys is over the BatchGetItem budget the cap
    // exists to respect, and the overflow arrives as a silently short read.
    it('accepts a since span of exactly MAX_DAYS and refuses one more', () => {
      expect(auditDates(options({ since: '2026-06-23' }), clock)).toHaveLength(60)
      expect(() => auditDates(options({ since: '2026-06-22' }), clock)).toThrow('the maximum is 60')
    })
  })

  describe('readPacks', () => {
    const packItem = (date: string) => ({ Data: { S: JSON.stringify({ complete: true, date, puzzles: [] }) } })

    // THE contract. src/services/dynamodb.ts:195-198 catches, logs, and returns [] -- correct for a
    // generation path that must not fail a pack over a failed read, and fatal here, because an empty
    // audit is indistinguishable from a clean one. Both throws below are why this script owns its
    // client, and until now neither was verified.
    it('throws rather than returning a short read when keys go unprocessed', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: { 'lull-api-packs-test': [packItem('2026-08-21')] },
        UnprocessedKeys: { 'lull-api-packs-test': { Keys: [{ Date: { S: '2026-08-20' } }] } },
      })

      await expect(readPacks('lull-api-packs-test', ['2026-08-21', '2026-08-20'])).rejects.toThrow(
        'BatchGetItem left keys unprocessed',
      )
    })

    it('throws rather than reporting a clean audit when nothing came back', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { 'lull-api-packs-test': [] } })

      await expect(readPacks('lull-api-packs-test', ['2026-08-21'])).rejects.toThrow('No packs found')
    })

    // A credentials or permissions failure must surface, not resolve to an empty window.
    it('lets an SDK error escape', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDeniedException'))

      await expect(readPacks('lull-api-packs-test', ['2026-08-21'])).rejects.toThrow('AccessDeniedException')
    })

    it('returns packs oldest first', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: { 'lull-api-packs-test': [packItem('2026-08-21'), packItem('2026-08-19')] },
      })

      const packs = await readPacks('lull-api-packs-test', ['2026-08-21', '2026-08-19'])

      expect(packs.map((pack) => pack.date)).toEqual(['2026-08-19', '2026-08-21'])
    })
  })

  describe('argument conflicts', () => {
    // Both name a window. Resolving the conflict silently would report a number the operator
    // attributes to the other flag -- the same quiet wrongness as ignoring an unknown flag.
    // The --days cap lives in parseArgs, not auditDates, so it is pinned where it is enforced.
    it('accepts exactly MAX_DAYS days and refuses one more', () => {
      expect(parseArgs(['--days', '60']).days).toBe(60)
      expect(() => parseArgs(['--days', '61'])).toThrow('--days must be a whole number from 1 to 60')
    })

    it('refuses --days and --since together', () => {
      expect(() => parseArgs(['--days', '3', '--since', '2026-08-19'])).toThrow(
        '--days and --since both set a window; pass one or the other',
      )
    })
  })

  describe('selectRows', () => {
    // BY TYPE, never by the presence of `answer`. Duck-typing on `answer` is the hazard
    // src/handlers/create-phrase-puzzles.ts:37-40 warns about: goFigure's `hints` is three OBJECTS
    // while PhrasePuzzleData's is three strings, and this function reads `hints`.
    it('selects phrase-backed puzzles by type and skips goFigure in the same pack', () => {
      expect(selectRows(auditPack).map((row) => row.type)).toEqual(['missingvowels', 'cryptogram'])
    })

    // The index is the position in the PACK, so two runs line up and a reader can point at a row.
    // Reporting the position among the selected rows would say 0 and 1 here.
    it('reports the position in the pack, not the position among the selected rows', () => {
      expect(selectRows(auditPack).map((row) => row.index)).toEqual([1, 2])
    })

    it('stamps every row with its pack date', () => {
      expect(selectRows(auditPack).map((row) => row.date)).toEqual([packDate, packDate])
    })

    // Rung 3 is dropped HERE, at the boundary, so no later function can send what it does not
    // hold. The row is the only thing built from the puzzle, and it is already two rungs.
    it('keeps rungs 1 and 2 and drops rung 3 at selection', () => {
      expect(selectRows(auditPack)[0].hints).toEqual([
        missingVowelsPuzzle.data.hints[0],
        missingVowelsPuzzle.data.hints[1],
      ])
    })

    // Difficulty 3 and 5 omit the category (src/generators/category-visibility.ts), so an absent
    // category is a normal row, not a malformed one -- and the audit reports those separately.
    it('carries the category when the puzzle shows one and undefined when it hides it', () => {
      expect(selectRows(auditPack).map((row) => row.category)).toEqual(['Film', undefined])
    })

    it('returns nothing for a pack with no phrase-backed puzzles', () => {
      expect(selectRows({ complete: true, date: packDate, puzzles: [goFigurePuzzle] })).toEqual([])
    })

    // Fail loudly. A puzzle whose data cannot be read is a corrupt pack, and quietly dropping it
    // would shrink the denominator and make the leak rate look better than it is.
    it('throws on a phrase-backed puzzle whose data is not a readable ladder', () => {
      const broken = { ...cryptogramPuzzle, data: { answer: 'Whatever', hints: ['one', 'two'] } }

      expect(() => selectRows({ complete: true, date: packDate, puzzles: [broken] } as never)).toThrow(
        `Malformed phrase puzzle at ${packDate} #0 (cryptogram)`,
      )
    })
  })

  // THE TEST THAT MATTERS MOST. A blind test that leaks the answer measures nothing, and it would
  // do so silently: every row would come back "named first" and the audit would read as a total
  // failure of the ladder rather than as a broken instrument.
  describe('withheldContext', () => {
    it('never carries the answer, the third rung, or any puzzle rendering', () => {
      const rows = selectRows(auditPack)
      const serialized = JSON.stringify(rows.map(withheldContext))

      expect(serialized).not.toContain('answer')
      expect(serialized).not.toContain(missingVowelsPuzzle.data.answer)
      expect(serialized).not.toContain(missingVowelsPuzzle.data.hints[2])
      expect(serialized).not.toContain('displayed')
      expect(serialized).not.toContain(missingVowelsPuzzle.data.displayed)
      expect(serialized).not.toContain('ciphertext')
      expect(serialized).not.toContain(cryptogramPuzzle.data.ciphertext)
    })

    // The positive half: withholding everything would also pass the assertions above.
    it('carries the category and both rungs when the category is shown', () => {
      expect(withheldContext(selectRows(auditPack)[0])).toEqual({
        category: 'Film',
        hints: [missingVowelsPuzzle.data.hints[0], missingVowelsPuzzle.data.hints[1]],
      })
    })

    // No `category: null` and no invented placeholder: the blind reader gets exactly what the
    // player got, which on these puzzles is two rungs and nothing else. Open question 2 in the
    // spec -- rung 1 narrows a category the player was never shown.
    it('omits the category key entirely when the puzzle hides it', () => {
      expect(Object.keys(withheldContext(selectRows(auditPack)[1]))).toEqual(['hints'])
    })
  })

  describe('attemptSolve', () => {
    beforeAll(() => {
      jest.mocked(invokeModel).mockResolvedValue({ candidates: ['The Empire Strikes Back'] } as never)
    })

    it('returns the model candidates in the order they were given', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['A New Hope', 'Return of the Jedi'] } as never)

      expect(await attemptSolve(selectRows(auditPack)[0])).toEqual(['A New Hope', 'Return of the Jedi'])
    })

    // The tool schema asks for three and does not bound the count, for the reason given in the
    // source: one invocation is one puzzle, and an over-generous model must cost a row's precision
    // rather than aborting the audit.
    it('keeps at most three candidates', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['a', 'b', 'c', 'd', 'e'] } as never)

      expect(await attemptSolve(selectRows(auditPack)[0])).toEqual(['a', 'b', 'c'])
    })

    // The same guarantee as the withheldContext tests, asserted one layer out at the actual call
    // boundary -- this is the argument that reaches Bedrock.
    it('sends the withheld context and nothing else', async () => {
      const row = selectRows(auditPack)[0]

      await attemptSolve(row)

      const context = jest.mocked(invokeModel).mock.calls[0][2]
      expect(context).toEqual(withheldContext(row))
      expect(JSON.stringify(context)).not.toContain(missingVowelsPuzzle.data.answer)
      expect(JSON.stringify(context)).not.toContain(missingVowelsPuzzle.data.hints[2])
    })

    // bedrock.ts:46 does contents.replace('${context}', ...). A template literal that interpolated
    // the placeholder at author time would send instructions and no data, every row would come back
    // `absent`, and the audit would report a perfect, silent all-clear.
    it('leaves the ${context} placeholder in the prompt for bedrock to fill', async () => {
      await attemptSolve(selectRows(auditPack)[0])

      const prompt = jest.mocked(invokeModel).mock.calls[0][0]
      expect(prompt.contents).toContain('${context}')
      expect(prompt.config.model).toBe('us.anthropic.claude-opus-5')
      expect(prompt.config.thinkingEffort).toBe('medium')
    })

    it('asks the model for candidates through a tool the response is validated against', async () => {
      await attemptSolve(selectRows(auditPack)[0])

      const tool = jest.mocked(invokeModel).mock.calls[0][1]
      expect(tool.name).toBe('submit_candidates')
      expect(tool.input_schema.required).toEqual(['candidates'])
      expect(tool.input_schema.properties.candidates.items).toEqual({ type: 'string' })
    })
  })

  describe('classify', () => {
    it('reports the answer named first', () => {
      expect(classify('The Empire Strikes Back', ['The Empire Strikes Back', 'Return of the Jedi'])).toBe('named-first')
    })

    it('reports the answer named later in the list', () => {
      expect(classify('The Empire Strikes Back', ['Return of the Jedi', 'The Empire Strikes Back'])).toBe('named')
    })

    it('reports an answer nobody named', () => {
      expect(classify('The Empire Strikes Back', ['Return of the Jedi', 'A New Hope'])).toBe('absent')
    })

    // Through normalizeAnswer, so a model that re-cases or re-punctuates has still named it. A
    // string comparison here would score most real hits as "absent" and report a clean ladder.
    it('matches case- and punctuation-insensitively', () => {
      expect(classify('TO BE OR NOT TO BE', ['to be, or not to be'])).toBe('named-first')
    })

    it('reports absent for an empty candidate list', () => {
      expect(classify('The Empire Strikes Back', [])).toBe('absent')
    })
  })

  describe('classify recognises how models actually name a phrase', () => {
    // The bug this closes: exact-token matching scored all four of these `absent`, so a total leak
    // was recorded as "the ladder held". Every one of those errors pushes the leak rate DOWN, which
    // is the only direction this instrument must never be wrong in.
    it.each([
      ['a franchise prefix', 'Star Wars: The Empire Strikes Back'],
      ['an episode number', 'Star Wars Episode V - The Empire Strikes Back'],
      ['a trailing year', 'The Empire Strikes Back (1980)'],
      ['a dropped leading article', 'Empire Strikes Back'],
      ['trailing punctuation', 'The Empire Strikes Back.'],
    ])('counts %s as naming the answer', (_description, candidate) => {
      expect(classify('The Empire Strikes Back', [candidate])).toBe('named-first')
    })

    it('still finds the answer behind a wrong first guess', () => {
      expect(classify('The Empire Strikes Back', ['Return of the Jedi', 'Star Wars: The Empire Strikes Back'])).toBe(
        'named',
      )
    })

    // The floor on containment. Without it a short answer matches inside any longer phrase that
    // happens to contain its letters, which would bias the rate the other way.
    it('does not count a short answer found inside an unrelated longer one', () => {
      expect(classify('Toe Hold', ['Toe Holder Bracket Assembly'])).toBe('absent')
    })

    it('reports absent when no candidate names the answer', () => {
      expect(classify('The Empire Strikes Back', ['Return of the Jedi', 'The Wrath of Khan'])).toBe('absent')
    })

    it('reports absent for an empty candidate list rather than throwing', () => {
      expect(classify('The Empire Strikes Back', [])).toBe('absent')
    })
  })

  describe('summarize', () => {
    const resultsOf = (outcomes: string[]) =>
      outcomes.map((outcome) => ({ outcome, row: selectRows(auditPack)[0] })) as never

    it('counts each bucket and reports the share of the first two as the leak rate', () => {
      expect(summarize(resultsOf(['named-first', 'named', 'absent', 'absent']))).toEqual({
        absent: 2,
        errored: 0,
        leakRate: 0.5,
        named: 1,
        namedFirst: 1,
        total: 4,
      })
    })

    // Errored rows are EXCLUDED from the denominator, never counted as `absent`. A row whose solve
    // attempt failed was not measured, and folding it into "the ladder held" would bias the leak
    // rate downward -- the one direction this instrument must never be wrong in. Here two of six
    // rows errored, so the rate is 2/4 and not 2/6.
    it('excludes errored rows from the rate and reports them separately', () => {
      expect(summarize(resultsOf(['named-first', 'named', 'absent', 'absent', 'error', 'error']))).toEqual({
        absent: 2,
        errored: 2,
        leakRate: 0.5,
        named: 1,
        namedFirst: 1,
        total: 4,
      })
    })

    // Every row errored: nothing was measured, so the rate must be 0 over 0 measured rather than a
    // clean-looking result computed from failures.
    it('reports nothing measured when every row errored', () => {
      expect(summarize(resultsOf(['error', 'error']))).toEqual({
        absent: 0,
        errored: 2,
        leakRate: 0,
        named: 0,
        namedFirst: 0,
        total: 0,
      })
    })

    // The hidden-category subset is legitimately empty on a pack with no difficulty 3 or 5 phrase
    // puzzle, and summarize is called on it. 0/0 must not print NaN.
    it('reports a zero leak rate for an empty set rather than NaN', () => {
      expect(summarize([])).toEqual({ absent: 0, errored: 0, leakRate: 0, named: 0, namedFirst: 0, total: 0 })
    })
  })
})
