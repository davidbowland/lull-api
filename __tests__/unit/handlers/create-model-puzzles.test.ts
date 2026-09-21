import { readFileSync } from 'fs'
import { join } from 'path'

import { createModelPuzzles, createModelPuzzlesHandler } from '@handlers/create-model-puzzles'
import { getPackByDate, getRecentPacks } from '@services/dynamodb'
import { Candidate, Difficulty, Pack, Puzzle } from '@types'
import { log, logError, logWarning } from '@utils/logging'

const mockFetchFirst = jest.fn()
const mockFetchSecond = jest.fn()
const mockAddModelPuzzles = jest.fn()
const mockMissingDifficulties = jest.fn()

const built = (pack: unknown) => ({ outcome: 'written', pack })
const mockCreatePack = jest.fn()

// Built INSIDE the factory, because babel-plugin-jest-hoist admits an out-of-scope reference only
// for a `mock`-prefixed name. availableFrom must be at or before this suite's packDate, or
// missingDifficulties returns [] for every generator and the suite asserts nothing.
jest.mock('@generators/model', () => ({
  modelGenerators: [
    {
      availableFrom: '2026-08-01',
      baseSeconds: 60,
      countPerDay: 2,
      difficulties: [2, 3],
      fetchCandidates: (...args: unknown[]) => mockFetchFirst(...args),
      secondsPerDifficulty: 15,
      type: 'themedanagrams',
    },
    {
      availableFrom: '2026-08-01',
      baseSeconds: 60,
      countPerDay: 2,
      difficulties: [2, 3],
      // Matches production, and tells a best-effort type at zero (by design) from a required one.
      bestEffort: true,
      fetchCandidates: (...args: unknown[]) => mockFetchSecond(...args),
      secondsPerDifficulty: 15,
      type: 'crypticclue',
    },
  ],
}))

// Partial, keeping the REAL missingDifficulties, and WRAPPED rather than replaced: the spy runs
// for its side effect only, so it is a fault-injection seam for the one row needing a throw from
// the first generator and not the second. Wrapped rather than defaulted, as some rows skip setup().
jest.mock('@services/packs', () => {
  const actual = jest.requireActual<typeof import('@services/packs')>('@services/packs')

  return {
    ...actual,
    addModelPuzzles: (...args: unknown[]) => mockAddModelPuzzles(...args),
    createPack: (...args: unknown[]) => mockCreatePack(...args),
    missingDifficulties: (...args: Parameters<typeof actual.missingDifficulties>) => {
      mockMissingDifficulties(...args)

      return actual.missingDifficulties(...args)
    },
  }
})

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

const packDate = '2026-08-20'

const puzzleFor = (type: string, difficulty: Difficulty): Puzzle =>
  ({ data: {}, difficulty, estimatedSeconds: 60, id: `${packDate}:${type}:x`, type }) as unknown as Puzzle

const packOf = (...puzzles: Puzzle[]): Pack => ({ complete: false, date: packDate, puzzles })

const candidate = (usableAt: Difficulty[]): Candidate => ({ build: jest.fn(), usableAt })

describe('create-model-puzzles', () => {
  // Readings in order, holding the last. GENERATOR_BUDGET_MS needs real timing otherwise.
  const clockOf = (...readings: number[]): (() => number) => {
    let index = 0
    return () => readings[Math.min(index++, readings.length - 1)]
  }

  // Called explicitly per test, because jest.config clears mocks between tests.
  const setup = (): void => {
    mockCreatePack.mockResolvedValue(packOf())
    jest.mocked(getPackByDate).mockResolvedValue(packOf())
    jest.mocked(getRecentPacks).mockResolvedValue([])
    mockAddModelPuzzles.mockResolvedValue(built(packOf()))
    mockFetchFirst.mockResolvedValue([candidate([2]), candidate([3])])
    mockFetchSecond.mockResolvedValue([candidate([2]), candidate([3])])
  }

  // Format only, not isValidPackDate: a manual replay legitimately targets a date in the past.
  it.each([
    ['no date at all', undefined],
    ['a malformed date', 'not-a-date'],
    ['an impossible calendar date', '2026-02-30'],
  ])('refuses %s without touching the table', async (_description, date) => {
    setup()

    await createModelPuzzlesHandler({ date })

    expect(logError).toHaveBeenCalledWith('Invalid date, refusing to generate', { date })
    expect(getPackByDate).not.toHaveBeenCalled()
    expect(mockCreatePack).not.toHaveBeenCalled()
  })

  // The only guard on the non-inRequest self-contained lane, which ships no generator today.
  it('repairs the self-contained lane before any model work', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockCreatePack).toHaveBeenCalledWith(packDate)
    expect(mockCreatePack.mock.invocationCallOrder[0]).toBeLessThan(mockFetchFirst.mock.invocationCallOrder[0])
  })

  it('reads the pack after the repair, not before it', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockCreatePack.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(getPackByDate).mock.invocationCallOrder[0],
    )
  })

  it('does not abort the loop when the self-contained repair fails', async () => {
    setup()
    mockCreatePack.mockRejectedValueOnce(new Error('goFigure is on fire'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Could not repair the self-contained lane',
      expect.objectContaining({ date: packDate }),
    )
    expect(mockFetchFirst).toHaveBeenCalled()
  })

  it('treats a date with no stored pack as one holding no puzzles', async () => {
    setup()
    jest.mocked(getPackByDate).mockResolvedValueOnce(undefined as never)

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).toHaveBeenCalledWith(2, [], packDate)
  })

  // Computed BEFORE the call: with two builders, "incomplete" no longer means "your type is
  // missing".
  it('makes no model call when nothing is missing for a type', async () => {
    setup()
    jest
      .mocked(getPackByDate)
      .mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2), puzzleFor('themedanagrams', 3)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).not.toHaveBeenCalled()
    expect(mockFetchSecond).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Nothing missing for this type, skipping the model call', {
      date: packDate,
      type: 'themedanagrams',
    })
  })

  // The date is handed over too, which is what lets each type's reader sort by distance from it.
  it('asks for as many candidates as the type is missing, once', async () => {
    setup()
    const recent = [packOf(puzzleFor('cryptogram', 2))]
    jest.mocked(getRecentPacks).mockResolvedValueOnce(recent)
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).toHaveBeenCalledTimes(1)
    expect(mockFetchFirst).toHaveBeenCalledWith(1, recent, packDate)
  })

  it('passes the missing set it computed through to the write', async () => {
    setup()
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledWith(packDate, expect.anything(), [3], expect.any(Array))
  })

  // buildPack's put is conditional on the count it read, so one write at the end is one condition.
  it('writes once per generator rather than once at the end', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
  })

  // Told by ORDER, not timing. Not the parallelism row: a two-phase SERIAL fetch passes this too,
  // and the row below is what rejects it.
  it('starts every generator before it writes any of them', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    const lastFetch = Math.max(mockFetchFirst.mock.invocationCallOrder[0], mockFetchSecond.mock.invocationCallOrder[0])
    expect(lastFetch).toBeLessThan(mockAddModelPuzzles.mock.invocationCallOrder[0])
  })

  // Overlap is invisible to call order, so each fetch pushes `enter`, yields a microtask and
  // pushes `exit`: serial gives enter/exit/enter/exit, concurrent enter/enter/exit/exit. ~614s
  // overlapped against a 900-second timeout is GENERATOR_BUDGET_MS's basis.
  it('fetches every generator concurrently rather than one after the other', async () => {
    setup()
    const order: string[] = []
    const yielding = (type: string) => async () => {
      order.push(`enter:${type}`)
      await Promise.resolve()
      order.push(`exit:${type}`)

      return [candidate([2]), candidate([3])]
    }
    mockFetchFirst.mockImplementation(yielding('themedanagrams'))
    mockFetchSecond.mockImplementation(yielding('crypticclue'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(order).toEqual(['enter:themedanagrams', 'enter:crypticclue', 'exit:themedanagrams', 'exit:crypticclue'])
  })

  // The writes stay SERIAL, which the call count cannot see: addModelPuzzles is
  // read-merge-conditional-write and packs.ts logs a lost race below ERROR.
  it('writes one generator at a time rather than concurrently', async () => {
    setup()
    const order: string[] = []
    mockAddModelPuzzles.mockImplementation(async (_date: string, generator: { type: string }) => {
      order.push(`enter:${generator.type}`)
      await Promise.resolve()
      order.push(`exit:${generator.type}`)

      return built(packOf())
    })

    await createModelPuzzlesHandler({ date: packDate })

    expect(order).toEqual(['enter:themedanagrams', 'exit:themedanagrams', 'enter:crypticclue', 'exit:crypticclue'])
  })

  // Promise.all abandons the rest on the first rejection, which is why every generator catches its
  // own. The row below asserts the neighbor RAN; this one that its work LANDED.
  it('still writes the healthy generator when a sibling fetch rejects', async () => {
    setup()
    mockFetchFirst.mockRejectedValueOnce(new Error('bedrock on fire'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(mockAddModelPuzzles).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ type: 'crypticclue' }),
      expect.any(Array),
      expect.any(Array),
    )
  })

  // Keeps the `try` around the WHOLE mapped body. Injected through the packs-mock seam, because
  // `existing` is shared and a hostile pack would throw for both types.
  it('still writes the sibling when a generator throws before its model call', async () => {
    setup()
    mockMissingDifficulties.mockImplementationOnce(() => {
      throw new TypeError('existing.filter is not a function')
    })

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Could not add puzzles for this type',
      expect.objectContaining({ date: packDate, type: 'themedanagrams' }),
    )
    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(mockAddModelPuzzles).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ type: 'crypticclue' }),
      expect.any(Array),
      expect.any(Array),
    )
    // The outer catch's line: what a rejected Promise.all lands on.
    expect(logError).not.toHaveBeenCalledWith('Could not add model puzzles', expect.anything())
  })

  // The arm's own CATCH throwing, which is why the fetch phase is allSettled: a structured logger
  // meeting a circular AWS SDK error throws inside the handler for the throw. `reason` is a
  // STRING, because passing the value that broke the logger back to it throws again.
  it('still writes the sibling when a generator arm rejects outside its own catch', async () => {
    setup()
    mockFetchFirst.mockRejectedValueOnce(new TypeError('bedrock on fire'))
    jest.mocked(logError).mockImplementationOnce(() => {
      throw new TypeError('Converting circular structure to JSON')
    })

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith('A generator arm failed outside its own catch', {
      date: packDate,
      reason: 'TypeError: Converting circular structure to JSON',
      type: 'themedanagrams',
    })
    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(mockAddModelPuzzles).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ type: 'crypticclue' }),
      expect.any(Array),
      expect.any(Array),
    )
    // The outer catch's line. Its absence is the difference between allSettled and all.
    expect(logError).not.toHaveBeenCalledWith('Could not add model puzzles', expect.anything())
  })

  it('does not let one failing type cost its neighbor', async () => {
    setup()
    mockFetchFirst.mockRejectedValueOnce(new Error('bedrock on fire'))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Could not add puzzles for this type',
      expect.objectContaining({ date: packDate, type: 'themedanagrams' }),
    )
    expect(mockFetchSecond).toHaveBeenCalled()
  })

  // The next GET re-reads what is missing, so there is nothing for a person to do. `Model type
  // produced nothing` fires only when addModelPuzzles RETURNED.
  it('warns rather than alarming when Bedrock is unavailable for a type', async () => {
    mockFetchFirst.mockRejectedValueOnce(
      Object.assign(new Error('Bedrock is unable to process your request'), {
        $fault: 'server',
        $metadata: { attempts: 4, httpStatusCode: 503 },
      }),
    )

    await createModelPuzzlesHandler({ date: packDate })

    expect(logWarning).toHaveBeenCalledWith(
      'Could not add puzzles for this type',
      expect.objectContaining({ date: packDate, type: 'themedanagrams' }),
    )
    expect(logError).not.toHaveBeenCalledWith('Could not add puzzles for this type', expect.anything())
    expect(mockFetchSecond).toHaveBeenCalled()
  })

  // The WRITE arm's error selector. These rows refuse the simplification of calling logError
  // unconditionally: candidate.build runs INSIDE addModelPuzzles, so a type whose build calls a
  // model raises its 503 here. The MESSAGE matches the fetch arm's, so a filter sees one line.
  it.each([
    [
      'warns',
      logWarning,
      logError,
      Object.assign(new Error('Bedrock is unable to process your request'), {
        $fault: 'server',
        $metadata: { attempts: 4, httpStatusCode: 503 },
      }),
    ],
    ['alarms', logError, logWarning, new TypeError('candidate.build is not a function')],
  ])('%s when the write itself fails, by cause', async (_description, expected, unexpected, error) => {
    setup()
    mockAddModelPuzzles.mockRejectedValueOnce(error)

    await createModelPuzzlesHandler({ date: packDate })

    expect(expected).toHaveBeenCalledWith(
      'Could not add puzzles for this type',
      expect.objectContaining({ date: packDate, error, type: 'themedanagrams' }),
    )
    expect(unexpected).not.toHaveBeenCalledWith('Could not add puzzles for this type', expect.anything())
    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
  })

  // Short and empty are different pages: the next GET repairs a short type through
  // hasWorkRemaining, and paging for it mutes the stack's one alarm.
  it('reports a partially short model type at log level with both counts', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValueOnce(built(packOf(puzzleFor('themedanagrams', 2))))

    await createModelPuzzlesHandler({ date: packDate })

    expect(log).toHaveBeenCalledWith('Model type is short after its call', {
      date: packDate,
      produced: 1,
      type: 'themedanagrams',
      wanted: 2,
    })
    expect(logError).not.toHaveBeenCalledWith(
      'Model type produced nothing',
      expect.objectContaining({ type: 'themedanagrams' }),
    )
  })

  // A required type at ZERO is the page, and the only thing here that is.
  it('alarms when a required model type produced nothing', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValueOnce(built(packOf(puzzleFor('crypticclue', 2))))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith('Model type produced nothing', {
      candidates: expect.any(Number),
      date: packDate,
      outcome: 'written',
      type: 'themedanagrams',
      wanted: 2,
    })
  })

  // The three zeros, told apart on the line that pages: an empty pool (supply), a pool that would
  // not build (a defect), and a lost write race (not a failure). packs.ts logs the latter two
  // below ERROR, so the FIELDS say which it was.
  it.each([
    ['an empty candidate pool', [], 'written', 0],
    ['a pool whose candidates would not build', [{ build: jest.fn(), usableAt: [2] }], 'nothing-generated', 1],
    ['a write that lost its race', [{ build: jest.fn(), usableAt: [2] }], 'lost-race', 1],
  ])('names %s on the alarm', async (_description, candidates, outcome, expectedCount) => {
    setup()
    mockFetchFirst.mockResolvedValueOnce(candidates)
    mockAddModelPuzzles.mockResolvedValueOnce({ outcome, pack: packOf(puzzleFor('crypticclue', 2)) })

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).toHaveBeenCalledWith(
      'Model type produced nothing',
      expect.objectContaining({ candidates: expectedCount, outcome, type: 'themedanagrams' }),
    )
  })

  // bestEffort suppresses the ALARM and never the attempt; isComplete already skips such a type.
  it('does not alarm for a best-effort type that produced nothing', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValue(built(packOf(puzzleFor('themedanagrams', 2), puzzleFor('themedanagrams', 3))))

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).not.toHaveBeenCalledWith('Model type produced nothing', expect.anything())
    expect(log).toHaveBeenCalledWith('Model type is short after its call', {
      date: packDate,
      produced: 0,
      type: 'crypticclue',
      wanted: 2,
    })
  })

  // Counted against the type's OWN puzzles, so a neighbor's output cannot make it look full.
  it('says nothing about a type that ends full', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValue(
      built(
        packOf(
          puzzleFor('themedanagrams', 2),
          puzzleFor('themedanagrams', 3),
          puzzleFor('crypticclue', 2),
          puzzleFor('crypticclue', 3),
        ),
      ),
    )

    await createModelPuzzlesHandler({ date: packDate })

    expect(logError).not.toHaveBeenCalledWith('Model type produced nothing', expect.anything())
    expect(log).not.toHaveBeenCalledWith('Model type is short after its call', expect.anything())
  })

  it('counts only its own type towards the tally, never a neighbor', async () => {
    setup()
    mockAddModelPuzzles.mockResolvedValueOnce(
      built(packOf(puzzleFor('themedanagrams', 2), puzzleFor('crypticclue', 2), puzzleFor('crypticclue', 3))),
    )

    await createModelPuzzlesHandler({ date: packDate })

    expect(log).toHaveBeenCalledWith('Model type is short after its call', {
      date: packDate,
      produced: 1,
      type: 'themedanagrams',
      wanted: 2,
    })
  })

  // On the WRITE LOOP, not the fetches: a spent budget drops candidates already paid for.
  it('stops writing past the budget and names the types it skipped', async () => {
    setup()

    await createModelPuzzles(packDate, clockOf(0, 0, 890_001))

    expect(mockFetchSecond).toHaveBeenCalled()
    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(mockAddModelPuzzles).toHaveBeenCalledWith(
      packDate,
      expect.objectContaining({ type: 'themedanagrams' }),
      expect.any(Array),
      expect.any(Array),
    )
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['crypticclue'],
    })
  })

  // crypticclue's fetch 503s, so it never had a write to skip -- though a `skipped` read off the
  // registry would name it anyway.
  it('names only the types that still had a write when the budget was spent', async () => {
    setup()
    mockFetchSecond.mockRejectedValueOnce(
      Object.assign(new Error('Bedrock is unable to process your request'), {
        $fault: 'server',
        $metadata: { attempts: 4, httpStatusCode: 503 },
      }),
    )

    await createModelPuzzles(packDate, clockOf(0, 890_001))

    expect(mockAddModelPuzzles).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['themedanagrams'],
    })
  })

  it('writes a type on a reading still inside the budget', async () => {
    setup()

    await createModelPuzzles(packDate, clockOf(0, 0, 889_999))

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
    expect(logError).not.toHaveBeenCalledWith('Model budget spent, skipping the remaining types', expect.anything())
  })

  // 890_000 is 900s minus one write; the two writes here were measured at ~4s together. Bracketed
  // at 889_999 / 890_000 / 890_001, and this row alone pins `>=` over `>`.
  it('spends the budget on a reading exactly at the bound', async () => {
    setup()

    await createModelPuzzles(packDate, clockOf(0, 0, 890_000))

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['crypticclue'],
    })
  })

  // The budget guard sits AFTER the "nothing missing" skip, or a slow night pages over a full pack.
  it('raises no budget ERROR over types that had nothing missing', async () => {
    setup()
    jest
      .mocked(getPackByDate)
      .mockResolvedValueOnce(
        packOf(
          puzzleFor('themedanagrams', 2),
          puzzleFor('themedanagrams', 3),
          puzzleFor('crypticclue', 2),
          puzzleFor('crypticclue', 3),
        ),
      )

    await createModelPuzzles(packDate, clockOf(0, 0, 890_001))

    expect(logError).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Nothing missing for this type, skipping the model call', {
      date: packDate,
      type: 'crypticclue',
    })
  })

  // Why the clock is not a HANDLER parameter: Lambda invokes `handler(event, context, callback)`,
  // so an injectable second parameter is bound to the context and the first now() throws.
  it('runs when invoked the way Lambda invokes it, with a context as the second argument', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate }, { awsRequestId: 'req-1', functionName: 'fn' })

    expect(mockFetchFirst).toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalledWith('Could not add model puzzles', expect.anything())
  })

  // Never rethrown: a Lambda retry re-runs EVERY type, where the next GET re-reads what is missing.
  it('never throws out of the handler', async () => {
    setup()
    jest.mocked(getRecentPacks).mockRejectedValueOnce(new Error('dynamo on fire'))

    await expect(createModelPuzzlesHandler({ date: packDate })).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('Could not add model puzzles', expect.objectContaining({ date: packDate }))
  })

  // A tripwire on whether the fetch phase fits inside the 900-second Lambda timeout. These caps
  // are the only estimate of the slowest generator's wall clock -- ~410s plus ~204s, off
  // bedrock.ts's measured 204s for 16000 tokens -- and nothing else reads either one. Raising one
  // means moving these numbers with it and re-deriving the estimate on crypticclue/review.ts.
  describe('the prompt caps the fetch phase has to fit inside', () => {
    const maxTokensOf = (name: string): number => {
      const [firstLine] = readFileSync(join(__dirname, '../../../prompts', name), 'utf8').split('\n')

      return (JSON.parse(firstLine.replace(/^#\s*/, '')) as { maxTokens: number }).maxTokens
    }

    it.each([
      ['create-cryptic-clues.txt', 32_000],
      ['review-cryptic-clues.txt', 16_000],
    ])('pins %s at %s tokens', (name, expected) => {
      expect(maxTokensOf(name)).toEqual(expected)
    })

    // The pair as a sum, so trading one cap up and the other down reddens here and not above.
    it('keeps the pair inside the 48,000 tokens the fetch phase is estimated from', () => {
      expect(maxTokensOf('create-cryptic-clues.txt') + maxTokensOf('review-cryptic-clues.txt')).toEqual(48_000)
    })
  })
})
