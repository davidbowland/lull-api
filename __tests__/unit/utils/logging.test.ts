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
