import {
  BatchGetItemCommand,
  ConditionalCheckFailedException,
  DynamoDB,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  ScanCommandOutput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'

import { dynamodbPacksTableName, dynamodbPromptsTableName } from '../config'
import { Pack, PackDate, Prompt, PromptId } from '../types'
import { log, logError } from '../utils/logging'

const dynamodb = new DynamoDB({ apiVersion: '2012-08-10' })

// Prompts

// Prompt text and config live in a table, pushed from prompts/ by scripts/deploy-prompts.ts on
// each pipeline run, so tuning a prompt is not a code change. UpdatedAt is the sort key, so a
// descending Limit-1 query returns the newest revision and older ones stay readable.
export const getPromptById = async (promptId: PromptId): Promise<Prompt> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':promptId': { S: `${promptId}` } },
    KeyConditionExpression: 'PromptId = :promptId',
    Limit: 1,
    ScanIndexForward: false,
    TableName: dynamodbPromptsTableName,
  })
  const response = await dynamodb.send(command)
  const config = response.Items?.[0]?.Config?.S
  // A named error rather than a SyntaxError on "undefined". A typo'd prompt id or an
  // LLM_*_PROMPT_ID set on the wrong function is the ordinary way this fails, and the handlers
  // swallow every throw into one generic line, so without the name the symptom is a short pack
  // and an ERROR pointing at the handler rather than the cause.
  if (config === undefined) {
    throw new Error(`No prompt found for id "${promptId}"`)
  }
  return {
    config: JSON.parse(config),
    contents: response.Items?.[0]?.SystemPrompt?.S as string,
  }
}

// Strongly consistent on every read, not just the lost-race one. packs.ts re-reads through here
// inside another writer's replication window, and an eventually consistent read returns undefined
// for an item that exists -- packs.ts then falls through to its own discarded copy and serves
// puzzle ids that were never persisted, orphaning the lull:progress stored against them. The cost
// is 2x read units on one small item.
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
// PuzzleCount is its own attribute because a ConditionExpression cannot reach inside the
// serialized Data blob.
//
// NOTHING WRITES THE PACKS TABLE except through services/packs.ts's buildPack, the only caller of
// this function. Five racers already share this conditional write; a direct write anywhere else
// silently discards another writer's puzzles and orphans the lull:progress keyed to them.
//
// UpdateItem, NOT PutItem, because claimPackGeneration's GenerationStarted lives on this row and
// a Put replaces the row whole -- every successful write would erase the claim that authorized
// it, so the TTL would bound nothing and every GET for a date that cannot complete would take a
// fresh claim and invoke both builders again: an unbounded retry with no loop in it. SET the two
// attributes this function owns and touch nothing else; UpdateItem upserts, so a cold date still
// creates the row.
//
// `Data` is a DynamoDB reserved word, like `Date`. It needs no alias in an Item, which is not an
// expression, but inside an UpdateExpression a bare `Data` is a runtime ValidationException that
// no mocked unit test would ever see.
export const setPackByDate = async (date: PackDate, pack: Pack, expectedPuzzleCount: number): Promise<boolean> => {
  const command = new UpdateItemCommand({
    ConditionExpression: 'attribute_not_exists(#packDate) OR PuzzleCount = :expectedPuzzleCount',
    ExpressionAttributeNames: { '#data': 'Data', '#packDate': 'Date' },
    ExpressionAttributeValues: {
      ':data': { S: JSON.stringify(pack) },
      ':expectedPuzzleCount': { N: `${expectedPuzzleCount}` },
      ':puzzleCount': { N: `${pack.puzzles.length}` },
    },
    Key: {
      Date: {
        S: `${date}`,
      },
    },
    TableName: dynamodbPacksTableName,
    UpdateExpression: 'SET #data = :data, PuzzleCount = :puzzleCount',
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

// A TTL-locked claim stamped on the pack item, bounding how often the request path may hand work
// to the async builder. Without it every GET against a pack that cannot be completed is another
// invoke, and lull-ui asks again on open, on reconnect and on every resume.
//
// UpdateItem with attribute_exists, NOT a PutItem: a Put would wipe the row's Data and
// PuzzleCount, and creating the item where none exists is worse -- a row with no PuzzleCount can
// never satisfy setPackByDate's condition, so that date could never be written again.
//
// Returns false when another caller holds an unexpired claim, which is ordinary and not an error.
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
// ProjectionExpression applies. At a measured 12,345 B per complete pack
// (__tests__/unit/services/packs-size.test.ts) a page holds roughly 84 packs, and one pack is one
// date, so without the LastEvaluatedKey loop this endpoint silently stops listing older dates at
// about 84 days. The loop is correct at any page size, so that byte count moving changes no code.
//
// `Date` is a DynamoDB reserved word. It needs no escaping in Key or Item, which are not
// expressions, but a bare `Date` in a ProjectionExpression is a runtime ValidationException that
// no mocked unit test would ever see, hence the alias.
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
// are N known keys -- one call, bounded cost, and it does not grow with the archive. A Scan is not
// affordable at ~12.6KB a pack.
//
// Never throws: this list only makes the prompt better, so failing to read it must not stop a
// pack being built.
//
// UnprocessedKeys is not an error and not empty-means-done. BatchGetItem returns whatever it read
// plus the keys it declined -- on a throttle, a 16MB response cap, or a partition move -- and
// each of those silently shortens the exclusion list into a duplicate phrase with no log line.
//
// Bounded, because this runs inside the same 900-second Lambda: four passes over a 41-key read is
// generous, and the bound stops a throttled table turning one read into a spent invocation.
const MAX_BATCH_GET_PASSES = 4

export const getRecentPacks = async (dates: PackDate[]): Promise<Pack[]> => {
  if (dates.length === 0) {
    return []
  }
  try {
    const items = []
    let keys = dates.map((date) => ({ Date: { S: `${date}` } }))

    for (let pass = 0; pass < MAX_BATCH_GET_PASSES && keys.length > 0; pass += 1) {
      const response = await dynamodb.send(
        new BatchGetItemCommand({ RequestItems: { [dynamodbPacksTableName]: { Keys: keys } } }),
      )
      items.push(...(response.Responses?.[dynamodbPacksTableName] ?? []))
      keys = (response.UnprocessedKeys?.[dynamodbPacksTableName]?.Keys ?? []) as typeof keys
    }

    if (keys.length > 0) {
      // `log`, not logError: a short list still builds a pack, and the alarm here is a
      // subscription on level="ERROR", so a table under load must not page. Named anyway, because
      // the failure it precedes is a duplicate phrase nobody could otherwise explain.
      log('Gave up on some recent packs; exclusions are short', { asked: dates.length, unread: keys.length })
    }

    return items.filter((item) => item.Data?.S).map((item) => JSON.parse(item.Data?.S as string) as Pack)
  } catch (error: unknown) {
    logError('Could not read recent packs, generating without exclusions', { error })
    return []
  }
}
