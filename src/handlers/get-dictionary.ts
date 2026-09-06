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

// The second routed endpoint in this API, and the only large unauthenticated payload in the stack.
//
// THIS HANDLER IMPORTS THE MODULE THE LAYER EXISTS TO KEEP OUT OF A REQUEST BUNDLE, and that is
// harmless and deliberate: this is not the pack GET, it is the function the layer is attached FOR.
// It is said out loud because the neighboring invariant is about exactly that hazard, and this
// module is the seam a future mistake would come through.

// Level 9, once per version. `readDictionary` memoizes the bytes and this memoizes the gzip beside
// it, so a warm container answers from memory and a cold one pays the compression on 1.22 MB.
// Committing the PLAIN list rather than the gzip is what makes that trade worth it: the asset stays
// diffable in review and hashable without decompressing it.
//
// THAT COMPRESSION IS NOW ~76 ms, NOT THE SINGLE-DIGIT MILLISECONDS THIS SAID. The list grew from
// ~366 KB to 1.22 MB with the Phrazle floor and the cost grew with it, on the cold-start path of a
// route whose 429 renders Phrazle disabled. Measured on the committed asset: level 9 is 359,553
// bytes at ~76 ms, level 6 is 359,545 bytes at ~49 ms -- 8 bytes dearer for 27 ms cheaper, which is
// a trade worth taking if this ever sits on a latency budget. Left at 9 deliberately, because the
// number to change first is whether the gzip is computed at request time at all.
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
 * `immutable` IS SAFE BECAUSE THE VERSION IS IN THE URL. /dictionary/v2 is a different resource
 * rather than a cache-busting problem, and the client's cleanup rule is "delete anything that is not
 * current".
 *
 * A 429 FROM THIS ROUTE IS A DESIGNED OUTCOME rather than an error, and it is API Gateway's: this
 * route carries its own throttle because its cost is EGRESS rather than a table read, which is a
 * question the stack default was never asked. It never reaches this function and it is not logged
 * at ERROR anywhere, because the subscription filter would then page on a working control.
 */
export const getDictionaryHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // VALIDATED AGAINST A FROZEN ALLOW-LIST BEFORE ANYTHING ELSE HAPPENS, and never interpolated into
  // a path first. A path parameter reaching a file read unvalidated is a traversal -- the same class
  // of finding as get-pack-by-date.ts's date validation, and it gets the same treatment. The 400
  // returns before the filesystem is touched at all, which get-dictionary.test.ts asserts with a
  // readFileSync spy rather than by inspecting the response.
  const version = event.pathParameters?.version
  if (version === undefined || !isDictionaryVersion(version)) {
    log('Invalid dictionary version', { served: DICTIONARY_VERSIONS, version })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ message: 'Invalid dictionary version' }) }
  }

  try {
    // base64 because the body is binary. API Gateway DECODES isBase64Encoded before responding, so
    // the client receives the 359,553 gzipped bytes rather than the 479,404 encoded ones -- which is
    // why the egress table prices the larger figure as an upper bound.
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
    // The only way here is a layer that did not attach or a DICTIONARY_PATH that is unset, and both
    // are deploy faults rather than caller faults -- so this is a 500 and it is logged at ERROR,
    // which is the one alarm channel this stack has. The loader's message names the path.
    logError('Could not serve the dictionary', { error, version })
    return status.INTERNAL_SERVER_ERROR
  }
}
