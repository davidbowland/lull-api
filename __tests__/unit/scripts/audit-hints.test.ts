import {
  attemptSolve,
  AuditOptions,
  auditDates,
  classify,
  NON_AUDITED_PUZZLE_TYPES,
  parseArgs,
  PHRASE_PUZZLE_TYPES,
  readPacks,
  selectRows,
  summarize,
  withheldContext,
} from '../../../scripts/audit-hints'
import { goFigurePuzzle, missingVowelsPuzzle, packDate } from '../__mocks__'
import { allContributions } from '@generators/index'
import { invokeModel } from '@services/bedrock'
import { MissingVowelsData, Pack, Puzzle } from '@types'

// The script builds its client at module scope, so this must precede the import above; jest
// hoists jest.mock over imports.
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))

// The alias resolves to the file the script imports relatively, and Jest's registry is keyed on
// the resolved path. Mocked because the real module builds a client at import time.
jest.mock('@services/bedrock')

// recentPackDates is wall-clock dependent, so every date assertion here would rot overnight.
const clock = (): number => Date.parse('2026-08-20T12:34:56.000Z')

// A SYNTHETIC row: Missing Vowels declares difficulties [1, 2, 4] and CATEGORY_HIDDEN_BY_DIFFICULTY
// hides only at 3 and 5, so the real type always ships a category. Kept because the audited set is
// Missing Vowels alone, which otherwise leaves every category-omission branch unreachable.
const hiddenCategoryPuzzle: Puzzle<MissingVowelsData> = {
  ...missingVowelsPuzzle,
  data: { ...missingVowelsPuzzle.data, category: undefined },
  difficulty: 3,
  estimatedSeconds: 90,
  id: '2026-06-15:missingvowels:1a2b3c4d',
}

// The goFigure sits at index 0, so a row reporting its position among the SELECTED puzzles says 0
// and 1 rather than 1 and 2. One Missing Vowels shows its category, the other hides it.
const auditPack: Pack = {
  complete: true,
  date: packDate,
  puzzles: [goFigurePuzzle, missingVowelsPuzzle, hiddenCategoryPuzzle],
}

const options = (overrides: Partial<AuditOptions> = {}): AuditOptions => ({
  days: 20,
  tableName: 'lull-api-packs-test',
  useModel: true,
  ...overrides,
})

describe('audit-hints', () => {
  // A companion set plus a partition makes forgetting a type FAIL rather than under-report. Over
  // allContributions, because PuzzleType is not enumerable at runtime.
  describe('type classification', () => {
    // A type missing from both sets makes `classified` short; a type in both, long.
    it('classifies every registered type exactly once', () => {
      const registered = [...new Set(allContributions.map((contribution) => contribution.type))].sort()
      const classified = [...PHRASE_PUZZLE_TYPES, ...NON_AUDITED_PUZZLE_TYPES].sort()

      expect(classified).toStrictEqual(registered)
    })

    // Separate from the count above so a failure names WHICH type is double-classified.
    it('puts no type in both sets', () => {
      expect([...PHRASE_PUZZLE_TYPES].filter((type) => NON_AUDITED_PUZZLE_TYPES.has(type))).toStrictEqual([])
    })

    // Both sets empty satisfies a partition, and zero rows is a false all-clear.
    it('leaves neither set empty', () => {
      expect(PHRASE_PUZZLE_TYPES.size).toBeGreaterThan(0)
      expect(NON_AUDITED_PUZZLE_TYPES.size).toBeGreaterThan(0)
    })

    // selectRows filters on PHRASE_PUZZLE_TYPES before toRow throws, so a non-phrase type here
    // aborts every run.
    it('keeps goFigure out of the audited set, because a blind reader cannot be its denominator', () => {
      expect(PHRASE_PUZZLE_TYPES.has('gofigure')).toBe(false)
      expect(NON_AUDITED_PUZZLE_TYPES.has('gofigure')).toBe(true)
    })
  })

  describe('parseArgs', () => {
    it('defaults to the test table, 20 days, and a real model call', () => {
      expect(parseArgs([])).toEqual({ days: 20, since: undefined, tableName: 'lull-api-packs-test', useModel: true })
    })

    // Auditing production is opt-in: a bare run can only ever read the test table.
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

    // An unvalidated --days reaching a BatchGetItem key list is an unbounded key list.
    it.each([['abc'], ['0'], ['1.5'], ['999'], [undefined]])('rejects --days %s', (value) => {
      const argv = value === undefined ? ['--days'] : ['--days', value]

      expect(() => parseArgs(argv)).toThrow('--days must be a whole number from 1 to 40')
    })

    // '2026-02-30' is not NaN: it rolls forward, and only isPackDateFormat's round trip catches it.
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
    // The nightly builds nextPackDate, so tomorrow is the newest pack, while recentPackDates ends
    // the day BEFORE its argument. Anchored on today, an audit measures the OLD prompt's packs.
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
      expect(() => auditDates(options({ since: '2026-01-01' }), clock)).toThrow('the maximum is 40')
    })

    // The span path's upper boundary, where an overflow is a silently short read.
    it('accepts a since span of exactly MAX_DAYS and refuses one more', () => {
      expect(auditDates(options({ since: '2026-07-13' }), clock)).toHaveLength(40)
      expect(() => auditDates(options({ since: '2026-07-12' }), clock)).toThrow('the maximum is 40')
    })
  })

  describe('readPacks', () => {
    const packItem = (date: string) => ({ Data: { S: JSON.stringify({ complete: true, date, puzzles: [] }) } })

    // src/services/dynamodb.ts returns [] on failure, which reads as a clean audit and is why
    // this script owns its client.
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
    // The --days cap lives in parseArgs, not auditDates, so it is pinned where it is enforced.
    it('accepts exactly MAX_DAYS days and refuses one more', () => {
      expect(parseArgs(['--days', '40']).days).toBe(40)
      expect(() => parseArgs(['--days', '41'])).toThrow('--days must be a whole number from 1 to 40')
    })

    it('refuses --days and --since together', () => {
      expect(() => parseArgs(['--days', '3', '--since', '2026-08-19'])).toThrow(
        '--days and --since both set a window; pass one or the other',
      )
    })
  })

  describe('selectRows', () => {
    // Selected BY TYPE, never by the presence of `answer`: every hint on the wire is
    // { text, metadata? }, so goFigure's rungs survive toRow's guard and land in the audit as rows
    // the blind reader cannot solve. The type list is weak while the audited set has one member.
    it('selects phrase-backed puzzles by type and skips goFigure in the same pack', () => {
      const rows = selectRows(auditPack)

      expect(rows.map((row) => row.type)).toEqual(['missingvowels', 'missingvowels'])
      // An over-selecting filter poisons the denominator silently.
      expect(rows).toHaveLength(auditPack.puzzles.length - 1)
    })

    // The position in the PACK, so two runs line up and a reader can point at a row.
    it('reports the position in the pack, not the position among the selected rows', () => {
      expect(selectRows(auditPack).map((row) => row.index)).toEqual([1, 2])
    })

    it('stamps every row with its pack date', () => {
      expect(selectRows(auditPack).map((row) => row.date)).toEqual([packDate, packDate])
    })

    // Dropped HERE so no later function can send what it does not hold, and hints stays
    // [string, string] because a rung object puts `metadata` one JSON.stringify from the context.
    it('keeps the text of rungs 1 and 2 and drops rung 3 at selection', () => {
      expect(selectRows(auditPack)[0].hints).toEqual([
        missingVowelsPuzzle.data.hints[0].text,
        missingVowelsPuzzle.data.hints[1].text,
      ])
    })

    // Difficulty 3 and 5 omit the category, so an absent one is a normal row rather than malformed.
    it('carries the category when the puzzle shows one and undefined when it hides it', () => {
      expect(selectRows(auditPack).map((row) => row.category)).toEqual(['Film', undefined])
    })

    it('returns nothing for a pack with no phrase-backed puzzles', () => {
      expect(selectRows({ complete: true, date: packDate, puzzles: [goFigurePuzzle] })).toEqual([])
    })

    // Fail loudly, because dropping an unreadable puzzle shrinks the denominator.
    // `Array.isArray(hints) && hints.length === 3` is TRUE of most rows below, so a length-only
    // guard hands the reader `undefined`, scores every row `absent`, and reports a ladder held.
    it.each([
      ['a two-rung ladder', ['one', 'two']],
      ['a ladder of bare strings', ['one', 'two', 'three']],
      ['a rung with no text', [{ text: 'one' }, { metadata: { operator: '+', slot: 0 } }, { text: 'three' }]],
      ['a rung whose text is blank', [{ text: 'one' }, { text: '   ' }, { text: 'three' }]],
      ['a rung whose text is not a string', [{ text: 'one' }, { text: 7 }, { text: 'three' }]],
      ['a null rung', [{ text: 'one' }, null, { text: 'three' }]],
      ['no ladder at all', undefined],
    ])('throws on a phrase-backed puzzle carrying %s', (_description, hints) => {
      const broken = { ...missingVowelsPuzzle, data: { answer: 'Whatever', hints } }

      expect(() => selectRows({ complete: true, date: packDate, puzzles: [broken] } as never)).toThrow(
        `Malformed phrase puzzle at ${packDate} #0 (missingvowels)`,
      )
    })
  })

  // A blind test that leaks the answer measures nothing, silently: every row comes back "named
  // first" and the audit reads as a failed ladder. The positive rows matter too, because
  // withholding everything also passes the negatives.
  describe('withheldContext', () => {
    it('never carries the answer, the third rung, any puzzle rendering, or hint metadata', () => {
      const rows = selectRows(auditPack)
      const serialized = JSON.stringify(rows.map(withheldContext))

      expect(serialized).not.toContain('answer')
      expect(serialized).not.toContain(missingVowelsPuzzle.data.answer)
      expect(serialized).not.toContain(missingVowelsPuzzle.data.hints[2].text)
      expect(serialized).not.toContain('displayed')
      expect(serialized).not.toContain(missingVowelsPuzzle.data.displayed)
    })

    it('carries the category and the text of both rungs when the category is shown', () => {
      expect(withheldContext(selectRows(auditPack)[0])).toEqual({
        category: 'Film',
        hints: [missingVowelsPuzzle.data.hints[0].text, missingVowelsPuzzle.data.hints[1].text],
      })
    })

    // No `category: null` and no placeholder: the blind reader gets exactly what the player got.
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

    // The schema bounds nothing, so an over-generous model costs precision, not the run.
    it('keeps at most three candidates', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['a', 'b', 'c', 'd', 'e'] } as never)

      expect(await attemptSolve(selectRows(auditPack)[0])).toEqual(['a', 'b', 'c'])
    })

    // The withheldContext guarantee, on the argument that actually reaches Bedrock.
    it('sends the withheld context and nothing else', async () => {
      const row = selectRows(auditPack)[0]

      await attemptSolve(row)

      const context = jest.mocked(invokeModel).mock.calls[0][2]
      expect(context).toEqual(withheldContext(row))
      expect(JSON.stringify(context)).not.toContain(missingVowelsPuzzle.data.answer)
      expect(JSON.stringify(context)).not.toContain(missingVowelsPuzzle.data.hints[2].text)
    })

    // bedrock.ts does contents.replace('${context}', ...), so interpolating at author time sends
    // instructions and no data.
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

    // Through normalizeAnswer: a string comparison would score most real hits as "absent".
    it('matches case- and punctuation-insensitively', () => {
      expect(classify('TO BE OR NOT TO BE', ['to be, or not to be'])).toBe('named-first')
    })

    it('reports absent for an empty candidate list', () => {
      expect(classify('The Empire Strikes Back', [])).toBe('absent')
    })
  })

  describe('classify recognizes how models actually name a phrase', () => {
    // Exact-token matching scores all of these `absent`, pushing the rate DOWN, which is the
    // direction that must never be wrong.
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

    // The floor on containment, or a short answer matches inside any longer phrase holding it.
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

    // Errored rows leave the denominator rather than counting as `absent`: two of six here, so
    // 2/4 and not 2/6.
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

    // Nothing measured, so 0 over 0 rather than a clean result computed from failures.
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

    // The hidden-category subset is legitimately empty on most packs, and summarize runs over it.
    it('reports a zero leak rate for an empty set rather than NaN', () => {
      expect(summarize([])).toEqual({ absent: 0, errored: 0, leakRate: 0, named: 0, namedFirst: 0, total: 0 })
    })
  })
})
