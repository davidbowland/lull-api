import { gzipSync } from 'node:zlib'

import {
  DICTIONARY_VERSIONS,
  DictionaryVersion,
  isDictionaryVersion,
  readDictionary,
} from '../generators/phrazle/dictionary'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

// This handler imports the word-list module the Lambda layer exists to keep OUT of a request
// bundle. Deliberate here -- this is the function the layer is attached for, not the pack GET.

// Level 9, once per version. `readDictionary` memoizes the bytes and this memoizes the gzip, so a
// warm container answers from memory and a cold one pays the compression on 1.22 MB. Measured on
// the committed asset: level 9 is 359,553 bytes at ~76 ms, level 6 is 359,545 bytes at ~49 ms.
// Left at 9, because the number to change first is whether the gzip is computed per request.
const compressed = new Map<DictionaryVersion, Buffer>()

const gzipFor = (version: DictionaryVersion): Buffer => {
  const cached = compressed.get(version)
  if (cached !== undefined) {
    return cached
  }
  const built = gzipSync(Buffer.from(readDictionary(version), 'utf8'), { level: 9 })
  compressed.set(version, built)
  return built
}

/** Drops the gzip memo. For tests; nothing in src/ calls it. */
export const resetDictionaryGzipCache = (): void => {
  compressed.clear()
}

/**
 * The guess dictionary for one version, gzipped.
 *
 * `immutable` is safe because the version is in the URL: /dictionary/v2 is a different resource
 * rather than a cache-busting problem.
 *
 * A 429 from this route is a designed outcome and API Gateway's -- the route carries its own
 * throttle because its cost is egress rather than a table read. It never reaches this function and
 * is never logged at ERROR, or the subscription filter would page on a working control.
 */
export const getDictionaryHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // Validated against a frozen allow-list before anything else, and never interpolated into a path
  // first: a path parameter reaching a file read unvalidated is a traversal. The 400 returns before
  // the filesystem is touched at all, which get-dictionary.test.ts asserts with a readFileSync spy.
  const version = event.pathParameters?.version
  if (version === undefined || !isDictionaryVersion(version)) {
    log('Invalid dictionary version', { served: DICTIONARY_VERSIONS, version })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ message: 'Invalid dictionary version' }) }
  }

  try {
    // base64 because the body is binary. API Gateway decodes isBase64Encoded before responding, so
    // the client receives the 359,553 gzipped bytes rather than the 479,404 encoded ones.
    return {
      ...status.OK,
      body: gzipFor(version).toString('base64'),
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-encoding': 'gzip',
        'content-type': 'text/plain',
      },
      isBase64Encoded: true,
    }
  } catch (error: unknown) {
    // The only way here is a layer that did not attach or an unset DICTIONARY_PATH, both deploy
    // faults rather than caller faults -- so a 500 at ERROR, the one alarm channel this stack has.
    logError('Could not serve the dictionary', { error, version })
    return status.INTERNAL_SERVER_ERROR
  }
}
