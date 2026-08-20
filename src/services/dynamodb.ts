import {
  ConditionalCheckFailedException,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  ScanCommandOutput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'

import { dynamodbCorpusTableName, dynamodbPacksTableName, dynamodbPromptsTableName } from '../config'
import { Corpus, CorpusEntry, Pack, PackDate, Prompt, PromptId } from '../types'

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

// Corpus

// Every corpus item shares one partition key so that "the most recent stored corpus" is a single
// descending Query with Limit 1 rather than a Scan whose cost grows with the archive. A constant
// partition key is a hot-partition shape in general, and is entirely fine at this volume: one
// write a night against a handful of reads a day.
const CORPUS_KIND = 'phrase'

// A separate partition from the corpus rows, so a lock can never be mistaken for a corpus by
// getLatestCorpus's descending query.
const CORPUS_LOCK_KIND = 'lock'

// Strongly consistent for the same reason getPackByDate is. The request path can read a corpus
// moments after CreateCorpusFunction wrote it, and an eventually consistent read there falls back
// to a stale night for no reason -- serving phrases a fresh corpus had already replaced.
export const getLatestCorpus = async (): Promise<Corpus | undefined> => {
  const command = new QueryCommand({
    ConsistentRead: true,
    ExpressionAttributeNames: { '#corpusKind': 'Kind' },
    ExpressionAttributeValues: { ':corpusKind': { S: CORPUS_KIND } },
    KeyConditionExpression: '#corpusKind = :corpusKind',
    Limit: 1,
    // Descending, so the newest date comes first.
    ScanIndexForward: false,
    TableName: dynamodbCorpusTableName,
  })
  const response = await dynamodb.send(command)
  const item = response.Items?.[0]
  if (!item?.Data?.S || !item.Date?.S) {
    return undefined
  }
  return {
    date: item.Date.S,
    entries: JSON.parse(item.Data.S) as CorpusEntry[],
    // DynamoDB cannot store an empty string set, so a corpus nothing has consumed carries no
    // UsedIds attribute at all rather than an empty one.
    usedIds: item.UsedIds?.SS ?? [],
  }
}

// Conditional to protect usedIds, NOT to protect the entries. EventBridge delivers at least once,
// so a second invocation on the same night would otherwise replace the item wholesale and discard
// the used-id set any pack built in between had accumulated -- letting those phrases be served a
// second time. Losing is an expected outcome, so it returns false rather than throwing, exactly as
// setPackByDate does.
export const setCorpus = async (date: PackDate, entries: CorpusEntry[]): Promise<boolean> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(#corpusDate)',
    ExpressionAttributeNames: { '#corpusDate': 'Date' },
    Item: {
      Data: {
        S: JSON.stringify(entries),
      },
      Date: {
        S: `${date}`,
      },
      Kind: {
        S: CORPUS_KIND,
      },
    },
    TableName: dynamodbCorpusTableName,
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
// the request path may hand work to the async pack builder: without it, every GET against a pack
// that cannot be completed is another invoke, and usePrefetch walks up to eight dates on every app
// open.
//
// UpdateItem with attribute_exists, NOT the PutItem connections uses. A pack item already carries
// Data and PuzzleCount, so a Put would wipe them -- and creating the item where none exists would
// be worse: it would leave a row with no PuzzleCount, against which createPack's
// `PuzzleCount = :expectedPuzzleCount` condition can never be true, bricking that date's writes
// forever.
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

// The corpus is the expensive shared resource, so it gets its own claim rather than relying on the
// per-date one above. Eight prefetched dates each invoking the async builder would otherwise mean
// eight concurrent Bedrock calls on a cold stack -- the per-date claim cannot stop that, because
// each of those dates is a different item.
//
// A lock row beside the corpus rows, not an attribute on one: on a cold stack the corpus item that
// would carry the attribute does not exist yet, which is exactly when the lock is needed.
export const claimCorpusGeneration = async (
  date: PackDate,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<boolean> => {
  const timestamp = now()
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(GenerationStarted) OR GenerationStarted < :expiry',
    ExpressionAttributeValues: { ':expiry': { N: `${timestamp - timeoutMs}` } },
    Item: {
      Date: { S: `${date}` },
      GenerationStarted: { N: `${timestamp}` },
      Kind: { S: CORPUS_LOCK_KIND },
    },
    TableName: dynamodbCorpusTableName,
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

// ADD on a string set is a set union: atomic, idempotent, and commutative. Two packs drawing from
// the same fallback corpus concurrently both land, and a retried invocation re-adding ids already
// present is a no-op. That is why this needs no condition, no read-modify-write, and no retry.
export const markCorpusEntriesUsed = async (date: PackDate, ids: string[]): Promise<void> => {
  // DynamoDB rejects an empty string set outright, so this guard is required rather than an
  // optimization -- and a pack that consumed nothing is the ordinary case on a complete day.
  if (ids.length === 0) {
    return
  }
  const command = new UpdateItemCommand({
    ExpressionAttributeNames: { '#corpusDate': 'Date' },
    ExpressionAttributeValues: { ':usedIds': { SS: ids } },
    Key: {
      Date: {
        S: `${date}`,
      },
      Kind: {
        S: CORPUS_KIND,
      },
    },
    TableName: dynamodbCorpusTableName,
    UpdateExpression: 'ADD UsedIds :usedIds',
  })
  await dynamodb.send(command)
}
