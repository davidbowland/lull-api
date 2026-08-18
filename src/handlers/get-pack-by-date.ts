import { getPackByDate } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PackDate } from '../types'
import { log, logError } from '../utils/logging'
import { isValidPackDate } from '../utils/pack-date'
import status from '../utils/status'

export const getPackByDateHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // Validated BEFORE the table is touched: a path parameter reaching a DynamoDB key unvalidated is
  // an unbounded key.
  const date: PackDate | undefined = event.pathParameters?.date
  if (!date || !isValidPackDate(date)) {
    log('Invalid pack date', { date })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ message: 'Invalid pack date' }) }
  }

  try {
    const pack = await getPackByDate(date)
    if (!pack) {
      log('No pack for date', { date })
      return { ...status.NOT_FOUND, body: JSON.stringify({ message: 'No pack for date' }) }
    }

    return { ...status.OK, body: JSON.stringify(pack) }
  } catch (error: unknown) {
    logError('Error retrieving pack', { date, error })
    return status.INTERNAL_SERVER_ERROR
  }
}
