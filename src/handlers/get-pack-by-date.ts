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
    // true, so a 200 with no puzzles would be cached as a valid pack and render a date with nothing
    // on it -- and nothing would refetch it. Deleting this branch is not a lost 404, it is a
    // poisoned client cache.
    if (pack.puzzles.length === 0) {
      log('No pack for date and nothing could be generated', { date })
      return { ...status.NOT_FOUND, body: JSON.stringify({ message: 'No pack for date' }) }
    }

    return { ...status.OK, body: JSON.stringify(pack) }
  } catch (error: unknown) {
    logError('Error retrieving pack', { date, error })
    return status.INTERNAL_SERVER_ERROR
  }
}
