import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'

import { pack, packDate } from '../__mocks__'
import { claimPackGeneration, getPackByDate, getPackDates, setPackByDate } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  // The real exception class, not a stub: dynamodb.ts branches on `instanceof`, so the class the
  // source imports and the class the test throws have to be the same object.
  ConditionalCheckFailedException: jest.requireActual('@aws-sdk/client-dynamodb').ConditionalCheckFailedException,
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  GetItemCommand: jest.fn().mockImplementation((x) => x),
  PutItemCommand: jest.fn().mockImplementation((x) => x),
  QueryCommand: jest.fn().mockImplementation((x) => x),
  ScanCommand: jest.fn().mockImplementation((x) => x),
  UpdateItemCommand: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getPackByDate', () => {
    it('reads the pack for a date', async () => {
      mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(pack) } } })

      const result = await getPackByDate(packDate)

      expect(mockSend).toHaveBeenCalledWith({
        ConsistentRead: true,
        Key: { Date: { S: packDate } },
        TableName: 'packs-table',
      })
      expect(result).toEqual(pack)
    })

    // packs.ts re-reads through this function immediately after another writer's PutItem, inside the
    // replication window. An eventually consistent read there returns undefined for an item that
    // exists, packs.ts falls through to its own discarded copy, and the caller serves puzzle ids
    // that were never persisted -- orphaning the lull:progress a client stores against them.
    it('reads strongly consistently', async () => {
      mockSend.mockResolvedValueOnce({})

      await getPackByDate(packDate)

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ ConsistentRead: true }))
    })

    it('returns undefined when no pack exists for the date', async () => {
      mockSend.mockResolvedValueOnce({})

      expect(await getPackByDate(packDate)).toBeUndefined()
    })
  })

  describe('setPackByDate', () => {
    it('writes the pack under its date, conditional on the count it read', async () => {
      mockSend.mockResolvedValueOnce({})

      const written = await setPackByDate(packDate, pack, 2)

      expect(written).toEqual(true)
      expect(mockSend).toHaveBeenCalledWith({
        ConditionExpression: 'attribute_not_exists(#packDate) OR PuzzleCount = :expectedPuzzleCount',
        ExpressionAttributeNames: { '#packDate': 'Date' },
        ExpressionAttributeValues: { ':expectedPuzzleCount': { N: '2' } },
        Item: {
          Data: { S: JSON.stringify(pack) },
          Date: { S: packDate },
          PuzzleCount: { N: `${pack.puzzles.length}` },
        },
        TableName: 'packs-table',
      })
    })

    // At-least-once schedule delivery means two runs can race. Losing is expected, not an error.
    it('returns false rather than throwing when another run wrote first', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ $metadata: {}, message: 'The conditional request failed' }),
      )

      expect(await setPackByDate(packDate, pack, 2)).toEqual(false)
    })

    it('rethrows any other failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('table on fire'))

      await expect(setPackByDate(packDate, pack, 2)).rejects.toThrow('table on fire')
    })
  })

  describe('getPackDates', () => {
    it('aliases the Date attribute, which is a DynamoDB reserved word', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ Date: { S: packDate } }] })

      await getPackDates()

      expect(mockSend).toHaveBeenCalledWith({
        ExpressionAttributeNames: { '#packDate': 'Date' },
        ProjectionExpression: '#packDate',
        TableName: 'packs-table',
      })
    })

    it('follows LastEvaluatedKey until the scan is exhausted', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ Date: { S: '2026-06-14' } }],
        LastEvaluatedKey: { Date: { S: '2026-06-14' } },
      })
      mockSend.mockResolvedValueOnce({ Items: [{ Date: { S: '2026-06-15' } }] })

      const result = await getPackDates()

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenLastCalledWith({
        ExclusiveStartKey: { Date: { S: '2026-06-14' } },
        ExpressionAttributeNames: { '#packDate': 'Date' },
        ProjectionExpression: '#packDate',
        TableName: 'packs-table',
      })
      expect(result).toEqual(['2026-06-15', '2026-06-14'])
    })

    it('returns dates newest first', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ Date: { S: '2026-06-14' } }, { Date: { S: '2026-06-16' } }, { Date: { S: '2026-06-15' } }],
      })

      expect(await getPackDates()).toEqual(['2026-06-16', '2026-06-15', '2026-06-14'])
    })

    it('returns an empty list when the table is empty', async () => {
      mockSend.mockResolvedValueOnce({})

      expect(await getPackDates()).toEqual([])
    })
  })

  describe('claimPackGeneration', () => {
    const now = () => 1_000_000

    // UpdateItem with attribute_exists, NOT the PutItem connections-api uses for its equivalent
    // claim. A pack item already carries Data and PuzzleCount, so a Put would wipe them -- and
    // creating the item where none exists would be worse still: a row with no PuzzleCount can
    // never satisfy setPackByDate's `PuzzleCount = :expectedPuzzleCount` condition, so that date
    // could never be written again.
    it('stamps the claim without creating or replacing the pack', async () => {
      mockSend.mockResolvedValueOnce({})

      expect(await claimPackGeneration(packDate, 900_000, now)).toBe(true)
      expect(mockSend).toHaveBeenCalledWith({
        ConditionExpression:
          'attribute_exists(#packDate) AND (attribute_not_exists(GenerationStarted) OR GenerationStarted < :expiry)',
        ExpressionAttributeNames: { '#packDate': 'Date' },
        ExpressionAttributeValues: {
          ':expiry': { N: '100000' },
          ':startedAt': { N: '1000000' },
        },
        Key: { Date: { S: packDate } },
        TableName: 'packs-table',
        UpdateExpression: 'SET GenerationStarted = :startedAt',
      })
    })

    // Losing is the ordinary outcome, not an error: it means a build is already in flight, which is
    // exactly what the claim exists to detect.
    it('returns false when a claim is already held', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ $metadata: {}, message: 'The conditional request failed' }),
      )

      expect(await claimPackGeneration(packDate, 900_000, now)).toBe(false)
    })

    it('rethrows any other failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('table on fire'))

      await expect(claimPackGeneration(packDate, 900_000, now)).rejects.toThrow('table on fire')
    })
  })
})
