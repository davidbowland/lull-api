import {
  ConditionalCheckFailedException,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  ScanCommandOutput,
} from '@aws-sdk/client-dynamodb'

import { dynamodbPacksTableName } from '../config'
import { Pack, PackDate } from '../types'

const dynamodb = new DynamoDB({ apiVersion: '2012-08-10' })

// Strongly consistent on every read, not just the lost-race one. packs.ts re-reads through here
// immediately after another writer's PutItem, inside the replication window: an eventually
// consistent read there returns undefined for an item that exists, packs.ts falls through to its
// own discarded copy, and the caller serves puzzle ids that were never persisted -- orphaning the
// lull:progress a client stores against them. It also narrows the window in which two clients
// racing a cold date both see nothing and duplicate the generation work. The cost is 2x read units
// on one small item, which is nothing at this traffic, and a per-call parameter would only add a
// way to get it wrong.
export const getPackByDate = async (date: PackDate): Promise<Pack | undefined> => {
  const command = new GetItemCommand({
    ConsistentRead: true,
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

// Optimistic concurrency on the puzzle count the caller read. Returns false when another run wrote
// first, rather than throwing: a lost race is an expected outcome of at-least-once schedule
// delivery, not an error, and the next retry tops up whatever is still missing.
//
// PuzzleCount is stored as its own attribute because a ConditionExpression cannot reach inside the
// serialized Data blob.
export const setPackByDate = async (date: PackDate, pack: Pack, expectedPuzzleCount: number): Promise<boolean> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(#packDate) OR PuzzleCount = :expectedPuzzleCount',
    ExpressionAttributeNames: { '#packDate': 'Date' },
    ExpressionAttributeValues: { ':expectedPuzzleCount': { N: `${expectedPuzzleCount}` } },
    Item: {
      Data: {
        S: JSON.stringify(pack),
      },
      Date: {
        S: `${date}`,
      },
      PuzzleCount: {
        N: `${pack.puzzles.length}`,
      },
    },
    TableName: dynamodbPacksTableName,
  })
  try {
    await dynamodb.send(command)
    return true
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      return false
    }
    throw error
  }
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
