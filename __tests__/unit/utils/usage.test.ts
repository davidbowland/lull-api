import { createUsageTracker, modelCostUsd, recordModelUsage, trackUsage, UsageClock } from '@utils/usage'

describe('usage', () => {
  const opus55 = 'us.anthropic.claude-opus-5-5'

  // Two clock reads: tracker creation, then snapshot 2s later. CPU moves by 50ms user + 10ms system.
  const setup = (): UsageClock => ({
    cpuUsage: jest
      .fn()
      .mockReturnValueOnce({ system: 500, user: 1_000 })
      .mockReturnValueOnce({ system: 10_500, user: 51_000 }),
    maxRssKb: jest.fn().mockReturnValueOnce(262_144),
    now: jest.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(3_000),
  })

  describe('modelCostUsd', () => {
    it('prices every token kind for a known model', () => {
      expect(modelCostUsd(opus55, { input: 1_000, inputCacheWrite: 10, inputCached: 100, output: 2_000 })).toBe(0.04407)
    })

    it('matches a model ID with a Bedrock version suffix', () => {
      expect(
        modelCostUsd('anthropic.claude-opus-5-5:0', { input: 1_000, inputCacheWrite: 0, inputCached: 0, output: 0 }),
      ).toBe(0.004)
    })

    it('returns undefined for a model with no pricing', () => {
      expect(
        modelCostUsd('the-thinking-ai:1.0', { input: 1, inputCacheWrite: 0, inputCached: 0, output: 1 }),
      ).toBeUndefined()
    })
  })

  describe('createUsageTracker', () => {
    it('totals tokens per model and measures the invocation', () => {
      const tracker = createUsageTracker(1536, setup())
      tracker.recordModel(opus55, { cache_read_input_tokens: 100, input_tokens: 600, output_tokens: 1_500 })
      tracker.recordModel(opus55, { cache_creation_input_tokens: 10, input_tokens: 400, output_tokens: 500 })

      expect(tracker.snapshot('model-puzzles')).toEqual({
        builder: 'model-puzzles',
        costUsd: { lambda: 0.00005, models: 0.04407, total: 0.04412 },
        cpuMs: 60,
        gbSeconds: 3,
        maxMemoryMb: 256,
        memoryLimitMb: 1536,
        startedAt: '1970-01-01T00:00:01.000Z',
        tokens: [
          {
            costUsd: 0.04407,
            input: 1_000,
            inputCacheWrite: 10,
            inputCached: 100,
            invocations: 2,
            model: opus55,
            output: 2_000,
          },
        ],
        wallClockMs: 2_000,
      })
    })

    it('keeps each model separate', () => {
      const tracker = createUsageTracker(1536, setup())
      tracker.recordModel(opus55, { input_tokens: 1_000 })
      tracker.recordModel('the-thinking-ai:1.0', { input_tokens: 1 })

      expect(tracker.snapshot('model-puzzles').tokens.map((entry) => entry.model)).toEqual([
        opus55,
        'the-thinking-ai:1.0',
      ])
    })

    it('counts an invocation with no usage and leaves an unpriced model without a cost', () => {
      const tracker = createUsageTracker(1536, setup())
      tracker.recordModel('the-thinking-ai:1.0', undefined)

      const snapshot = tracker.snapshot('phrase-puzzles')

      expect(snapshot.tokens).toEqual([
        { input: 0, inputCacheWrite: 0, inputCached: 0, invocations: 1, model: 'the-thinking-ai:1.0', output: 0 },
      ])
      expect(snapshot.costUsd.models).toBe(0)
    })
  })

  describe('trackUsage', () => {
    it('routes recordModelUsage to the tracker the work runs under, across awaits', async () => {
      const tracker = createUsageTracker(1536, setup())

      await trackUsage(tracker, async () => {
        await Promise.all([
          Promise.resolve().then(() => recordModelUsage(opus55, { input_tokens: 1 })),
          Promise.resolve().then(() => recordModelUsage(opus55, { input_tokens: 2 })),
        ])
      })

      expect(tracker.snapshot('model-puzzles').tokens).toEqual([expect.objectContaining({ input: 3, invocations: 2 })])
    })

    // scripts/ call invokeModel with no tracker in scope.
    it('makes recordModelUsage a no-op outside any tracker', () => {
      expect(() => recordModelUsage(opus55, { input_tokens: 1 })).not.toThrow()
    })
  })
})
