import { packGenerationTimeoutMs } from '../config'
import { claimPackGeneration } from '../services/dynamodb'
import { invokeSlowGenerators } from '../services/lambda'
import { fillPack, hasWorkRemaining } from '../services/packs'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PackDate } from '../types'
import { log, logError } from '../utils/logging'
import { isValidPackDate } from '../utils/pack-date'
import status from '../utils/status'

export const getPackByDateHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // Validated before the table is touched: a path parameter reaching a DynamoDB key unvalidated is
  // an unbounded key. It also gates a write, so it is the only thing bounding which dates a caller
  // can cause to be generated.
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

    // 404 if and only if the pack ends up empty; an incomplete pack that still holds puzzles is
    // served with complete: false, which the client already refetches on. This is the only thing
    // stopping an empty pack reaching the client: lull-ui's isValidPack accepts `puzzles: []`, so
    // a 200 with no puzzles is cached as a sound pack under today's date and shadows yesterday's
    // good one on the shelf. A 404 caches nothing, so yesterday's pack keeps showing.
    if (pack.puzzles.length === 0) {
      log('No pack for date and nothing could be generated', { date })
      return { ...status.NOT_FOUND, body: JSON.stringify({ message: 'No pack for date' }) }
    }

    // The slow half of the repair path, after the pack is built and written, awaited only to the
    // point of queueing: the response carries whatever is playable now. What is left needs a model
    // call, which cannot happen inside a request under any circumstances.
    //
    // hasWorkRemaining, never `pack.complete`, which skips a best-effort contribution by design --
    // the hand-off asks whether anything is still worth attempting, so a pack short of only a
    // best-effort type still gets built.
    if (hasWorkRemaining(date, pack.puzzles)) {
      // Its own try/catch: the pack is already built and written, so a failure asking for it to be
      // finished must not turn a 200 with a playable partial pack into a 500.
      try {
        // The claim is what keeps this a repair path instead of an invoke storm. A pack that cannot
        // be completed is re-requested forever by design -- lull-ui asks on open, on reconnect and
        // on every resume, and its fetchPack short-circuits only on a COMPLETE stored pack -- so
        // without the claim that is an unbounded invoke rate against a job that keeps failing.
        if (await claimPackGeneration(date, packGenerationTimeoutMs)) {
          // One claim covers both builders. A second attribute would double the UpdateItem on this
          // latency path and double the invoke rate against a date that is failing.
          await invokeSlowGenerators(date)
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
