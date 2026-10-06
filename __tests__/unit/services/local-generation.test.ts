import { compactPhrase, cryptogramPuzzle, packDate, phrase, prompt, toolSchema } from '../__mocks__'
import { appendPackUsage, getPackByDate, getRecentPacks } from '@services/dynamodb'
import {
  exitCodeFor,
  expandPackDates,
  generatePacks,
  isCredentialFailure,
  MAX_CHAIN_ATTEMPTS,
  RunSummary,
} from '@services/local-generation'
import { activeModelBackend, LocalModelBackend } from '@services/model-backend'
import { addModelPuzzles, addPhrasePuzzles, createPack, missingDifficulties, phrasesMissing } from '@services/packs'
import { generatePhrases, phraseRequestCount } from '@services/phrases'
import { reviewPhrases } from '@services/review'
import { Pack, PackContribution, PackDate, Puzzle } from '@types'
import { logError, logWarning } from '@utils/logging'

const mockFetchCandidates = jest.fn()

// Built inside the factory, because babel-plugin-jest-hoist admits an out-of-scope reference only
// for a `mock`-prefixed name.
jest.mock('@generators/model', () => ({
  modelGenerators: ['themedanagrams', 'cryptogram', 'crypticclue'].map((type) => ({
    availableFrom: '2026-01-01',
    baseSeconds: 60,
    bestEffort: type === 'crypticclue',
    countPerDay: 2,
    difficulties: [2, 3],
    fetchCandidates: (...args: unknown[]) => mockFetchCandidates(type, ...args),
    secondsPerDifficulty: 15,
    type,
  })),
}))
jest.mock('@generators/index', () => ({
  selfContainedGenerators: [
    {
      availableFrom: '2026-01-01',
      baseSeconds: 60,
      countPerDay: 3,
      difficulties: [1, 3, 5],
      secondsPerDifficulty: 15,
      type: 'gofigure',
    },
  ],
}))
jest.mock('@services/dynamodb', () => ({
  appendPackUsage: jest.fn(),
  getPackByDate: jest.fn(),
  getRecentPacks: jest.fn(),
}))
jest.mock('@services/packs', () => ({
  addModelPuzzles: jest.fn(),
  addPhrasePuzzles: jest.fn(),
  createPack: jest.fn(),
  missingDifficulties: jest.fn(),
  phrasesMissing: jest.fn(),
}))
jest.mock('@services/phrases', () => ({ generatePhrases: jest.fn(), phraseRequestCount: jest.fn() }))
jest.mock('@services/review', () => ({ reviewPhrases: jest.fn() }))
jest.mock('@utils/logging')

const ALL_TYPES = ['gofigure', 'phrazle', 'themedanagrams', 'cryptogram', 'crypticclue']
const nextDate: PackDate = '2026-06-16'
const startedAt = Date.UTC(2026, 9, 6)
const recent: Pack[] = [{ complete: true, date: '2026-06-14', puzzles: [cryptogramPuzzle] }]
const expired = Object.assign(new Error('expired'), { name: 'ExpiredTokenException' })

// The pack table, and the order in which pack-row writes and model steps start and end.
const store = new Map<PackDate, Puzzle[]>()
const events: string[] = []

const fill = (date: PackDate, types: string[]): void => {
  store.set(date, [...(store.get(date) ?? []), ...types.map((type) => ({ type }) as Puzzle)])
}

const missingExcept = (...types: string[]): string[] => ALL_TYPES.filter((type) => !types.includes(type))

const setup = (seed: Record<PackDate, string[]> = {}): void => {
  store.clear()
  events.length = 0
  Object.entries(seed).forEach(([date, types]) => fill(date, types))
}

const readStore = async (date: PackDate): Promise<Pack> => ({
  complete: false,
  date,
  puzzles: [...(store.get(date) ?? [])],
})

// A macrotask inside every write, so an unlocked second write would start before the first ends.
const tracked =
  (name: string, effect: (...args: any[]) => void) =>
  async (date: PackDate, ...rest: any[]): Promise<any> => {
    events.push(`start ${name} ${date}`)
    await new Promise((resolve) => setImmediate(resolve))
    effect(date, ...rest)
    events.push(`end ${name} ${date}`)
    return true
  }

// Calls through whatever backend is active, so a step run outside withModelBackend calls nothing.
const modelStep =
  <T>(name: string, result: T) =>
  async (): Promise<T> => {
    events.push(`model ${name}`)
    await activeModelBackend()?.invoke(prompt, toolSchema, name)
    return result
  }

const fakeBackend = (failures: string[] = []): LocalModelBackend => {
  const invoke = jest.fn().mockResolvedValue({})
  return { calls: () => invoke.mock.calls.length, failures: () => failures, invoke, loadPrompt: jest.fn() }
}

const defaultPhrasesMissing = (_date: PackDate, puzzles: Puzzle[]): number =>
  puzzles.some((puzzle) => puzzle.type === 'phrazle') ? 0 : 6

const createBackend = jest.fn()
const now = jest.fn()
const onProgress = jest.fn()
const deps = { createBackend, now, onProgress, workRoot: '/work' }

const candidateFor = (type: string) => ({ type, usableAt: [2, 3] })

describe('local-generation', () => {
  beforeAll(() => {
    jest.mocked(getPackByDate).mockImplementation(readStore)
    jest.mocked(getRecentPacks).mockResolvedValue(recent)
    jest.mocked(createPack).mockImplementation(tracked('createPack', (date) => fill(date, ['gofigure'])))
    jest.mocked(addPhrasePuzzles).mockImplementation(tracked('addPhrasePuzzles', (date) => fill(date, ['phrazle'])))
    jest
      .mocked(addModelPuzzles)
      .mockImplementation(tracked('addModelPuzzles', (date, generator) => fill(date, [generator.type])))
    jest.mocked(appendPackUsage).mockImplementation(tracked('appendPackUsage', () => undefined))
    jest
      .mocked(missingDifficulties)
      .mockImplementation((contribution: PackContribution, puzzles: Puzzle[]) =>
        puzzles.some((puzzle) => puzzle.type === contribution.type) ? [] : contribution.difficulties,
      )
    jest.mocked(phrasesMissing).mockImplementation(defaultPhrasesMissing)
    jest.mocked(phraseRequestCount).mockReturnValue(12)
    jest
      .mocked(generatePhrases)
      .mockImplementation(modelStep('phrases', { phrases: [phrase], upstreamUnavailable: false }))
    jest.mocked(reviewPhrases).mockResolvedValue([compactPhrase])
    mockFetchCandidates.mockImplementation((type: string) => modelStep(type, [candidateFor(type)])())
    createBackend.mockImplementation(() => fakeBackend())
    now.mockReturnValue(startedAt)
  })

  describe('expandPackDates', () => {
    it('expands a single date', () => {
      expect(expandPackDates(['2026-01-01'])).toEqual(['2026-01-01'])
    })

    it('expands an inclusive range across a month boundary', () => {
      expect(expandPackDates(['2026-01-30..2026-02-02'])).toEqual([
        '2026-01-30',
        '2026-01-31',
        '2026-02-01',
        '2026-02-02',
      ])
    })

    it('deduplicates and sorts', () => {
      expect(expandPackDates(['2026-01-03', '2026-01-01..2026-01-03'])).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
      ])
    })

    it.each([
      '2026-02-30',
      '2026-1-01',
      '2026-01-05..2026-01-01',
      '2026-01-01..',
      '2026-01-01..2026-01-02..2026-01-03',
    ])('rejects %s', (arg) => {
      expect(() => expandPackDates([arg])).toThrow(`Invalid date or range: ${arg}`)
    })

    it('rejects a range longer than MAX_RANGE_DAYS', () => {
      expect(expandPackDates(['2026-01-01..2026-12-31'])).toHaveLength(365)
      expect(() => expandPackDates(['2026-01-01..2027-01-02'])).toThrow('Range longer than 366 days')
    })

    it('rejects an empty list', () => {
      expect(() => expandPackDates([])).toThrow('No dates given')
    })
  })

  describe('isCredentialFailure', () => {
    it.each([
      'ExpiredTokenException',
      'ExpiredToken',
      'UnrecognizedClientException',
      'InvalidSignatureException',
      'CredentialsProviderError',
    ])('is true for %s', (name) => {
      expect(isCredentialFailure(Object.assign(new Error('x'), { name }))).toBe(true)
    })

    it.each([new Error('x'), undefined, { name: 'ConditionalCheckFailedException' }])('is false for %p', (error) => {
      expect(isCredentialFailure(error)).toBe(false)
    })
  })

  describe('generatePacks', () => {
    it('skips every chain and makes no model call when nothing is missing', async () => {
      setup({ [packDate]: ALL_TYPES })
      const summary = await generatePacks([packDate], deps)

      expect(summary).toEqual({
        aborted: false,
        dates: [
          {
            chains: {
              crypticclue: { status: 'skipped' },
              cryptogram: { status: 'skipped' },
              phrases: { status: 'skipped' },
              themedanagrams: { status: 'skipped' },
            },
            date: packDate,
            selfContained: { status: 'skipped' },
          },
        ],
      })
      expect(createPack).toHaveBeenCalledTimes(1)
      expect(createBackend).not.toHaveBeenCalled()
      expect(generatePhrases).not.toHaveBeenCalled()
      expect(mockFetchCandidates).not.toHaveBeenCalled()
      expect(appendPackUsage).not.toHaveBeenCalled()
    })

    it('runs the phrase chain through the backend, writes the reviewed phrases and records usage', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      now.mockReturnValueOnce(startedAt).mockReturnValueOnce(startedAt + 250)
      const summary = await generatePacks([packDate], deps)

      expect(phraseRequestCount).toHaveBeenCalledWith(6)
      expect(generatePhrases).toHaveBeenCalledWith(12, [cryptogramPuzzle.data.answer])
      expect(reviewPhrases).toHaveBeenCalledWith([phrase])
      expect(addPhrasePuzzles).toHaveBeenCalledWith(packDate, [compactPhrase])
      expect(createBackend).toHaveBeenCalledTimes(1)
      expect(createBackend).toHaveBeenCalledWith('/work/2026-06-15/phrases/attempt-1', expect.any(Function))
      expect(createBackend.mock.results[0].value.invoke).toHaveBeenCalledWith(prompt, toolSchema, 'phrases')
      expect(appendPackUsage).toHaveBeenCalledTimes(1)
      expect(appendPackUsage).toHaveBeenCalledWith(packDate, {
        attempt: 1,
        builder: 'phrase-puzzles',
        chain: 'phrases',
        source: 'local',
        startedAt: '2026-10-06T00:00:00.000Z',
        wallClockMs: 250,
      })
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
      expect(onProgress).toHaveBeenCalledWith('[2026-06-15 phrases] attempt 1/3')
      expect(onProgress).toHaveBeenCalledWith('[2026-06-15 phrases] complete')
    })

    it('runs a model chain and writes its candidates against the missing bands', async () => {
      setup({ [packDate]: missingExcept('themedanagrams') })
      const summary = await generatePacks([packDate], deps)

      expect(mockFetchCandidates).toHaveBeenCalledWith('themedanagrams', 2, recent, packDate)
      expect(addModelPuzzles).toHaveBeenCalledWith(
        packDate,
        expect.objectContaining({ type: 'themedanagrams' }),
        [2, 3],
        [candidateFor('themedanagrams')],
      )
      expect(appendPackUsage).toHaveBeenCalledWith(
        packDate,
        expect.objectContaining({ builder: 'model-puzzles', chain: 'themedanagrams' }),
      )
      expect(summary.dates[0].chains.themedanagrams).toEqual({ status: 'complete' })
    })

    it('never writes when the backend recorded a failure', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      createBackend.mockImplementationOnce(() => fakeBackend(['review_phrases']))
      const summary = await generatePacks([packDate], deps)

      expect(createBackend).toHaveBeenCalledTimes(2)
      expect(addPhrasePuzzles).toHaveBeenCalledTimes(1)
      expect(appendPackUsage).toHaveBeenCalledTimes(2)
      expect(appendPackUsage).toHaveBeenNthCalledWith(1, packDate, expect.objectContaining({ attempt: 1 }))
      expect(appendPackUsage).toHaveBeenNthCalledWith(2, packDate, expect.objectContaining({ attempt: 2 }))
      expect(onProgress).toHaveBeenCalledWith(
        '[2026-06-15 phrases] attempt 1 failed: Model calls failed: review_phrases',
      )
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
    })

    it('stops after MAX_CHAIN_ATTEMPTS and reports the chain short', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      jest.mocked(addPhrasePuzzles).mockResolvedValueOnce(true as any)
      jest.mocked(addPhrasePuzzles).mockResolvedValueOnce(true as any)
      jest.mocked(addPhrasePuzzles).mockResolvedValueOnce(true as any)
      const summary = await generatePacks([packDate], deps)

      expect(createBackend).toHaveBeenCalledTimes(MAX_CHAIN_ATTEMPTS)
      expect(appendPackUsage).toHaveBeenCalledTimes(MAX_CHAIN_ATTEMPTS)
      expect(summary.dates[0].chains.phrases).toEqual({ have: 0, status: 'short', want: 6 })
      expect(exitCodeFor(summary)).toBe(1)
    })

    it('fails only the attempt whose model step throws', async () => {
      setup({ [packDate]: missingExcept('cryptogram') })
      mockFetchCandidates.mockRejectedValueOnce('boom')
      const summary = await generatePacks([packDate], deps)

      expect(addModelPuzzles).toHaveBeenCalledTimes(1)
      expect(appendPackUsage).toHaveBeenCalledTimes(1)
      expect(appendPackUsage).toHaveBeenCalledWith(packDate, expect.objectContaining({ attempt: 2 }))
      expect(onProgress).toHaveBeenCalledWith('[2026-06-15 cryptogram] attempt 1 failed: boom')
      expect(summary.dates[0].chains.cryptogram).toEqual({ status: 'complete' })
    })

    it('aborts on a credential failure from a chain read, writing nothing and starting no further date', async () => {
      setup()
      jest.mocked(getPackByDate).mockImplementationOnce(readStore).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate, nextDate], deps)

      expect(summary.aborted).toBe(true)
      expect(summary.dates).toHaveLength(1)
      expect(summary.dates[0].chains).toEqual({
        crypticclue: { status: 'aborted' },
        cryptogram: { status: 'aborted' },
        phrases: { status: 'aborted' },
        themedanagrams: { status: 'aborted' },
      })
      expect(createPack).toHaveBeenCalledTimes(1)
      expect(createBackend).not.toHaveBeenCalled()
      expect(addPhrasePuzzles).not.toHaveBeenCalled()
      expect(addModelPuzzles).not.toHaveBeenCalled()
      expect(appendPackUsage).not.toHaveBeenCalled()
      expect(exitCodeFor(summary)).toBe(1)
    })

    it('skips the write and the usage of chains whose model steps finish after an abort', async () => {
      setup()
      jest.mocked(getRecentPacks).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate], deps)

      expect(createBackend).toHaveBeenCalledTimes(4)
      expect(mockFetchCandidates).toHaveBeenCalledTimes(3)
      expect(addModelPuzzles).not.toHaveBeenCalled()
      expect(appendPackUsage).not.toHaveBeenCalled()
      expect(summary.dates[0].chains.cryptogram).toEqual({ status: 'aborted' })
    })

    it('hands each backend an isAborted that reads the run', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      const seen: (() => boolean)[] = []
      createBackend.mockImplementationOnce((_workDir: string, isAborted: () => boolean) => {
        seen.push(isAborted)
        events.push(`aborted ${isAborted()}`)
        return fakeBackend()
      })
      jest.mocked(appendPackUsage).mockRejectedValueOnce(expired)
      await generatePacks([packDate], deps)

      expect(events).toContain('aborted false')
      expect(seen[0]()).toBe(true)
    })

    it('aborts on a credential failure from a write, appending no usage and starting no further date', async () => {
      setup({ [packDate]: missingExcept('phrazle'), [nextDate]: missingExcept('phrazle') })
      jest.mocked(addPhrasePuzzles).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate, nextDate], deps)

      expect(summary.aborted).toBe(true)
      expect(summary.dates).toHaveLength(1)
      expect(addPhrasePuzzles).toHaveBeenCalledTimes(1)
      expect(appendPackUsage).not.toHaveBeenCalled()
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'aborted' })
    })

    it('runs the write inside the model backend', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      const inside: boolean[] = []
      jest.mocked(addPhrasePuzzles).mockImplementationOnce(async () => {
        inside.push(activeModelBackend() !== undefined)
        fill(packDate, ['phrazle'])
        return { complete: false, date: packDate, puzzles: [] }
      })
      await generatePacks([packDate], deps)

      expect(inside).toEqual([true])
    })

    it('reports a chain that used every attempt from the final read even when the run aborts later', async () => {
      setup({ [packDate]: missingExcept('phrazle', 'cryptogram') })
      jest.mocked(addPhrasePuzzles).mockResolvedValueOnce(true as any)
      jest.mocked(addPhrasePuzzles).mockResolvedValueOnce(true as any)
      jest.mocked(addPhrasePuzzles).mockImplementationOnce(async () => {
        fill(packDate, ['phrazle'])
        return { complete: false, date: packDate, puzzles: [] }
      })
      // The fourth usage append aborts the run, after the phrase chain's last write.
      jest
        .mocked(appendPackUsage)
        .mockImplementationOnce(tracked('appendPackUsage', () => undefined))
        .mockImplementationOnce(tracked('appendPackUsage', () => undefined))
        .mockImplementationOnce(tracked('appendPackUsage', () => undefined))
        .mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate], deps)

      expect(summary.aborted).toBe(true)
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
    })

    it('aborts on a credential failure from appending usage', async () => {
      setup({ [packDate]: missingExcept('phrazle'), [nextDate]: missingExcept('phrazle') })
      jest.mocked(appendPackUsage).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate, nextDate], deps)

      expect(summary.aborted).toBe(true)
      expect(summary.dates).toHaveLength(1)
      expect(createPack).toHaveBeenCalledTimes(1)
      // Its write landed before the append failed, so the chain's types are present.
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
    })

    it('warns and carries on when appending usage fails for another reason', async () => {
      setup({ [packDate]: missingExcept('phrazle') })
      jest.mocked(appendPackUsage).mockRejectedValueOnce(new Error('throttled'))
      const summary = await generatePacks([packDate], deps)

      expect(summary.aborted).toBe(false)
      expect(logWarning).toHaveBeenCalledWith('Could not append local usage', expect.anything())
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
    })

    it('never overlaps pack-row writes, while the four chains run concurrently', async () => {
      setup()
      await generatePacks([packDate], deps)

      const depths = events
        .filter((event) => /^(start|end) /.test(event))
        .reduce(
          (running: number[], event) => [
            ...running,
            running[running.length - 1] + (event.startsWith('start') ? 1 : -1),
          ],
          [0],
        )
      const firstChainWrite = events.findIndex((event) => /^end add/.test(event))

      expect(Math.max(...depths)).toBe(1)
      expect(events.slice(0, firstChainWrite).filter((event) => event.startsWith('model'))).toEqual([
        'model phrases',
        'model themedanagrams',
        'model cryptogram',
        'model crypticclue',
      ])
    })

    it('settles each date before the next date starts', async () => {
      setup()
      await generatePacks([packDate, nextDate], deps)

      const nextCreate = events.indexOf(`start createPack ${nextDate}`)
      const lastOfFirst = events.map((event) => event.endsWith(packDate)).lastIndexOf(true)

      expect(jest.mocked(createPack).mock.calls).toEqual([[packDate], [nextDate]])
      expect(nextCreate).toBeGreaterThan(lastOfFirst)
    })

    it('still runs the chains when createPack throws for another reason', async () => {
      setup()
      jest.mocked(createPack).mockRejectedValueOnce(new Error('boom'))
      const summary = await generatePacks([packDate], deps)

      expect(addPhrasePuzzles).toHaveBeenCalledTimes(1)
      expect(summary.dates[0].selfContained).toEqual({ have: 0, status: 'short', want: 3 })
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'complete' })
    })

    it('aborts the chains when createPack hits a credential failure', async () => {
      setup()
      jest.mocked(createPack).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate], deps)

      expect(summary.aborted).toBe(true)
      expect(createBackend).not.toHaveBeenCalled()
      expect(summary.dates[0].chains.phrases).toEqual({ status: 'aborted' })
      expect(summary.dates[0].selfContained).toEqual({ status: 'aborted' })
    })

    it('skips createPack when the first read hits a credential failure', async () => {
      setup()
      jest.mocked(getPackByDate).mockRejectedValueOnce(expired)
      const summary = await generatePacks([packDate], deps)

      expect(createPack).not.toHaveBeenCalled()
      expect(createBackend).not.toHaveBeenCalled()
      expect(summary.dates[0].selfContained).toEqual({ status: 'aborted' })
    })

    it('reports the self-contained lane from the final read when the first read fails for another reason', async () => {
      setup({ [packDate]: missingExcept('gofigure') })
      jest.mocked(getPackByDate).mockRejectedValueOnce(new Error('throttled'))
      const summary = await generatePacks([packDate], deps)

      expect(createPack).toHaveBeenCalledTimes(1)
      expect(summary.dates[0].selfContained).toEqual({ status: 'complete' })
    })

    it.each([
      [expired, 'aborted'],
      [new Error('throttled'), 'failed'],
    ])('reports the self-contained lane from a final read throwing %p as %s', async (error, status) => {
      setup({ [packDate]: missingExcept('gofigure') })
      jest
        .mocked(getPackByDate)
        .mockImplementationOnce(readStore)
        .mockImplementationOnce(readStore)
        .mockImplementationOnce(readStore)
        .mockImplementationOnce(readStore)
        .mockImplementationOnce(readStore)
        .mockRejectedValueOnce(error)
      const summary = await generatePacks([packDate], deps)

      expect(summary.dates[0].selfContained).toEqual({ status })
    })

    it.each([
      [expired, 'aborted'],
      [new Error('throttled'), 'failed'],
    ])('reports a chain whose final read throws %p as %s', async (error, status) => {
      setup({ [packDate]: missingExcept('phrazle') })
      jest
        .mocked(phrasesMissing)
        .mockImplementationOnce(defaultPhrasesMissing)
        .mockImplementationOnce(defaultPhrasesMissing)
        .mockImplementationOnce(() => {
          throw error
        })
      const summary = await generatePacks([packDate], deps)

      expect(summary.dates[0].chains.phrases).toEqual({ status })
    })

    it('fails a chain that rejects outside its own catch', async () => {
      setup({ [packDate]: ALL_TYPES })
      onProgress.mockReturnValueOnce(undefined).mockImplementationOnce(() => {
        throw new Error('closed')
      })
      const summary = await generatePacks([packDate], deps)

      expect(summary.dates[0].chains.phrases).toEqual({ status: 'failed' })
      expect(logError).toHaveBeenCalledWith('A local chain failed outside its own catch', expect.anything())
    })

    it('runs without a clock or a progress callback', async () => {
      setup({ [packDate]: ALL_TYPES })
      const summary = await generatePacks([packDate], { createBackend, workRoot: '/work' })

      expect(summary.aborted).toBe(false)
    })
  })

  describe('exitCodeFor', () => {
    const complete = { status: 'complete' } as const
    const short = { have: 1, status: 'short', want: 2 } as const
    const summaryWith = (overrides: Record<string, unknown>, aborted = false): RunSummary =>
      ({
        aborted,
        dates: [
          {
            chains: {
              crypticclue: complete,
              cryptogram: complete,
              phrases: complete,
              themedanagrams: { status: 'skipped' },
            },
            date: packDate,
            selfContained: complete,
            ...overrides,
          },
        ],
      }) as RunSummary

    it.each([
      ['every result complete or skipped', summaryWith({}), 0],
      [
        'only the best-effort chain short',
        summaryWith({
          chains: { crypticclue: short, cryptogram: complete, phrases: complete, themedanagrams: complete },
        }),
        0,
      ],
      [
        'a required chain short',
        summaryWith({
          chains: { crypticclue: complete, cryptogram: complete, phrases: short, themedanagrams: complete },
        }),
        1,
      ],
      ['the self-contained lane short', summaryWith({ selfContained: short }), 1],
      ['the run aborted', summaryWith({}, true), 1],
      [
        'a chain failed',
        summaryWith({
          chains: {
            crypticclue: { status: 'failed' },
            cryptogram: complete,
            phrases: complete,
            themedanagrams: complete,
          },
        }),
        1,
      ],
    ])('exits with %s', (_label, summary, code) => {
      expect(exitCodeFor(summary)).toBe(code)
    })
  })
})
