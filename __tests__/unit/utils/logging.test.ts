import { log, logError } from '@utils/logging'

describe('logging', () => {
  beforeAll(() => {
    console.error = jest.fn()
    console.log = jest.fn()
  })

  describe('log', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke console.log with message', (value) => {
      const message = `Log message for value ${JSON.stringify(value)}`
      log(message)

      expect(console.log).toHaveBeenCalledWith(message)
    })

    // Every real call site passes a context object as a second argument. Without this, a
    // single-parameter implementation passes the whole suite while silently dropping the entire
    // diagnostic payload from every log line in the service.
    it('forwards the context object alongside the message', () => {
      log('Writing pack', { complete: true, date: '2026-06-15' })

      expect(console.log).toHaveBeenCalledWith('Writing pack', { complete: true, date: '2026-06-15' })
    })
  })

  // Both branches, because the whole value of logDebug is that it stays QUIET by default.
  // bedrock.ts sends the full prompt, the full model context, and the untruncated payload of a
  // schema-validation failure through it -- tens of kilobytes an invocation. A test that only
  // covered the enabled path would pass just as happily against an implementation that always
  // logged, which is the failure that actually costs money.
  //
  // config.ts reads the environment once at module load, so the module graph has to be rebuilt
  // per branch rather than the flag being flipped at call time.
  describe('logDebug', () => {
    const loadLogging = async (debugLogging: string): Promise<typeof import('@utils/logging')> => {
      const original = process.env.DEBUG_LOGGING
      process.env.DEBUG_LOGGING = debugLogging
      jest.resetModules()
      const loaded = await import('@utils/logging')
      process.env.DEBUG_LOGGING = original
      return loaded
    }

    afterAll(() => {
      jest.resetModules()
    })

    it('logs when debug logging is enabled', async () => {
      const { logDebug } = await loadLogging('true')

      logDebug('Invoking model', { toolName: 'submit_phrase_corpus' })

      expect(console.log).toHaveBeenCalledWith('Invoking model', { toolName: 'submit_phrase_corpus' })
    })

    it('stays silent when debug logging is disabled', async () => {
      const { logDebug } = await loadLogging('false')

      logDebug('Invoking model', { toolName: 'submit_phrase_corpus' })

      expect(console.log).not.toHaveBeenCalled()
    })
  })

  describe('logError', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke console.error with message', (value) => {
      const message = `Error message for value ${JSON.stringify(value)}`
      const error = new Error(message)
      logError(error)

      expect(console.error).toHaveBeenCalledWith(error)
    })

    it('forwards the context object alongside the error', () => {
      logError('Puzzle generation failed', { difficulty: 3, type: 'gofigure' })

      expect(console.error).toHaveBeenCalledWith('Puzzle generation failed', { difficulty: 3, type: 'gofigure' })
    })
  })
})
