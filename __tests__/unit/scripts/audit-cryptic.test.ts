import {
  CrypticRow,
  DEFAULT_DAYS,
  MAX_DAYS,
  Result,
  attemptSolve,
  auditCryptic,
  auditDates,
  classify,
  parseArgs,
  readPacks,
  selectClues,
  summarize,
  withheldContext,
} from '../../../scripts/audit-cryptic'
import { invokeModel } from '@services/bedrock'
import { Pack, Puzzle } from '@types'

// The whole SDK, mocked the way the sibling audit suite does it. The script constructs its client at
// module scope, so this has to be in place before the import above is evaluated -- jest hoists
// jest.mock calls above imports, which is what makes that work.
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@services/bedrock')

const AVAILABLE_FROM = '2026-10-01'

const cluePuzzle = (answer: string, clue: string): Puzzle =>
  ({
    data: { answer, clue, definitionSpan: { end: 5, start: 0 }, device: 'hidden', enumeration: [answer.length] },
    difficulty: 3,
    estimatedSeconds: 120,
    id: `2026-10-02:crypticclue:abcd1234`,
    type: 'crypticclue',
  }) as Puzzle

const packOf = (date: string, ...puzzles: Puzzle[]): Pack => ({ complete: false, date, puzzles })

const row: CrypticRow = {
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  date: '2026-10-02',
  enumeration: [5],
}

const resultOf = (outcome: Result['outcome']): Result => ({ outcome, row })

describe('audit-cryptic', () => {
  describe('withheldContext', () => {
    // THE MOST IMPORTANT TEST IN THIS SCRIPT, and it is an EXACT toEqual against a literal rather
    // than a set of not.toHaveProperty assertions: an omission-shaped assertion cannot fail when a
    // field is ADDED, which is the direction that leaks. A blind test that leaks the answer measures
    // nothing and does so silently -- every row would come back solved and the audit would read as a
    // triumph. Add `answer: row.answer` to the returned object and this row goes red; the
    // not.toHaveProperty form stays green for every other field added.
    it('shows the blind reader the clue and the enumeration and nothing else', () => {
      expect(withheldContext(row)).toEqual({ clue: 'Dance hidden in instant angora', enumeration: [5] })
    })
  })

  describe('classify', () => {
    it('scores through normalizeAnswer', () => {
      expect(classify('TANGO', ['tango!', 'waltz', 'polka'])).toEqual('top-1')
      expect(classify('TANGO', ['waltz', 'Tango', 'polka'])).toEqual('top-3')
      expect(classify('TANGO', ['waltz', 'rumba', 'polka'])).toEqual('missed')
    })

    // EXACT equality, not audit-hints' containment rule. That rule exists because a model names a
    // film with its franchise in front of it; a one-word answer has no such variation, and
    // containment over a five-letter token would score TANGOS as a hit.
    it('does not score an inflection of the answer as a hit', () => {
      expect(classify('TANGO', ['tangos', 'waltz', 'polka'])).toEqual('missed')
    })

    it('reads no more than three candidates, whatever the model returned', () => {
      expect(classify('TANGO', ['waltz', 'rumba', 'polka', 'tango'])).toEqual('missed')
    })

    it('handles an empty candidate list', () => {
      expect(classify('TANGO', [])).toEqual('missed')
    })
  })

  describe('summarize', () => {
    // SUPPLY AND QUALITY HAVE DIFFERENT DENOMINATORS, and conflating them is the arithmetic error
    // this pair of assertions exists for. With countPerDay 1 and bestEffort, a night that ships
    // nothing produces NO ROW -- so a rate over rows cannot see a supply failure at all.
    it('computes supply over packs at or after availableFrom', () => {
      const packs = [
        packOf('2026-09-30', cluePuzzle('TANGO', 'Dance hidden in instant angora')),
        packOf('2026-10-01', cluePuzzle('TANGO', 'Dance hidden in instant angora')),
        packOf('2026-10-02', cluePuzzle('WALTZ', 'Dance hidden in slow altzone')),
        packOf('2026-10-03'),
      ]

      const summary = summarize(packs, [], AVAILABLE_FROM)

      expect(summary.nights).toEqual(3)
      expect(summary.supplied).toEqual(2)
      expect(summary.supplyRate).toEqual(2 / 3)
    })

    it('computes both solve rates over clues rather than over nights', () => {
      const summary = summarize([], [resultOf('top-1'), resultOf('top-3')], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ clues: 2, top1Rate: 0.5, top3Rate: 1 }))
    })

    // Its OWN bucket, never folded into `missed`. A row whose solve attempt failed is an UNMEASURED
    // row, and counting it as a miss would bias the rate downward -- toward pulling a type that
    // nothing measured.
    it('excludes errored rows from the denominator and counts them beside it', () => {
      const summary = summarize([], [resultOf('top-1'), resultOf('error')], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ clues: 1, errored: 1, top1Rate: 1 }))
    })

    it('reports zero rather than NaN on an empty window', () => {
      expect(summarize([], [], AVAILABLE_FROM)).toEqual(
        expect.objectContaining({ supplyRate: 0, top1Rate: 0, top3Rate: 0 }),
      )
    })
  })

  describe('selectClues', () => {
    it('reads only crypticclue puzzles', () => {
      const pack = packOf('2026-10-02', cluePuzzle('TANGO', 'Dance hidden in instant angora'), {
        data: { answer: 'x' },
        type: 'cryptogram',
      } as Puzzle)

      expect(selectClues(pack)).toStrictEqual([
        { answer: 'TANGO', clue: 'Dance hidden in instant angora', date: '2026-10-02', enumeration: [5] },
      ])
    })

    // Loudly, and it stops the run. Quietly dropping an unreadable puzzle would shrink the
    // denominator and make the solve rate look better than it is.
    it('throws on a malformed stored puzzle rather than shrinking the denominator', () => {
      const pack = packOf('2026-10-02', { data: {}, id: 'x', type: 'crypticclue' } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
    })

    it('contributes no row for a night that shipped nothing', () => {
      expect(selectClues(packOf('2026-10-02'))).toStrictEqual([])
    })
  })

  describe('auditDates', () => {
    // The window must INCLUDE tomorrow. The nightly builds nextPackDate(), so tomorrow is the newest
    // pack that exists, and a window ending today would measure clues written by the OLD prompt
    // right after a prompt change and report the number as the new one's.
    it('ends with tomorrow, newest first', () => {
      const dates = auditDates({ days: 3, tableName: 'x', useModel: true }, () => Date.parse('2026-10-02T12:00:00Z'))

      expect(dates).toStrictEqual(['2026-10-03', '2026-10-02', '2026-10-01'])
    })

    it('handles a single-day window', () => {
      const dates = auditDates({ days: 1, tableName: 'x', useModel: true }, () => Date.parse('2026-10-02T12:00:00Z'))

      expect(dates).toStrictEqual(['2026-10-03'])
    })
  })

  describe('readPacks', () => {
    // Shared default, per CLAUDE.md; each row overrides with mockResolvedValueOnce.
    beforeAll(() => {
      mockSend.mockResolvedValue({ Responses: { table: [] } })
    })

    it('returns the packs oldest first', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          table: [
            { Data: { S: JSON.stringify(packOf('2026-10-03')) } },
            { Data: { S: JSON.stringify(packOf('2026-10-01')) } },
          ],
        },
      })

      expect((await readPacks('table', ['2026-10-01'])).map((pack) => pack.date)).toStrictEqual([
        '2026-10-01',
        '2026-10-03',
      ])
    })

    // A short read is a quieter, better-looking solve rate, and these two throws are the entire
    // reason this script does not reuse src/services/dynamodb.ts -- getRecentPacks swallows every
    // error and returns [], so an audit built on it reports a false all-clear on expired credentials.
    it('throws on UnprocessedKeys rather than reporting a shorter window', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { table: [] }, UnprocessedKeys: { table: {} } })

      await expect(readPacks('table', ['2026-10-01'])).rejects.toThrow('left keys unprocessed')
    })

    it('throws on zero packs, because zero packs is never a clean audit', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { table: [] } })

      await expect(readPacks('table', ['2026-10-01'])).rejects.toThrow('No packs found')
    })

    it('does not swallow a read failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('ExpiredToken'))

      await expect(readPacks('table', ['2026-10-01'])).rejects.toThrow('ExpiredToken')
    })
  })

  describe('parseArgs', () => {
    it('reads the test table by default', () => {
      expect(parseArgs([])).toStrictEqual({ days: DEFAULT_DAYS, tableName: 'lull-api-packs-test', useModel: true })
    })

    it('takes production as a positional argument', () => {
      expect(parseArgs(['lull-api-packs']).tableName).toEqual('lull-api-packs')
    })

    it('takes a window inside the ceiling', () => {
      expect(parseArgs(['--days', `${MAX_DAYS}`]).days).toEqual(MAX_DAYS)
    })

    it('skips the model on request', () => {
      expect(parseArgs(['--no-model']).useModel).toBe(false)
    })

    // An audit that silently ignored `--dayz 1` would read a 30-day window and report a number the
    // operator would attribute to one day.
    it.each([
      [['--dayz', '1']],
      [['--days', `${MAX_DAYS + 1}`]],
      [['--days', '0']],
      [['--days', 'x']],
      [['one', 'two']],
    ])('throws on %s', (argv) => {
      expect(() => parseArgs(argv)).toThrow()
    })
  })

  describe('attemptSolve', () => {
    it('sends the withheld context and nothing else', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['tango', 'waltz', 'polka'] })

      expect(await attemptSolve(row)).toStrictEqual(['tango', 'waltz', 'polka'])
      expect(invokeModel).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
        clue: 'Dance hidden in instant angora',
        enumeration: [5],
      })
    })

    it('pins its model to the one the Bedrock grant is scoped to', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['tango'] })
      await attemptSolve(row)

      expect(jest.mocked(invokeModel).mock.calls[0][0].config.model).toEqual('us.anthropic.claude-opus-5')
    })
  })

  describe('auditCryptic', () => {
    it('reports both rates over a window it read', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          table: [
            { Data: { S: JSON.stringify(packOf('2026-10-02', cluePuzzle('TANGO', 'Dance in instant angora'))) } },
          ],
        },
      })
      jest.mocked(invokeModel).mockResolvedValueOnce({ candidates: ['tango', 'waltz', 'polka'] })

      const summary = await auditCryptic(['table', '--days', '1'], () => Date.parse('2026-10-02T12:00:00Z'))

      expect(summary).toEqual(expect.objectContaining({ clues: 1, supplied: 1, top1Rate: 1, top3Rate: 1 }))
    })

    it('buckets a failed solve as an error rather than as a miss', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          table: [
            { Data: { S: JSON.stringify(packOf('2026-10-02', cluePuzzle('TANGO', 'Dance in instant angora'))) } },
          ],
        },
      })
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('max_tokens'))

      const summary = await auditCryptic(['table', '--days', '1'], () => Date.parse('2026-10-02T12:00:00Z'))

      expect(summary).toEqual(expect.objectContaining({ clues: 0, errored: 1, top3Rate: 0 }))
    })
  })
})
