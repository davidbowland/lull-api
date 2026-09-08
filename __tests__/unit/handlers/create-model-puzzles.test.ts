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

// addModelPuzzles returns the write OUTCOME alongside the pack, because three different failures
// reach `Model type produced nothing` and the alert named none of them. Every arrangement here means
// "the write went through"; the rows that care about a different outcome say so themselves.
const built = (pack: unknown) => ({ outcome: 'written', pack })
const mockCreatePack = jest.fn()

// The generators are built INSIDE the factory. jest.mock is hoisted above every declaration in the
// file and babel-plugin-jest-hoist admits an out-of-scope reference only for a `mock`-prefixed name
// or a const with a pure initializer -- so a `const first = generatorFor(...)` referenced from here
// fails the whole suite at transform. The fetch mocks are `mock`-prefixed, which is what lets the
// factory reach them.
//
// modelGenerators ships TWO entries today -- themedAnagramsGenerator then crypticClueGenerator. It
// shipped EMPTY when this suite was written, which is what these fakes were for; they still earn
// their place, because mocking the registry is what lets the budget guard, the shortfall ERROR and
// the per-generator write be driven over shapes the two real generators do not produce.
//
// availableFrom is at or BEFORE this suite's packDate. A fixture dated after the date under test
// applies to nothing, missingDifficulties returns [] for every generator, and the whole suite goes
// green while asserting nothing.
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
      // bestEffort MATCHES PRODUCTION, where crypticClueContribution declares it. It is only read by
      // the shortfall arm below -- the flag's whole documented job is to suppress the ALARM and never
      // the attempt -- so without it here the suite could not tell a best-effort type that produced
      // nothing (expected, by design) from a required one that produced nothing (the page).
      bestEffort: true,
      fetchCandidates: (...args: unknown[]) => mockFetchSecond(...args),
      secondsPerDifficulty: 15,
      type: 'crypticclue',
    },
  ],
}))

// PARTIAL, keeping the REAL missingDifficulties. It is a pure function of a contribution and the
// puzzles already stored, and it is what the "nothing missing for this type" row is actually about --
// automocking it would make that row assert only that the handler honors whatever a stub returned,
// and the pack fixture it names would never reach the branch it is named for.
//
// missingDifficulties is WRAPPED rather than replaced, and the wrapper calls the spy for its side
// effect only before returning the real answer. So every row still runs the real function, and the
// spy exists as a FAULT-INJECTION SEAM: one row needs missingDifficulties to throw for the first
// generator and not the second, which no pack fixture can arrange -- `existing` is one array shared
// by both mapped functions, so a hostile fixture throws for both and proves nothing about a sibling
// surviving. Arming it with mockImplementationOnce is the only thing that separates the two.
//
// Wrapped rather than defaulted through setup(), because several rows here deliberately do not call
// setup(); a spy with no implementation would return undefined for those and take `missing.length`
// down with it.
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
  // A FIXED clock, injected, returning the given readings in order and holding the last one.
  // GENERATOR_BUDGET_MS is otherwise untestable without a real clock, and a fake-timer approach
  // would still be timing.
  const clockOf = (...readings: number[]): (() => number) => {
    let index = 0
    return () => readings[Math.min(index++, readings.length - 1)]
  }

  // A named setup() called explicitly. jest.config clears mocks between tests, so the shared
  // defaults are re-armed here rather than in a beforeEach.
  const setup = (): void => {
    mockCreatePack.mockResolvedValue(packOf())
    jest.mocked(getPackByDate).mockResolvedValue(packOf())
    jest.mocked(getRecentPacks).mockResolvedValue([])
    mockAddModelPuzzles.mockResolvedValue(built(packOf()))
    mockFetchFirst.mockResolvedValue([candidate([2]), candidate([3])])
    mockFetchSecond.mockResolvedValue([candidate([2]), candidate([3])])
  }

  // An unvalidated event field reaching a DynamoDB key is an unbounded key, and this one names both
  // the pack to fill and the dates to read. Format only, not isValidPackDate: a manual replay
  // legitimately targets a date in the past.
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

  // The non-inRequest self-contained lane, which nothing else repairs, and the ONLY guard it has:
  // Phase 1 ships no inRequest: false self-contained generator at all, so this line has no occupant
  // and would otherwise rot.
  it('repairs the self-contained lane before any model work', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockCreatePack).toHaveBeenCalledWith(packDate)
    expect(mockCreatePack.mock.invocationCallOrder[0]).toBeLessThan(mockFetchFirst.mock.invocationCallOrder[0])
  })

  // Read AFTER the repair, so what the repair wrote counts.
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

  // Missing difficulties are computed BEFORE the model call. With two builders behind one flag,
  // "the pack is incomplete" no longer means "your type is missing", so an invocation that fetches
  // first burns Opus tokens to add nothing.
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

  // ONE call per type per pack, never one per puzzle, asked for exactly what is missing and handed
  // the recent packs rather than a pre-flattened exclusion list -- plus the date being built, which
  // is what lets each type's narrowed reader sort a two-directional window by distance from it.
  it('asks for as many candidates as the type is missing, once', async () => {
    setup()
    const recent = [packOf(puzzleFor('cryptogram', 2))]
    jest.mocked(getRecentPacks).mockResolvedValueOnce(recent)
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockFetchFirst).toHaveBeenCalledTimes(1)
    expect(mockFetchFirst).toHaveBeenCalledWith(1, recent, packDate)
  })

  // The handler's ask is authoritative: `missing` is passed through to addModelPuzzles rather than
  // left to be re-derived against a later read.
  it('passes the missing set it computed through to the write', async () => {
    setup()
    jest.mocked(getPackByDate).mockResolvedValueOnce(packOf(puzzleFor('themedanagrams', 2)))

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledWith(packDate, expect.anything(), [3], expect.any(Array))
  })

  // buildPack's put is conditional on the count it read, so one write after 800 seconds is a single
  // condition a racing GET can invalidate, discarding every type's model output.
  it('writes once per generator rather than once at the end', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
  })

  /*
   * PHASE SEPARATION -- all fetches before any write -- told by ORDER rather than by timing. There is
   * no clock in this row and there must not be one.
   *
   * A serial loop puts a write between the two fetches, so the second fetch's call order is HIGHER
   * than the first write's. Fetching first and writing after puts both fetches below every write, and
   * that inequality is the whole difference. jest's invocationCallOrder is one counter shared across
   * mocks, which is what lets three of them be compared at all.
   *
   * IT IS NOT THE PARALLELISM ROW, and the pair of rows is kept adjacent because that distinction was
   * missed once already. This one is satisfied by a TWO-PHASE SERIAL fetch -- `for (const g of
   * modelGenerators) fetched.push(await arm(g))` followed by the same write loop -- which passes every
   * assertion here while taking fetch wall clock from max() back to sum(). The row below is the one
   * that rejects that, and the two hold different properties: this one that no write can be blocked
   * behind a later type's Opus call, that one that the Opus calls overlap at all.
   *
   * The residual this replaces was written into the handler as design: "when Themed Anagrams runs
   * past 300s, Cryptic Clue is skipped". Two independent generators, one starving the other of a
   * budget they only shared because a `for` loop said so.
   */
  it('starts every generator before it writes any of them', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate })

    const lastFetch = Math.max(mockFetchFirst.mock.invocationCallOrder[0], mockFetchSecond.mock.invocationCallOrder[0])
    expect(lastFetch).toBeLessThan(mockAddModelPuzzles.mock.invocationCallOrder[0])
  })

  /*
   * THE FETCHES OVERLAP, which is the whole content of the change and which call ORDER cannot see.
   * Two-phase serial fetching calls the same two mocks in the same sequence; only whether the second
   * STARTS before the first FINISHES tells them apart, and invocationCallOrder records starts.
   *
   * Asserted by the technique the write row below already uses, pointed at the other phase: each fetch
   * pushes an `enter` marker, yields once, and pushes an `exit`. Serial fetching yields
   * enter/exit/enter/exit; concurrent fetching yields enter/enter/exit/exit, because the first arm
   * suspends at its yield and the map goes straight on to the second. The yield is a resolved-promise
   * microtask rather than a timer, so this is deterministic and needs no fake clock.
   *
   * WHAT IT IS WORTH, since it is easy to read as a style assertion: crypticclue's fetchCandidates is
   * two serial Bedrock calls estimated near 614s and themedanagrams' near 250s. Overlapped that is
   * ~614s against the 900-second Lambda timeout; queued it is ~864s, which leaves the write loop ~36s
   * and is the reason GENERATOR_BUDGET_MS could move to 890_000 at all. A silent revert to serial
   * fetching is a silent revert of the budget constant's entire justification, and until this row
   * existed the suite stayed green through one.
   */
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

  /*
   * THE WRITES STAY SERIAL, and the count above cannot see it: two overlapping writes are still two
   * calls. addModelPuzzles is read-merge-conditional-write and its put is conditional on the puzzle
   * count it read, so two concurrent writes are two racers on one condition and the loser's puzzles
   * are discarded -- quietly, because services/packs.ts logs a lost race below ERROR.
   *
   * Asserted by making each write YIELD once in the middle. Interleaved writes give
   * enter/enter/exit/exit; serial ones give enter/exit/enter/exit. The yield is a resolved-promise
   * microtask rather than a timer, so the row is deterministic and needs no fake clock.
   */
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

  /*
   * PROMISE.ALL REJECTS ON THE FIRST REJECTION AND ABANDONS THE REST, which is why every generator
   * catches its own failure inside the mapped function. An uncaught throw out of one fetch would
   * discard a sibling that had already come back -- paid for in Opus tokens, thrown away for a
   * neighbor's 503 -- which is the whole-night loss the concurrent fetch exists to remove, rebuilt
   * one level up. services/phrases.ts states the same rule at its own Promise.all.
   *
   * The row below it asserts the neighbor still RAN; this one asserts its work still LANDED.
   */
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

  /*
   * THE THROW THAT IS NOT A BEDROCK THROW, and the row that keeps the `try` around the WHOLE mapped
   * body rather than around the fetch alone.
   *
   * It shipped with missingDifficulties and its log OUTSIDE the try, which made "each arm catches its
   * own failure" nearly true and therefore useless. The concrete path is not exotic: a pack row whose
   * stored Data deserializes with `puzzles` as an object rather than an array survives
   * `?.puzzles ?? []`, and `existing.filter` inside missingDifficulties throws a TypeError for the
   * first generator while the second's Opus call is already in flight -- Promise.all rejects, the
   * outer catch returns, the container freezes on a pending Bedrock call, and NOTHING is written. The
   * serial loop this replaced paid zero tokens for that same throw.
   *
   * The throw is INJECTED for the first generator only, through the seam described at the packs
   * mock, and it has to be: `existing` is one array shared by both mapped functions, so the hostile
   * pack fixture that motivates this row would throw for BOTH types and could never show a sibling
   * surviving. The TypeError carries the message that fixture produces, so the row names the defect
   * it stands for.
   */
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
    // The outer catch's line, which is the SIGNATURE of the bug: it is what a rejected Promise.all
    // lands on, and it is the only place the un-fixed handler reports this throw at all.
    expect(logError).not.toHaveBeenCalledWith('Could not add model puzzles', expect.anything())
  })

  /*
   * THE ARM'S OWN CATCH THROWING, which is the case `Promise.all` could not survive and the reason the
   * fetch phase is `Promise.allSettled`.
   *
   * The two rows above prove the arm catches what its GENERATOR throws. Neither says anything about
   * the catch itself, and the catch is two lines of logger call: a structured logger meeting a
   * circular AWS SDK error -- `error.$response` holding a socket that references the request -- throws
   * inside the handler for the throw. Under `all` that rejected the whole phase and discarded the
   * sibling's completed ~410s of Opus output, which is exactly the loss the concurrent fetch was
   * introduced to remove.
   *
   * Injected by making logError throw ONCE, at the moment the first arm reports a non-transient
   * fetch failure. The row asserts both halves: crypticclue's write still lands, and the rejection
   * gets a line of its own naming the type. That line carries `reason` as a STRING and not the error
   * object -- passing the value that just broke the logger back to the same logger is how this line
   * throws too, and it sits outside every per-type try, so it would cost the writes anyway.
   */
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
    // The outer catch's line, which is what a rejected fetch phase lands on. Its absence is the
    // difference between allSettled and all.
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

  /*
   * WARN when the model service was unavailable, and the OTHER type still runs.
   *
   * A 503 out of fetchCandidates leaves the type short, the pack incomplete, and the next GET for
   * this date re-reads what is missing -- there is nothing for a person to do. `Model type produced
   * nothing` is deliberately untouched by this: it fires only when addModelPuzzles RETURNED and
   * added none, so no upstream failure reaches it, and it is the line that caught themedanagrams
   * coming back empty on the prod nightly.
   */
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

  /*
   * THE OTHER HALF OF THE OLD PER-TYPE ARM. Splitting the fetch and the write into two catches created
   * a second error arm, and it shipped with no row on it at all -- jest reported the whole block
   * uncovered, and mockAddModelPuzzles was never made to reject anywhere in this file.
   *
   * WHAT IT CARRIES IS DIFFERENT FROM THE FETCH ARM'S: a gate that threw, a payload ajv refused, a
   * DynamoDB failure services/packs.ts did not swallow. Almost all of that is a defect and pages, and
   * the obvious simplification is to drop the selector here and call logError unconditionally. These
   * two rows are what refuses that. candidate.build runs INSIDE addModelPuzzles, so a type whose build
   * calls a model raises its 503 on THIS side of the split, and reducing the arm to logError would
   * page for the model service being unavailable -- the exact noise `warns rather than alarming when
   * Bedrock is unavailable` exists to keep out of the level="ERROR" subscription, arriving through the
   * other door.
   *
   * The MESSAGE is deliberately the same string the fetch arm writes, and both rows assert it: one
   * failure had one line before the split, and a subscription filter written against the old handler
   * must not go half blind on the day it shipped. `type` is what says which type it was.
   *
   * Rejected ONCE, for themedanagrams, so each row also shows the neighbor's write still landing --
   * the per-type swallow is what keeps a Lambda retry from re-running the types that succeeded.
   */
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

  /*
   * SHORT AND EMPTY ARE DIFFERENT PAGES. Same rule as the phrase handler, same reason.
   *
   * A type that wanted two and got one leaves the pack incomplete, which the next GET repairs
   * through hasWorkRemaining. Paging for it is how the level="ERROR" subscription -- the only alarm
   * in this stack -- becomes a filter people mute, and a muted alarm still looks like coverage.
   * 2026-08-26 is the case in hand: themedanagrams came back one short of three, the pack shipped
   * twelve of thirteen puzzles, and that raised the same alarm a total generation failure does.
   */
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

  // A required type at ZERO is a pipeline that returned nothing, which is the shape every incident
  // in this handler's history actually had. That is the page, and it is the only thing here that is.
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

  /*
   * THE THREE ZEROS, TOLD APART ON THE LINE THAT PAGES.
   *
   * A prod nightly raised this alarm for themedanagrams on 2026-09-05 and the email said only that
   * the type was empty. Three unrelated things produce that: an empty candidate pool (supply), a
   * pool whose every candidate failed to build (a generator defect), and a conditional write that
   * lost its race -- where the puzzles WERE built and the stored pack came back instead, which is
   * not a failure at all. services/packs.ts logs the latter two below ERROR, so the alert carried no
   * trace of either and telling them apart needed a log dive.
   *
   * One row per cause, asserting the FIELDS rather than the level, because all three still page --
   * what changed is that the page now says which one it was.
   */
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

  // bestEffort suppresses the ALARM and never the attempt (services/packs.ts). A best-effort type at
  // zero is the outcome that flag exists to declare acceptable -- isComplete already skips it, so
  // paging for it would alarm on a pack the client is not even asked to refetch.
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

  // Counted against the type's OWN puzzles in the merged pack, so a neighbor's output cannot make a
  // short type look full.
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

  /*
   * A wall-clock budget on the WRITE LOOP, not on the fetches and not per type. It bounds when the
   * LAST WRITE may START and it is checked once per iteration against a single `start`.
   *
   * IT USED TO BOUND THE FETCHES AND THIS ROW USED TO ASSERT SO -- `expect(mockFetchSecond).not
   * .toHaveBeenCalled()`. It cannot any more, and the assertion below says why rather than being
   * quietly dropped: every fetch starts concurrently before the first reading is taken, so there is
   * nothing sequential in front of one for a clock to stop. What a spent budget skips now is the
   * WRITE, and the type's candidates are dropped after being paid for -- which is the outcome that
   * makes the bound 900s minus a WRITE rather than anything derived from a fetch.
   *
   * `skipped` NAMES ONLY TYPES THAT HAD A WRITE TO LOSE. It used to be read off the registry, sliced
   * from this generator's index, which named later types whose fetch had already failed and already
   * logged -- attributing to a spent budget a type that never had a write to skip. The row below,
   * where the second type's fetch rejects, is what holds that.
   */
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

  /*
   * THE ALARM MUST NOT CLAIM A TYPE IT DID NOT COST, which is what `skipped` did the day the fetches
   * went concurrent.
   *
   * The scenario, and it is an ordinary night rather than a contrived one: themedanagrams comes back
   * with candidates, crypticclue 503s and logs its own WARN, and the budget is spent by the time the
   * write loop takes its first reading. Read off the registry -- `modelGenerators.slice(indexOf(...))`
   * -- the ERROR said `['themedanagrams', 'crypticclue']`, blaming a spent budget for a type whose
   * fetch had already failed for an unrelated reason and which never had a write to skip. Whoever the
   * level="ERROR" subscription wakes then goes looking for a budget problem in the wrong type.
   *
   * The undefined holes in the settled results are exactly the types with nothing outstanding, so the
   * corrected list is derived from those and this row is what pins it: one name, not two.
   */
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

  // The budget cannot interrupt a write already in flight, and it must not fire a millisecond early:
  // one reading below the bound still writes its type.
  it('writes a type on a reading still inside the budget', async () => {
    setup()

    await createModelPuzzles(packDate, clockOf(0, 0, 889_999))

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(2)
    expect(logError).not.toHaveBeenCalledWith('Model budget spent, skipping the remaining types', expect.anything())
  })

  // The bound itself, bracketed at 889_999 / 890_000 / 890_001 -- the BEHAVIORAL pin on
  // GENERATOR_BUDGET_MS, and still worth having now that the constant is exported: index.test.ts
  // asserts the number against template.yaml's 900-second timeout, and these three assert that the
  // handler actually compares against it.
  //
  // 890_000 is 900 minus one WRITE. addModelPuzzles is a GetItem, the local candidate.build work and
  // one conditional UpdateItem -- the two writes this handler makes are ~4s together -- so the 10s
  // reserve is ~2.5x the work it covers.
  //
  // IT WAS 300_000 while the guard bounded the fetches, and carrying that number across to a guard on
  // the write loop would have lost every night: the loop now begins when the SLOWEST fetch settles,
  // crypticclue's is two serial Bedrock calls estimated near 614s, so the FIRST reading would have
  // been past the bound and both types' finished candidates dropped unwritten.
  //
  // IT WAS THEN 870_000, AND 30 SECONDS OF RESERVE WAS NOT CAUTION, IT WAS DESTRUCTION. The reserve
  // was nominally sized for the SDK retrying a throttled conditional write, which dynamodb.ts leaves
  // at the default standard mode -- 3 attempts, 100ms base, under a second of backoff. Meanwhile the
  // guard fires on the FIRST entry when it fires at all, so a bound 30s below the ceiling threw away
  // BOTH types' paid-for candidates across the whole 26-second window in which the writes would still
  // have fit, to save the 4-second window in which they would not. Every second added back to this
  // reserve buys a certain loss against a hypothetical one, which is why the number is derived from a
  // measured write and not from a feeling about margins.
  //
  // `>=` rather than `>` and nothing held it: 889_999 writes and 890_001 does not, so a `>` survives
  // both. This is the reading exactly on GENERATOR_BUDGET_MS, which spends it. NOT because a write
  // starting at the bound has no reserve -- it has exactly all 10s of it -- but because the 10 is a
  // LOWER bound on a write the SDK may retry, so the boundary reading is given away by choice rather
  // than by arithmetic.
  it('spends the budget on a reading exactly at the bound', async () => {
    setup()

    await createModelPuzzles(packDate, clockOf(0, 0, 890_000))

    expect(mockAddModelPuzzles).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('Model budget spent, skipping the remaining types', {
      date: packDate,
      skipped: ['crypticclue'],
    })
  })

  // The budget guard sits AFTER the "nothing missing" skip -- now as a `continue` over the hole that
  // skip leaves in the fetched results, which is the same ordering by another mechanism. Before it, a
  // slow night raised the one ERROR this stack alarms on -- the level="ERROR" subscription filter is
  // the only alarm there is -- naming types that had no work to do, which is a page for a pack that
  // was already full.
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

  // THE WAY LAMBDA ACTUALLY CALLS IT, which is the whole reason the clock is not a parameter of this
  // function. The runtime invokes a handler as `handler(event, context, callback)`, so an injectable
  // second positional parameter is not defaulted in production -- it is BOUND TO THE CONTEXT OBJECT,
  // and the first `now()` throws "is not a function" before a single puzzle is built. That failure is
  // invisible to a suite that only ever calls the handler with one argument or with its own clock,
  // which is exactly how it reached production. The clock lives on createModelPuzzles below; this row
  // is what stops it moving back.
  it('runs when invoked the way Lambda invokes it, with a context as the second argument', async () => {
    setup()

    await createModelPuzzlesHandler({ date: packDate }, { awsRequestId: 'req-1', functionName: 'fn' })

    expect(mockFetchFirst).toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalledWith('Could not add model puzzles', expect.anything())
  })

  // Never rethrown. A Lambda retry re-runs EVERY type including the ones that succeeded; the next
  // GET for this date is the retry, at the right granularity, because it re-reads what is missing.
  it('never throws out of the handler', async () => {
    setup()
    jest.mocked(getRecentPacks).mockRejectedValueOnce(new Error('dynamo on fire'))

    await expect(createModelPuzzlesHandler({ date: packDate })).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('Could not add model puzzles', expect.objectContaining({ date: packDate }))
  })

  /**
   * WHETHER THE FETCHES FIT INSIDE 900 SECONDS AT ALL, which no clock reading in this suite can say.
   *
   * These two numbers -- create-cryptic-clues at 32000 tokens and review-cryptic-clues at 16000 --
   * are the only estimate anybody has of the slowest generator's wall clock: ~410s plus ~204s, off
   * bedrock.ts's measured 204s for 16000. They no longer size GENERATOR_BUDGET_MS, which is now 900
   * minus one write and has nothing to do with a prompt; what they size is the ~614s the CONCURRENT
   * fetch takes before the write loop starts, and the Lambda Timeout is 900. Nothing else in the
   * repo reads either cap, so without these rows moving one of them pushes that estimate towards the
   * ceiling with the whole suite green.
   *
   * THE ROWS FIRED, AND THAT IS THEM WORKING. review-cryptic-clues moved 8000 -> 16000 deliberately,
   * and these numbers were moved WITH it rather than around it, which is the whole contract a
   * tripwire has: it is not an invariant, it is a demand that the estimate above be re-derived out
   * loud. The derivation lives on generators/crypticclue/review.ts, which owns the cap; the headroom
   * it buys is 900 - 614 - ~4s of writes, so ~282s, and a single retried review call (~818s total)
   * still fits while two (~1022s) do not -- a narrowing of the already-unbounded retry risk
   * create-model-puzzles.ts names, not a new one.
   *
   * Asserted on the FILE, not on a fixture, because the file is what scripts/deploy-prompts.ts ships
   * and the model reads. A fixture would pin a copy of the number rather than the number.
   */
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

    // The pair, stated as the sum. Raising either one alone still reddens the row above; this is the
    // row that says what the two of them BUY together.
    //
    // The NAME used to say "the token budget 600s of reserve was sized for", which outlived the thing
    // it named twice over: there is no 600s reserve, the reserve is 10s, and no reserve is sized in
    // tokens at all any more. What these 48,000 tokens bound is the ~614s CONCURRENT fetch phase
    // against a 900-second Lambda -- the docstring above was corrected when the budget moved and the
    // name was not, which is the failure mode a name gets to have exactly once.
    it('keeps the pair inside the 48,000 tokens the fetch phase is estimated from', () => {
      expect(maxTokensOf('create-cryptic-clues.txt') + maxTokensOf('review-cryptic-clues.txt')).toEqual(48_000)
    })
  })
})
