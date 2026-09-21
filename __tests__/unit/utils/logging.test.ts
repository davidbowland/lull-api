import { log, logError, logWarning } from '@utils/logging'

describe('logging', () => {
  beforeAll(() => {
    console.error = jest.fn()
    console.log = jest.fn()
    console.warn = jest.fn()
  })

  // console.warn, and not console.error or console.log, because the level is the whole feature.
  // The stack's one alarm is a CloudWatch subscription on `[timestamp, uuid, level="ERROR",
  // message]`, and the Node runtime writes that third field from the console method. console.log
  // would satisfy a naive "it does not alarm" assertion while dropping the level out of the line.
  describe('logWarning', () => {
    it('writes through console.warn so the ERROR subscription does not match', () => {
      logWarning('Could not generate a phrase batch; keeping the other calls', { asked: 6 })

      expect(console.warn).toHaveBeenCalledWith('Could not generate a phrase batch; keeping the other calls', {
        asked: 6,
      })
      expect(console.error).not.toHaveBeenCalled()
      expect(console.log).not.toHaveBeenCalled()
    })
  })

  describe('log', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke console.log with message', (value) => {
      const message = `Log message for value ${JSON.stringify(value)}`
      log(message)

      expect(console.log).toHaveBeenCalledWith(message)
    })

    // Every real call site passes a context object. Without this row, a single-parameter
    // implementation passes the suite while dropping the diagnostic payload from every log line.
    it('forwards the context object alongside the message', () => {
      log('Writing pack', { complete: true, date: '2026-06-15' })

      expect(console.log).toHaveBeenCalledWith('Writing pack', { complete: true, date: '2026-06-15' })
    })
  })

  // Both branches, because the value of logDebug is that it stays QUIET by default: bedrock.ts
  // sends tens of kilobytes an invocation through it, and a test covering only the enabled path
  // passes just as happily against an implementation that always logs.
  //
  // config.ts reads the environment once at module load, so the module graph is rebuilt per branch
  // rather than the flag flipped at call time.
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

      logDebug('Invoking model', { toolName: 'submit_phrases' })

      expect(console.log).toHaveBeenCalledWith('Invoking model', { toolName: 'submit_phrases' })
    })

    it('stays silent when debug logging is disabled', async () => {
      const { logDebug } = await loadLogging('false')

      logDebug('Invoking model', { toolName: 'submit_phrases' })

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
