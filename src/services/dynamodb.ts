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

// Prompt text and config live in a table and are pushed from the prompts/ directory by
// scripts/deploy-prompts.ts on each pipeline run, so tuning a prompt is not a code change. UpdatedAt is the sort key, so a descending Limit-1 query returns the newest
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
  const config = response.Items?.[0]?.Config?.S
  // A named error rather than SyntaxError: "undefined" is not valid JSON. A typo'd prompt id, or an
  // LLM_*_PROMPT_ID env var added to the wrong function, is the ordinary way this fails, and the
  // handlers swallow every throw into one generic line -- so without the name the symptom is a short
  // pack and an ERROR that points at the handler rather than at the cause.
  if (config === undefined) {
    throw new Error(`No prompt found for id "${promptId}"`)
  }
  return {
    config: JSON.parse(config),
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
//
// NOTHING WRITES THE PACKS TABLE EXCEPT THROUGH services/packs.ts's buildPack, which is the only
// caller of this function. Two builders, a request path and two schedules are five racers on this
// one conditional write; a direct write anywhere else silently discards another writer's puzzles
// and orphans the lull:progress a client keyed to them. Stated as a rule because
// CreateModelPuzzlesFunction is the first new writer since the rule became load-bearing.
//
// UpdateItem, NOT PutItem, and the reason is the one claimPackGeneration states forty lines below
// about ITS side of the same item -- never once read in this direction until it had shipped.
//
// GenerationStarted lives on this row. A PutItem replaces a row whole, and the Item this function
// used to build named Data, Date and PuzzleCount and nothing else, so EVERY SUCCESSFUL WRITE ERASED
// THE CLAIM THAT AUTHORIZED IT. That put the bound at exactly zero whenever generation was actually
// happening, which is the only circumstance it exists for: buildPack skips the write when it
// produced nothing, so the claim survived only on the runs that did no work. fillPack writes on the
// request path, both async builders write whatever they managed, and the next GET for a
// still-incomplete date then found attribute_not_exists(GenerationStarted), took a fresh claim and
// invoked both builders again. A date that CANNOT complete is re-requested by every client on every
// open and resume -- lull-ui's fetchPack short-circuits only on a COMPLETE stored pack -- so the
// 900-second TTL bounded nothing at all, and each cycle cost two invocations and a full round of
// Bedrock calls. CLAUDE.md: never retry unbounded. This was an unbounded retry with no loop in it.
//
// SET the two attributes this function owns and touch nothing else. UpdateItem upserts, so a cold
// date still creates the row, and the condition is unchanged in both wording and meaning.
//
// `Data` is a DynamoDB reserved word, like `Date`. It needed no alias while it sat in an Item, which
// is not an expression; inside an UpdateExpression a bare `Data` is a runtime ValidationException
// that no mocked unit test would ever see -- the same trap getPackDates documents below.
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

// A TTL-locked claim stamped on the pack item. It bounds how often the request path may hand work
// to the async builder: without it, every GET against a pack that
// cannot be completed is another invoke, and lull-ui asks again on open, on reconnect and on every
// resume for as long as the pack stays incomplete.
//
// It said "usePrefetch walks up to eight dates on every app open" until setPackByDate above was
// found to be erasing this attribute on every write. That figure was never true -- one date is
// requested, not eight -- and an overstated fan-out is how a bound that had stopped working still
// read as sufficient.
//
// UpdateItem with attribute_exists, NOT a PutItem. A pack item already carries Data and
// PuzzleCount, so a Put would wipe them -- and creating the item where none exists would
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

// Paginated deliberately. DynamoDB's 1MB Scan limit is real -- unlike the 1MB that used to be
// attributed to BatchGetItem in scripts/audit-hints.ts, which is a 16MB call -- and it counts bytes
// read FROM THE TABLE, before ProjectionExpression applies.
//
// Re-derived against the measured cap-bounded pack rather than the "~15KB" guess that produced the
// 66 this used to claim. At the complete six-type registry, 12,649 B MEASURED
// (__tests__/unit/services/packs-size.test.ts), a page holds roughly 82 packs -- rather than the
// ~60 the earlier ~17,523 B projection implied, since the projection came in high. It is short of the 365
// a year of dates needs, so without the LastEvaluatedKey loop this endpoint silently stops listing
// older dates AT ABOUT 82 DAYS -- just under three months.
//
// STATED IN DAYS RATHER THAN MONTHS, because the months were drifting. This read "somewhere between
// two and four months" at 76 packs and was edited to "two and five" at 82: an 8% gain in capacity
// moved the upper bound 25%, which is a range being re-guessed rather than re-derived. One pack is
// one date, so the page size IS the day count and there is nothing to convert. The dead-link failure
// this loop exists to prevent, inverted. Both figures come from
// __tests__/unit/services/packs-size.test.ts, which pins
// the byte count; nothing in code links the two, so that assertion moving is the cue to re-read
// this. It moved twice while this comment quoted 13,799: up to 17,007 across two band changes, then
// down to 12,649 when three types took their hint ladders off the wire. A stale figure here is a
// page size that reads LOW, which is the harmless direction -- the loop is correct at any size --
// and it is corrected rather than tolerated.
//
// The loop is correct for ANY page size, which is why the figure moving changes no constant and no
// code. If a future re-derivation ever takes it below about 30, that is the moment the round-trip
// count becomes worth a second look.
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
// are N known keys -- one call, bounded cost, and it does not grow with the archive. A Scan is the
// obvious alternative and is not affordable at ~12.6KB a pack.
//
// Never throws. This list only makes the prompt better, so a failure to read it must not stop a
// pack being built: the model simply gets no exclusions that run.
// UnprocessedKeys is NOT an error and NOT empty-means-done. BatchGetItem returns whatever it read
// plus the keys it declined -- on a throttle, a 16MB response cap, or an internal partition move --
// and every one of those silently shortens the exclusion list rather than failing. A pack missing
// from that list is a phrase the model is never told not to reuse, which is the exact defect this
// list exists to prevent, arriving without a log line.
//
// BOUNDED, because "never retry unbounded" applies here as much as to a generator: this runs inside
// the same 900-second Lambda. Four passes over a 41-key read is generous -- DynamoDB declines a
// handful of keys, not most of them -- and the bound is what stops a throttled table turning one
// read into an invocation with nothing to show.
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
      // `log`, not logError. A short list still builds a pack, and the alarm this stack has is a
      // subscription on level="ERROR" -- so a table under load must not page. It is named, because
      // the failure it precedes is a duplicate phrase nobody could otherwise explain.
      log('Gave up on some recent packs; exclusions are short', { asked: dates.length, unread: keys.length })
    }

    return items.filter((item) => item.Data?.S).map((item) => JSON.parse(item.Data?.S as string) as Pack)
  } catch (error: unknown) {
    logError('Could not read recent packs, generating without exclusions', { error })
    return []
  }
}
