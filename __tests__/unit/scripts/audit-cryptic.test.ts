import {
  CrypticRow,
  DEFAULT_DAYS,
  MAX_DAYS,
  Result,
  attemptSolve,
  auditCryptic,
  auditDates,
  checkGloss,
  classify,
  glossContext,
  glossOf,
  parseArgs,
  readPacks,
  selectClues,
  summarize,
  withheldContext,
} from '../../../scripts/audit-cryptic'
import { invokeModel } from '@services/bedrock'
import { CrypticClueData, Pack, Puzzle } from '@types'

// The script builds its client at module scope, so this must precede the import above; jest
// hoists jest.mock over imports.
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
}))
jest.mock('@services/bedrock')

const AVAILABLE_FROM = '2026-10-01'

// Rungs in the REAL composed shapes, so glossOf runs against what buildHints emits. A CHARADE
// ladder specifically: its rung 0 is the only composed rung the pool puts first, which the
// no-gloss path needs, and a retired frame here would read as a gloss.
const ladder = (gloss?: string) => [
  { text: gloss ?? 'The answer is built from two or more shorter words, one after the other.' },
  { text: 'The first part is CAR.' },
  { text: 'The answer is CAR + PET.' },
]

const cluePuzzle = (answer: string, clue: string, gloss?: string): Puzzle =>
  ({
    data: {
      answer,
      clue,
      enumeration: [answer.length],
      explanation: '"Floor covering" = CAR (vehicle) + PET (animal)',
      hints: ladder(gloss),
    },
    difficulty: 3,
    estimatedSeconds: 120,
    id: `2026-10-02:crypticclue:abcd1234`,
    type: 'crypticclue',
  }) as Puzzle

// The pre-2026-09-07 stored shape, in full because it looks COMPLETE: `explanation` is the only
// field distinguishing it.
const stalePuzzle = (answer: string, clue: string): Puzzle =>
  ({
    data: {
      answer,
      clue,
      definitionSpan: [0, 5],
      device: 'hidden',
      enumeration: [answer.length],
      fodderSpan: [6, 29],
      hints: [
        { text: 'The wordplay works on "instant angora".' },
        { text: 'The answer begins with T.' },
        { text: 'The answer ends with O.' },
      ],
    },
    difficulty: 3,
    estimatedSeconds: 120,
    id: `2026-10-02:crypticclue:deadbeef`,
    type: 'crypticclue',
  }) as Puzzle

const packOf = (date: string, ...puzzles: Puzzle[]): Pack => ({ complete: false, date, puzzles })

const row: CrypticRow = {
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  date: '2026-10-02',
  enumeration: [5],
  stale: false,
}

const glossedRow: CrypticRow = { ...row, gloss: 'Danced in pairs, and it takes two.' }

const staleRow: CrypticRow = { ...row, stale: true }

const resultOf = (outcome: Result['outcome'], gloss?: Result['gloss'], over = row): Result => ({
  gloss,
  outcome,
  row: over,
})

describe('audit-cryptic', () => {
  describe('withheldContext', () => {
    // An EXACT toEqual rather than not.toHaveProperty, which cannot fail when a field is ADDED.
    it('shows the blind reader the clue and the enumeration and nothing else', () => {
      expect(withheldContext(row)).toEqual({ clue: 'Dance hidden in instant angora', enumeration: [5] })
    })

    // The gloss is the only rung describing the ANSWER, so a reader handed one has the definition.
    it('withholds the gloss even when the row carries one', () => {
      expect(withheldContext(glossedRow)).toEqual({ clue: 'Dance hidden in instant angora', enumeration: [5] })
    })
  })

  describe('glossOf', () => {
    // Rung 0 is the gloss when present and a composed rung when not, so one check, not a scan.
    it('reads a gloss off the head of the ladder', () => {
      expect(glossOf(ladder('Danced in pairs, and it takes two.'))).toEqual('Danced in pairs, and it takes two.')
    })

    // One row per live frame, the list being the whole of what hints.ts composes: a frame added to
    // the pool without a row here reports as a gloss. A framed word gloss is listed although half
    // of it is model prose, because under-reporting supply prompts a look and over-reporting hides
    // a dead prompt.
    it.each([
      ['the letter rung', 'The answer begins with C.'],
      ['the first-part rung', 'The first part is CAR.'],
      ['the all-parts rung', 'The answer is CAR + PET.'],
      ['the source rung', 'The wordplay starts from BRANDY.'],
      ['a charade word gloss', 'The first part is a thing driven on roads.'],
      ['a deletion word gloss', 'The longer word is a strong drink.'],
      ['a doubledefinition word gloss', 'The answer also means a political leaning.'],
      // Still composed although retired: it opens with the all-parts frame.
      [
        'the retired charade device sentence',
        'The answer is built from two or more shorter words, one after the other.',
      ],
    ])('reads no gloss when rung 0 is %s', (_case, text) => {
      expect(glossOf([{ text }, { text: 'x' }, { text: 'y' }] as CrypticClueData['hints'])).toBeUndefined()
    })

    // Retired frames read as a GLOSS rather than structure, so if one reappears someone looks.
    it.each([
      ['the retired fodder rung', 'The wordplay works on "instant angora".'],
      ['the retired ends-with rung', 'The answer ends with O.'],
      [
        'the retired hidden device sentence',
        "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
      ],
      // A definition quote points at printed words and a device sentence is constant.
      ['the retired definition rung', 'The definition is "a soft covering".'],
      [
        'the retired doubledefinition device sentence',
        'Both halves of the clue define the answer; there is no wordplay.',
      ],
    ])('no longer recognizes %s as composed', (_case, text) => {
      expect(glossOf([{ text }, { text: 'x' }, { text: 'y' }] as CrypticClueData['hints'])).toEqual(text)
    })

    it('survives a ladder with no rungs at all', () => {
      expect(glossOf([] as unknown as CrypticClueData['hints'])).toBeUndefined()
    })
  })

  describe('glossContext', () => {
    // The answer and the gloss, not the clue: the question is whether the sentence is true of the
    // word. An exact toEqual for the reason withheldContext gets one.
    it('shows the checker the answer and the gloss and nothing else', () => {
      expect(glossContext(glossedRow)).toEqual({ answer: 'TANGO', gloss: 'Danced in pairs, and it takes two.' })
    })
  })

  describe('checkGloss', () => {
    it('asks nothing at all when the ladder carried no gloss', async () => {
      expect(await checkGloss(row)).toEqual('absent')
      expect(invokeModel).not.toHaveBeenCalled()
    })

    it.each([
      [true, 'sound'],
      [false, 'unsound'],
    ])('turns sound=%s into %s', async (sound, expected) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sound })

      expect(await checkGloss(glossedRow)).toEqual(expected)
    })

    // Its own bucket: counting an unmeasured row as unsound condemns prose nothing read.
    it('buckets a failed check as an error rather than as unsound', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('max_tokens'))

      expect(await checkGloss(glossedRow)).toEqual('error')
    })

    it('sends the same pinned model the solve prompt uses', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sound: true })

      await checkGloss(glossedRow)

      expect(jest.mocked(invokeModel).mock.calls[0][0].config.model).toEqual('us.anthropic.claude-opus-5')
    })
  })

  describe('classify', () => {
    it('scores through normalizeAnswer', () => {
      expect(classify('TANGO', ['tango!', 'waltz', 'polka'])).toEqual('top-1')
      expect(classify('TANGO', ['waltz', 'Tango', 'polka'])).toEqual('top-3')
      expect(classify('TANGO', ['waltz', 'rumba', 'polka'])).toEqual('missed')
    })

    // Exact equality: audit-hints' containment rule is for franchise prefixes and scores TANGOS.
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
    // Different denominators: with countPerDay 1 and bestEffort a night that ships nothing
    // produces NO ROW, so a rate over rows cannot see a supply failure.
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

    // Its own bucket: counting an unmeasured row as a miss argues for pulling an unmeasured type.
    it('excludes errored rows from the denominator and counts them beside it', () => {
      const summary = summarize([], [resultOf('top-1'), resultOf('error')], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ clues: 1, errored: 1, top1Rate: 1 }))
    })

    it('reports zero rather than NaN on an empty window', () => {
      expect(summarize([], [], AVAILABLE_FROM)).toEqual(
        expect.objectContaining({ glossRate: 0, glossSoundRate: 0, supplyRate: 0, top1Rate: 0, top3Rate: 0 }),
      )
    })

    // Four denominators -- NIGHTS, MEASURED CLUES, EVERY ROW, JUDGED GLOSSED -- and this pair
    // separates the last two.
    it('computes the gloss rate over every row and soundness over the glossed ones', () => {
      const summary = summarize(
        [],
        [
          resultOf('top-1', 'sound', glossedRow),
          resultOf('top-1', 'unsound', glossedRow),
          resultOf('missed', 'absent'),
          resultOf('missed', 'absent'),
        ],
        AVAILABLE_FROM,
      )

      expect(summary).toEqual(expect.objectContaining({ glossRate: 0.5, glossSoundRate: 0.5, glossed: 2 }))
    })

    // Gating gloss supply on an unrelated call's success makes an outage read as a dead prompt.
    it('counts a gloss on a row whose blind solve errored', () => {
      const summary = summarize([], [resultOf('error', 'sound', glossedRow)], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ clues: 0, glossRate: 1, glossSoundRate: 1, glossed: 1 }))
    })

    // Shape, not presence: a window of pre-change cryptics reports supply 1.00 on a presence test.
    it('counts supply over nights holding a CURRENT-shape cryptic', () => {
      const packs = [
        packOf('2026-10-01', stalePuzzle('TANGO', 'Dance hidden in instant angora')),
        packOf('2026-10-02', cluePuzzle('WALTZ', 'Floor covering from vehicle with animal')),
      ]

      const summary = summarize(packs, [], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ nights: 2, supplied: 1, supplyRate: 0.5 }))
    })

    // Both counts, because at countPerDay 2 they differ and the runbook's delete step reads dates.
    it('reports stale puzzles and the dates that hold them', () => {
      const packs = [
        packOf(
          '2026-10-01',
          stalePuzzle('TANGO', 'Dance hidden in instant angora'),
          stalePuzzle('WALTZ', 'Dance hidden in slow altzone'),
        ),
        packOf('2026-10-02', cluePuzzle('CARPET', 'Floor covering from vehicle with animal')),
      ]

      const summary = summarize(
        packs,
        [resultOf('stale', undefined, staleRow), resultOf('stale', undefined, staleRow), resultOf('top-1')],
        AVAILABLE_FROM,
      )

      expect(summary).toEqual(expect.objectContaining({ stale: 2, staleNights: 1 }))
    })

    // A stale row left in answers with the OLD prompt's numbers under the new prompt's heading.
    // Out of the solve denominator, out of the ERROR count (where it reads as an outage) and out
    // of both gloss denominators.
    it('keeps stale rows out of every rate', () => {
      const summary = summarize(
        [],
        [resultOf('top-1', 'sound', glossedRow), resultOf('stale', undefined, staleRow)],
        AVAILABLE_FROM,
      )

      expect(summary).toEqual(
        expect.objectContaining({ clues: 1, errored: 0, glossRate: 1, glossSoundRate: 1, top1Rate: 1 }),
      )
    })

    // Its own bucket, for the reason `errored` is out of the solve denominator.
    it('excludes an errored gloss check from the soundness rate', () => {
      const summary = summarize(
        [],
        [resultOf('top-1', 'sound', glossedRow), resultOf('top-1', 'error', glossedRow)],
        AVAILABLE_FROM,
      )

      expect(summary).toEqual(expect.objectContaining({ glossErrored: 1, glossSoundRate: 1, glossed: 2 }))
    })
  })

  describe('selectClues', () => {
    it('reads only crypticclue puzzles', () => {
      const pack = packOf('2026-10-02', cluePuzzle('TANGO', 'Dance hidden in instant angora'), {
        data: { answer: 'x' },
        type: 'cryptogram',
      } as Puzzle)

      expect(selectClues(pack)).toStrictEqual([
        {
          answer: 'TANGO',
          clue: 'Dance hidden in instant angora',
          date: '2026-10-02',
          enumeration: [5],
          gloss: undefined,
          stale: false,
        },
      ])
    })

    it('carries the gloss off the ladder when the night shipped one', () => {
      const pack = packOf('2026-10-02', cluePuzzle('TANGO', 'Dance hidden in instant angora', 'It takes two.'))

      expect(selectClues(pack)[0].gloss).toEqual('It takes two.')
    })

    // glossOf needs a ladder, so a stored puzzle without one is malformed rather than gloss-less.
    it('throws on a stored puzzle carrying no ladder', () => {
      const pack = packOf('2026-10-02', {
        data: { answer: 'TANGO', clue: 'Dance hidden in instant angora', enumeration: [5] },
        id: 'x',
        type: 'crypticclue',
      } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
    })

    // Dropping an unreadable puzzle shrinks the denominator and flatters the solve rate.
    it('throws on a malformed stored puzzle rather than shrinking the denominator', () => {
      const pack = packOf('2026-10-02', { data: {}, id: 'x', type: 'crypticclue' } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
    })

    it('contributes no row for a night that shipped nothing', () => {
      expect(selectClues(packOf('2026-10-02'))).toStrictEqual([])
    })

    // The missing `explanation` is the only signal: delete that check from isCurrentCrypticData
    // and this row alone reddens.
    it('marks a puzzle carrying no explanation as stale', () => {
      const pack = packOf('2026-10-02', stalePuzzle('TANGO', 'Dance hidden in instant angora'))

      expect(selectClues(pack)[0].stale).toBe(true)
    })

    // Dropping hides the migration in a smaller denominator; throwing reports ~250 dates as an
    // exception over the first.
    it('keeps a stale puzzle as a row rather than dropping it or throwing', () => {
      const pack = packOf(
        '2026-10-02',
        stalePuzzle('TANGO', 'Dance hidden in instant angora'),
        cluePuzzle('WALTZ', 'Floor covering from vehicle with animal'),
      )

      expect(selectClues(pack).map((clue) => clue.stale)).toStrictEqual([true, false])
    })

    // No explanation is a dated shape with a known remedy; no ladder is a defect with no cause.
    it('still throws on a malformed puzzle rather than calling it stale', () => {
      const pack = packOf('2026-10-02', { data: { answer: 'TANGO' }, id: 'x', type: 'crypticclue' } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
    })
  })

  describe('auditDates', () => {
    // The window must include tomorrow: the nightly builds nextPackDate(), so one ending today
    // measures the OLD prompt's clues right after a prompt change.
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

    // Why this script does not reuse src/services/dynamodb.ts: getRecentPacks returns [] on error,
    // reporting a false all-clear on expired credentials.
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

    // Silently ignoring `--dayz 1` reads a 30-day window under a one-day heading.
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

    // Load-bearing: an unguarded run spends two Opus calls per row on deleted devices.
    it('reports a stale row without asking the model anything', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          table: [
            { Data: { S: JSON.stringify(packOf('2026-10-02', stalePuzzle('TANGO', 'Dance in instant angora'))) } },
          ],
        },
      })

      const summary = await auditCryptic(['table', '--days', '1'], () => Date.parse('2026-10-02T12:00:00Z'))

      expect(summary).toEqual(expect.objectContaining({ clues: 0, errored: 0, stale: 1, staleNights: 1, supplied: 0 }))
      expect(invokeModel).not.toHaveBeenCalled()
    })

    // The stale check runs BEFORE the --no-model branch, which makes `--no-model` the zero-token
    // stale detector the runbook calls for. Ordered the other way every stale row reads `error`.
    it('separates stale from errored under --no-model', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          table: [
            {
              Data: {
                S: JSON.stringify(
                  packOf(
                    '2026-10-02',
                    stalePuzzle('TANGO', 'Dance in instant angora'),
                    cluePuzzle('CARPET', 'Floor covering from vehicle with animal'),
                  ),
                ),
              },
            },
          ],
        },
      })

      const summary = await auditCryptic(['table', '--no-model'], () => Date.parse('2026-10-02T12:00:00Z'))

      expect(summary).toEqual(expect.objectContaining({ errored: 1, stale: 1, staleNights: 1, supplied: 1 }))
      expect(invokeModel).not.toHaveBeenCalled()
    })
  })
})
