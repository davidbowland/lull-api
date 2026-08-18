import { getPackDates } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

// Queries stored pack keys rather than computing a date range. Lull cannot generate on demand, so
// an advertised date with no pack is a dead link.
export const getPackDatesHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  try {
    const dates = await getPackDates()
    return { ...status.OK, body: JSON.stringify({ dates }) }
  } catch (error: unknown) {
    logError('Error retrieving pack dates', { error })
    return status.INTERNAL_SERVER_ERROR
  }
}
