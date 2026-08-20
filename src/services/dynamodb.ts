import {
  BatchGetItemCommand,
  ConditionalCheckFailedException,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  ScanCommandOutput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'

import { dynamodbPacksTableName, dynamodbPromptsTableName } from '../config'
import { Pack, PackDate, Prompt, PromptId } from '../types'
import { logError } from '../utils/logging'

const dynamodb = new DynamoDB({ apiVersion: '2012-08-10' })

// Prompts

// Vendored from connections-api. Prompt text and config live in a table and are pushed from the
// prompts/ directory by scripts/deploy-prompts.ts on each pipeline run, so tuning a prompt is not
// a code change. UpdatedAt is the sort key, so a descending Limit-1 query returns the newest
// revision and older ones stay readable for comparison.
export const getPromptById = async (promptId: PromptId): Promise<Prompt> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':promptId': { S: `${promptId}` } },
    KeyConditionExpression: 'PromptId = :promptId',
    Limit: 1,
    ScanIndexForward: false,
    TableName: dynamodbPromptsTableName,
  })
  const response = await dynamodb.send(command)
  return {
    config: JSON.parse(response.Items?.[0]?.Config?.S as string),
    contents: response.Items?.[0]?.SystemPrompt?.S as string,
  }
}

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

// A TTL-locked claim, mirroring connections-api's GenerationStarted attribute. It bounds how often
// the request path may hand work to the async builder: without it, every GET against a pack that
// cannot be completed is another invoke, and usePrefetch walks up to eight dates on every app open.
//
// UpdateItem with attribute_exists, NOT the PutItem connections uses. A pack item already carries
// Data and PuzzleCount, so a Put would wipe them -- and creating the item where none exists would
// be worse: a row with no PuzzleCount can never satisfy setPackByDate's
// `PuzzleCount = :expectedPuzzleCount` condition, so that date could never be written again.
//
// Returns false when another caller holds an unexpired claim, which is the ordinary outcome and
// not an error.
export const claimPackGeneration = async (
  date: PackDate,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<boolean> => {
  const timestamp = now()
  const command = new UpdateItemCommand({
    ConditionExpression:
      'attribute_exists(#packDate) AND (attribute_not_exists(GenerationStarted) OR GenerationStarted < :expiry)',
    ExpressionAttributeNames: { '#packDate': 'Date' },
    ExpressionAttributeValues: {
      ':expiry': { N: `${timestamp - timeoutMs}` },
      ':startedAt': { N: `${timestamp}` },
    },
    Key: { Date: { S: `${date}` } },
    TableName: dynamodbPacksTableName,
    UpdateExpression: 'SET GenerationStarted = :startedAt',
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

// Recent packs, for the "do not reuse these phrases" list handed to the model.
//
// BatchGetItem over computed dates, NOT a Scan. `Date` is the partition key, so the last N days
// are N known keys -- one call, bounded cost, and it does not grow with the archive.
// connections-api Scans its whole games table for the equivalent list, which is affordable there
// at ~1KB a game and would not be here at ~15KB a pack.
//
// Never throws. This list only makes the prompt better, so a failure to read it must not stop a
// pack being built: the model simply gets no exclusions that run.
export const getRecentPacks = async (dates: PackDate[]): Promise<Pack[]> => {
  if (dates.length === 0) {
    return []
  }
  try {
    const command = new BatchGetItemCommand({
      RequestItems: {
        [dynamodbPacksTableName]: {
          Keys: dates.map((date) => ({ Date: { S: `${date}` } })),
        },
      },
    })
    const response = await dynamodb.send(command)
    return (response.Responses?.[dynamodbPacksTableName] ?? [])
      .filter((item) => item.Data?.S)
      .map((item) => JSON.parse(item.Data?.S as string) as Pack)
  } catch (error: unknown) {
    logError('Could not read recent packs, generating without exclusions', { error })
    return []
  }
}
