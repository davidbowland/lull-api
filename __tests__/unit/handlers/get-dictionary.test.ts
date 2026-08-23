import { gunzipSync } from 'node:zlib'

import { resetDictionaryCache } from '@generators/phrazle/dictionary'
import { getDictionaryHandler, resetDictionaryGzipCache } from '@handlers/get-dictionary'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '@types'

jest.mock('@utils/logging')

// require, NEVER `import * as fs`. Babel's _interopRequireWildcard builds a fresh namespace object
// by COPYING a CommonJS module's properties, so a spy taken on that copy is never the function the
// module under test calls -- measured on this checkout: `jest.spyOn(fs, 'readFileSync')` on the
// imported namespace records ZERO calls while the loader really does read the file. Every negative
// assertion below would have been green whatever the handler did. Caught by the liveness control,
// not by reasoning.

const fs = require('node:fs')

const eventFor = (version?: string): APIGatewayProxyEventV2 =>
  ({ pathParameters: version === undefined ? {} : { version } }) as unknown as APIGatewayProxyEventV2

const bodyOf = (result: APIGatewayProxyResultV2<unknown>): string => (result as { body: string }).body
const headersOf = (result: APIGatewayProxyResultV2<unknown>): Record<string, string> =>
  (result as { headers: Record<string, string> }).headers

const setup = (): void => {
  resetDictionaryCache()
  resetDictionaryGzipCache()
}

describe('getDictionaryHandler', () => {
  it('serves the committed list for a known version', async () => {
    setup()

    const result = await getDictionaryHandler(eventFor('v1'))

    expect((result as { statusCode: number }).statusCode).toEqual(200)
    // Round-tripped rather than asserted by length: a body that gunzips to the wrong thing is the
    // failure a byte count cannot see.
    expect(gunzipSync(Buffer.from(bodyOf(result), 'base64')).toString('utf8')).toContain('TOE\n')
  })

  it('declares gzip, plain text and an immutable year', async () => {
    setup()

    expect(headersOf(await getDictionaryHandler(eventFor('v1')))).toStrictEqual({
      // Safe because the VERSION IS IN THE URL: /dictionary/v2 is a different resource rather than a
      // cache-busting problem.
      'cache-control': 'public, max-age=31536000, immutable',
      'content-encoding': 'gzip',
      'content-type': 'text/plain',
    })
  })

  // API Gateway decodes this before responding, so the client receives the gzipped bytes rather than
  // the encoded ones. Without the flag the base64 text itself would be delivered as the body.
  it('flags the body as base64', async () => {
    setup()

    expect((await getDictionaryHandler(eventFor('v1'))) as { isBase64Encoded: boolean }).toEqual(
      expect.objectContaining({ isBase64Encoded: true }),
    )
  })

  // Once per version. The route's own cost is a cold-start gzip of 366KB; a warm container that
  // recompressed on every call would pay it on a route the design models as a handful of fetches a
  // month.
  it('compresses once and serves the memo thereafter', async () => {
    setup()

    const first = bodyOf(await getDictionaryHandler(eventFor('v1')))
    const readFileSync = jest.spyOn(fs, 'readFileSync')
    const second = bodyOf(await getDictionaryHandler(eventFor('v1')))
    readFileSync.mockRestore()

    expect(second).toEqual(first)
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it.each(['v9', 'V1', 'v1.txt', ''])('rejects the unserved version %s', async (version) => {
    setup()

    const result = await getDictionaryHandler(eventFor(version))

    expect((result as { statusCode: number }).statusCode).toEqual(400)
    expect(JSON.parse(bodyOf(result))).toStrictEqual({ message: 'Invalid dictionary version' })
  })

  it('rejects a missing version', async () => {
    setup()

    expect((await getDictionaryHandler(eventFor())) as { statusCode: number }).toEqual(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  // THE TRAVERSAL, AND THE ASSERTION IS THE SPY RATHER THAN THE STATUS CODE. A 400 alone would still
  // be a 400 if the handler interpolated the segment into a path, read the file and then failed to
  // find it -- the finding is that the filesystem is never touched at all. Proved to go red by
  // moving the allow-list check below the read; the break was run, watched, and reverted.
  it.each(['../../etc/passwd', '../v1', 'v1/../../../etc/passwd', '/etc/passwd'])(
    'refuses %s without touching the filesystem',
    async (version) => {
      setup()
      const readFileSync = jest.spyOn(fs, 'readFileSync')

      const result = await getDictionaryHandler(eventFor(version))
      const calls = readFileSync.mock.calls.length
      readFileSync.mockRestore()

      expect((result as { statusCode: number }).statusCode).toEqual(400)
      expect(calls).toBe(0)
    },
  )

  // The liveness control for the spy above: a negative over a spy proves nothing unless something in
  // the same run proves the spy can move, and a served version does read the file.
  it('the filesystem spy is live: a served version does read', async () => {
    setup()
    const readFileSync = jest.spyOn(fs, 'readFileSync')

    await getDictionaryHandler(eventFor('v1'))
    const calls = readFileSync.mock.calls.length
    readFileSync.mockRestore()

    expect(calls).toBeGreaterThan(0)
  })

  // A layer that did not attach, or an unset DICTIONARY_PATH. A deploy fault rather than a caller
  // fault, so it is a 500 and it reaches the ERROR subscription filter.
  it('returns 500 when the list cannot be read', async () => {
    setup()
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })

    const result = await getDictionaryHandler(eventFor('v1'))

    expect((result as { statusCode: number }).statusCode).toEqual(500)
  })
})
