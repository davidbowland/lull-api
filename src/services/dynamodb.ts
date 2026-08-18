import {
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  PutItemOutput,
  ScanCommand,
  ScanCommandOutput,
} from '@aws-sdk/client-dynamodb'

import { dynamodbPacksTableName } from '../config'
import { Pack, PackDate } from '../types'

const dynamodb = new DynamoDB({ apiVersion: '2012-08-10' })

export const getPackByDate = async (date: PackDate): Promise<Pack | undefined> => {
  const command = new GetItemCommand({
    Key: {
      Date: {
        S: `${date}`,
      },
    },
    TableName: dynamodbPacksTableName,
  })
  const response = await dynamodb.send(command)
  return response.Item?.Data?.S ? (JSON.parse(response.Item.Data.S) as Pack) : undefined
}

export const setPackByDate = async (date: PackDate, pack: Pack): Promise<PutItemOutput> => {
  const command = new PutItemCommand({
    Item: {
      Data: {
        S: JSON.stringify(pack),
      },
      Date: {
        S: `${date}`,
      },
    },
    TableName: dynamodbPacksTableName,
  })
  return await dynamodb.send(command)
}

// Paginated deliberately. DynamoDB's 1MB Scan limit counts bytes read FROM THE TABLE, before
// ProjectionExpression applies, so at ~15KB a pack that is roughly 66 items per page rather than
// the 365 a year of dates needs. Without the LastEvaluatedKey loop this endpoint silently stops
// listing older dates after about two months -- the dead-link failure it exists to prevent,
// inverted.
//
// `Date` is a DynamoDB reserved word. It needs no escaping in Key or Item, which are not
// expressions, but a bare `Date` in a ProjectionExpression is a runtime ValidationException that no
// mocked unit test would ever see, hence the alias.
export const getPackDates = async (): Promise<PackDate[]> => {
  const dates: PackDate[] = []
  let lastEvaluatedKey: ScanCommandOutput['LastEvaluatedKey']

  do {
    const command = new ScanCommand({
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      ExpressionAttributeNames: { '#packDate': 'Date' },
      ProjectionExpression: '#packDate',
      TableName: dynamodbPacksTableName,
    })
    const response: ScanCommandOutput = await dynamodb.send(command)
    response.Items?.forEach((item) => {
      if (item.Date?.S) {
        dates.push(item.Date.S)
      }
    })
    lastEvaluatedKey = response.LastEvaluatedKey
  } while (lastEvaluatedKey)

  // Dates are YYYY-MM-DD, so a descending string sort is newest-first
  return dates.sort((left, right) => right.localeCompare(left))
}
