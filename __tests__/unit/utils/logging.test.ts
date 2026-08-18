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
  })

  describe('logError', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])('should invoke console.error with message', (value) => {
      const message = `Error message for value ${JSON.stringify(value)}`
      const error = new Error(message)
      logError(error)

      expect(console.error).toHaveBeenCalledWith(error)
    })
  })
})
