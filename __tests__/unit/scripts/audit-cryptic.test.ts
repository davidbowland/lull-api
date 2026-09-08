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

// A three-rung ladder whose rungs are the REAL composed shapes, so glossOf is exercised against what
// buildHints actually emits rather than against placeholder text. `gloss` replaces rung 0 exactly as
// the pool does.
// A CHARADE ladder, in its gloss-drops/one-word-definition shape -- the only shape whose rung 0 is a
// composed rung the pool can actually put first, which is what this helper needs to exercise the
// no-gloss path. The retired `hidden`/`anagram` ladder that stood here quoted a fodder rung and an
// `ends with` rung, and isComposedRung stopped recognizing either when those frames were deleted, so
// every no-gloss row here silently started reading a structural rung AS a gloss.
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

// THE PRE-2026-09-07 STORED SHAPE, written out in full rather than as `omit(explanation)`, because
// what makes this case dangerous is how COMPLETE it looks: answer, clue, enumeration and a
// well-formed three-rung ladder are all here, and the three fields that came off the wire are all
// present. `explanation` is the only thing that distinguishes it, which is the whole reason the
// guard is a check on that one field and the whole reason nothing else in either repo notices.
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
    // THE MOST IMPORTANT TEST IN THIS SCRIPT, and it is an EXACT toEqual against a literal rather
    // than a set of not.toHaveProperty assertions: an omission-shaped assertion cannot fail when a
    // field is ADDED, which is the direction that leaks. A blind test that leaks the answer measures
    // nothing and does so silently -- every row would come back solved and the audit would read as a
    // triumph. Add `answer: row.answer` to the returned object and this row goes red; the
    // not.toHaveProperty form stays green for every other field added.
    it('shows the blind reader the clue and the enumeration and nothing else', () => {
      expect(withheldContext(row)).toEqual({ clue: 'Dance hidden in instant angora', enumeration: [5] })
    })

    // THE GLOSS IS THE ONE THAT WOULD DO THE MOST DAMAGE. It is the only rung written to describe the
    // ANSWER, so a blind reader handed one is handed a definition and every row comes back solved.
    // CrypticRow started carrying it in the same commit as this row, which is exactly when a
    // `...row` spread in withheldContext would have gone unnoticed.
    it('withholds the gloss even when the row carries one', () => {
      expect(withheldContext(glossedRow)).toEqual({ clue: 'Dance hidden in instant angora', enumeration: [5] })
    })
  })

  describe('glossOf', () => {
    // Rung 0 is the gloss when present and a composed rung when not, so this is one check rather
    // than a scan -- and the check reads the pool's OWN frames through isComposedRung.
    it('reads a gloss off the head of the ladder', () => {
      expect(glossOf(ladder('Danced in pairs, and it takes two.'))).toEqual('Danced in pairs, and it takes two.')
    })

    // ONE ROW PER LIVE FRAME, and the list is the whole of what hints.ts composes. A frame added to
    // the pool without a row here is a structural rung this script would report as a gloss, which
    // inflates the one number the audit exists to produce.
    it.each([
      ['a definition rung', 'The definition is "a soft covering".'],
      ['the letter rung', 'The answer begins with C.'],
      ['the first-part rung', 'The first part is CAR.'],
      ['the all-parts rung', 'The answer is CAR + PET.'],
      ['the source rung', 'The wordplay starts from BRANDY.'],
      ['the charade device sentence', 'The answer is built from two or more shorter words, one after the other.'],
      ['the doubledefinition device sentence', 'Both halves of the clue define the answer; there is no wordplay.'],
    ])('reads no gloss when rung 0 is %s', (_case, text) => {
      expect(glossOf([{ text }, { text: 'x' }, { text: 'y' }] as CrypticClueData['hints'])).toBeUndefined()
    })

    // THE RETIRED FRAMES, asserted to read as a GLOSS rather than as structure -- which is the
    // correct behavior and is stated so nobody "fixes" it back. Nothing emits these any more, and
    // the pack archive that carried them is deleted by this branch's migration, so there is no
    // stored ladder left for isComposedRung to recognize them in. A directional note the audit's own
    // comment already makes: over-reporting a gloss hides a dead prompt, so if one of these ever
    // reappears the gloss rate rises and someone looks.
    it.each([
      ['the retired fodder rung', 'The wordplay works on "instant angora".'],
      ['the retired ends-with rung', 'The answer ends with O.'],
      [
        'the retired hidden device sentence',
        "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
      ],
    ])('no longer recognizes %s as composed', (_case, text) => {
      expect(glossOf([{ text }, { text: 'x' }, { text: 'y' }] as CrypticClueData['hints'])).toEqual(text)
    })

    it('survives a ladder with no rungs at all', () => {
      expect(glossOf([] as unknown as CrypticClueData['hints'])).toBeUndefined()
    })
  })

  describe('glossContext', () => {
    // The ANSWER and the GLOSS, and deliberately not the clue: the question is whether the sentence
    // is true of the word, which the clue has no bearing on. An EXACT toEqual for the reason
    // withheldContext gets one -- an omission-shaped assertion cannot fail when a field is added.
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

    // Its OWN bucket, never folded into `unsound`. A row whose check failed is UNMEASURED, and
    // counting it as unsound would bias the rate downward -- toward condemning prose nothing read.
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
        expect.objectContaining({ glossRate: 0, glossSoundRate: 0, supplyRate: 0, top1Rate: 0, top3Rate: 0 }),
      )
    })

    // FOUR DENOMINATORS, and this is the pair that proves the last two are distinct: supply over
    // NIGHTS, blind-solve quality over MEASURED CLUES, gloss supply over EVERY ROW, gloss soundness
    // over the JUDGED GLOSSED rows. The third and fourth are the ones that look interchangeable and
    // are not -- a row whose blind solve errored still shipped a gloss or did not.
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

    // OVER EVERY ROW, not over the blind-solve denominator. A clue the solver could not be asked
    // about still shipped a gloss or did not, and gating supply on an unrelated call's success would
    // make a Bedrock outage read as a dead prompt.
    it('counts a gloss on a row whose blind solve errored', () => {
      const summary = summarize([], [resultOf('error', 'sound', glossedRow)], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ clues: 0, glossRate: 1, glossSoundRate: 1, glossed: 1 }))
    })

    // SHAPE, NOT PRESENCE. A window whose every stored cryptic predates the device change would
    // report supply 1.00 on a presence test -- healthy-looking nights, not one servable puzzle --
    // and put the whole of the failure into a clue count nobody has a baseline for.
    it('counts supply over nights holding a CURRENT-shape cryptic', () => {
      const packs = [
        packOf('2026-10-01', stalePuzzle('TANGO', 'Dance hidden in instant angora')),
        packOf('2026-10-02', cluePuzzle('WALTZ', 'Floor covering from vehicle with animal')),
      ]

      const summary = summarize(packs, [], AVAILABLE_FROM)

      expect(summary).toEqual(expect.objectContaining({ nights: 2, supplied: 1, supplyRate: 0.5 }))
    })

    // PUZZLES AND DATES, in that order, because they are what a rebuild produces and what an
    // operator deletes. At countPerDay 2 they differ, and the runbook's step reads in dates.
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

    // Left in, a stale row does not merely add noise: it answers with the OLD prompt's numbers under
    // the new prompt's heading. It is out of the solve denominator, out of the ERROR count -- the
    // subtraction this used to be would have absorbed it there, turning a pending migration into
    // what reads as a Bedrock outage -- and out of both gloss denominators.
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

    // Its OWN bucket, out of the soundness denominator, for the reason `errored` is out of the solve
    // denominator: a row nothing read must not read as a row that failed.
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

    // A ladder is required for glossOf to read, so a stored puzzle without one is malformed rather
    // than gloss-less -- the loud direction, for the reason the row below gives.
    it('throws on a stored puzzle carrying no ladder', () => {
      const pack = packOf('2026-10-02', {
        data: { answer: 'TANGO', clue: 'Dance hidden in instant angora', enumeration: [5] },
        id: 'x',
        type: 'crypticclue',
      } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
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

    // THE GUARD. A stored puzzle with no `explanation` predates the 2026-09-07 device change, and
    // that one missing field is the only signal there is: this row's fixture carries a valid answer,
    // clue, enumeration and ladder, exactly as a real archived pack does. Delete the explanation
    // check from isCurrentCrypticData and this goes red while every other row in the file stays
    // green -- which is the state the branch shipped in.
    it('marks a puzzle carrying no explanation as stale', () => {
      const pack = packOf('2026-10-02', stalePuzzle('TANGO', 'Dance hidden in instant angora'))

      expect(selectClues(pack)[0].stale).toBe(true)
    })

    // REPORTED, NOT DROPPED and NOT THROWN. Dropping shrinks the sample and hides the migration in a
    // smaller denominator; throwing reports the state of ~250 dates as an exception over the first
    // one. The operator running the runbook's verification step needs a count.
    it('keeps a stale puzzle as a row rather than dropping it or throwing', () => {
      const pack = packOf(
        '2026-10-02',
        stalePuzzle('TANGO', 'Dance hidden in instant angora'),
        cluePuzzle('WALTZ', 'Floor covering from vehicle with animal'),
      )

      expect(selectClues(pack).map((clue) => clue.stale)).toStrictEqual([true, false])
    })

    // The two bad-puzzle kinds are handled in OPPOSITE directions and this row pins the boundary: no
    // explanation is a dated shape with a known remedy, while no ladder at all is a defect with no
    // expected cause. A future edit that softened the throw into a second stale flag would take the
    // audit's one loud failure away.
    it('still throws on a malformed puzzle rather than calling it stale', () => {
      const pack = packOf('2026-10-02', { data: { answer: 'TANGO' }, id: 'x', type: 'crypticclue' } as Puzzle)

      expect(() => selectClues(pack)).toThrow('refusing to audit a partial window')
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

    // NO MODEL CALL ON A STALE ROW, and the assertion on invokeModel is the load-bearing half. Two
    // Opus calls per row is what an unguarded run spends measuring clues whose devices were deleted
    // -- and it would spend them producing a solve rate for the OLD prompt under the new prompt's
    // heading.
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

    // The stale check runs BEFORE the --no-model branch, which is what makes `--no-model` the
    // zero-token stale detector the runbook's verification step calls for. Ordered the other way,
    // every stale row comes back as `error` under exactly the flag someone verifying a deploy
    // reaches for -- and `error` is the bucket that means "this instrument could not read the row",
    // which sends an operator looking at credentials instead of at the migration.
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
