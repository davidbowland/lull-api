import { packGenerationTimeoutMs } from '../config'
import { claimPackGeneration } from '../services/dynamodb'
import { invokeCreatePack } from '../services/lambda'
import { fillPack } from '../services/packs'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PackDate } from '../types'
import { log, logError } from '../utils/logging'
import { isValidPackDate } from '../utils/pack-date'
import status from '../utils/status'

export const getPackByDateHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // Validated BEFORE the table is touched: a path parameter reaching a DynamoDB key unvalidated is
  // an unbounded key. It now also gates a WRITE, so this check is the only thing bounding which
  // dates a caller can cause to be generated.
  const date: PackDate | undefined = event.pathParameters?.date
  if (!date || !isValidPackDate(date)) {
    log('Invalid pack date', { date })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ message: 'Invalid pack date' }) }
  }

  try {
    // Repair, not delivery. A request is proof the client is online, so a missing or partial pack
    // is topped up from the fast generators while the request is open. A pack that needs nothing
    // costs one read and no write.
    const pack = await fillPack(date)

    // 404 if and only if the pack ends up empty. An incomplete pack that still holds puzzles is
    // served with complete: false, which is the signal the client already refetches on.
    //
    // Load-bearing, not defensive. This check is the ONLY thing stopping an empty pack reaching the
    // client: lull-ui's isValidPack accepts `puzzles: []` because `.every` over an empty array is
    // true, so a 200 with no puzzles is stored as a sound pack under today's date. It does keep
    // getting refetched -- it carries complete: false, and fetchPack short-circuits only on a
    // complete pack -- but the shelf reads the cache, not the network, and it picks the newest
    // cached date at or before the device's local date. Today's empty pack therefore SHADOWS
    // yesterday's good one, and the shelf renders today's heading over an empty list until some
    // later fetch happens to fill it. A 404 caches nothing, so yesterday's pack keeps showing.
    if (pack.puzzles.length === 0) {
      log('No pack for date and nothing could be generated', { date })
      return { ...status.NOT_FOUND, body: JSON.stringify({ message: 'No pack for date' }) }
    }

    // The slow half of the repair path. fillPack ran only the generators graded fast enough for a
    // request, so anything they could not supply -- today, a corpus that does not exist yet, and
    // later any inRequest: false type -- is finished out of band rather than waiting for 03:33.
    //
    // AFTER the pack is built and written, and awaited only to the point of queueing. The response
    // carries whatever is playable now; completing it is an improvement, not a precondition.
    if (!pack.complete) {
      // Its own try/catch, and this is not belt-and-braces. The pack is already built and already
      // written by here, so anything that goes wrong asking for it to be FINISHED must not turn a
      // request that was about to answer 200 with a playable partial pack into a 500. Left to the
      // outer catch, a throttled or transient claim would invert exactly the availability this
      // feature exists to add -- the same trap tryWrite exists to avoid one layer down.
      try {
        // The claim is what keeps this a repair path instead of an invoke storm. A pack that cannot
        // be completed -- because the corpus generation itself is failing, say -- is requested again
        // on every app open, and usePrefetch walks up to eight dates each time. Without the claim
        // that is an unbounded invoke rate against a job that will keep failing.
        if (await claimPackGeneration(date, packGenerationTimeoutMs)) {
          await invokeCreatePack(date)
        } else {
          log('A pack build is already in flight for this date', { date })
        }
      } catch (error: unknown) {
        logError('Could not hand this date to the pack builder, serving what is stored', { date, error })
      }
    }

    return { ...status.OK, body: JSON.stringify(pack) }
  } catch (error: unknown) {
    logError('Error retrieving pack', { date, error })
    return status.INTERNAL_SERVER_ERROR
  }
}
