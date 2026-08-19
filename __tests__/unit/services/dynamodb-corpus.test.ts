import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'

import { corpus, corpusEntries, packDate } from '../__mocks__'
import { getLatestCorpus, markCorpusEntriesUsed, setCorpus } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
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

describe('dynamodb corpus', () => {
  const storedItem = {
    Data: { S: JSON.stringify(corpusEntries) },
    Date: { S: packDate },
    UsedIds: { SS: ['a1b2c3d4'] },
  }

  describe('getLatestCorpus', () => {
    // A constant partition key with the date as the sort key is what makes "the most recent stored
    // corpus" a single descending Query with Limit 1, rather than a Scan that grows with the
    // archive. It is a hot-partition shape in general and entirely fine here: one write a night and
    // a handful of reads a day.
    it('queries the newest corpus with a descending limit-one query', async () => {
      mockSend.mockResolvedValueOnce({ Items: [storedItem] })

      await getLatestCorpus()

      expect(mockSend).toHaveBeenCalledWith({
        ConsistentRead: true,
        ExpressionAttributeNames: { '#corpusKind': 'Kind' },
        ExpressionAttributeValues: { ':corpusKind': { S: 'phrase' } },
        KeyConditionExpression: '#corpusKind = :corpusKind',
        Limit: 1,
        ScanIndexForward: false,
        TableName: 'corpus-table',
      })
    })

    it('returns the corpus with its date, entries, and used ids', async () => {
      mockSend.mockResolvedValueOnce({ Items: [storedItem] })

      expect(await getLatestCorpus()).toEqual({
        date: packDate,
        entries: corpusEntries,
        usedIds: ['a1b2c3d4'],
      })
    })

    // DynamoDB cannot store an empty string set, so a corpus nothing has consumed yet has no
    // UsedIds attribute at all rather than an empty one.
    it('treats a missing UsedIds attribute as nothing used', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ Data: storedItem.Data, Date: storedItem.Date }] })

      expect((await getLatestCorpus())?.usedIds).toEqual([])
    })

    it.each([
      ['the table is empty', {}],
      ['the query returns no items', { Items: [] }],
    ])('returns undefined when %s', async (_description, response) => {
      mockSend.mockResolvedValueOnce(response)

      expect(await getLatestCorpus()).toBeUndefined()
    })

    // The read is strongly consistent for the same reason getPackByDate is: the request path can
    // read a corpus moments after CreateCorpusFunction wrote it, and an eventually consistent read
    // there produces a needless fallback to a stale night.
    it('reads strongly consistently', async () => {
      mockSend.mockResolvedValueOnce({ Items: [storedItem] })

      await getLatestCorpus()

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ ConsistentRead: true }))
    })
  })

  describe('setCorpus', () => {
    it('writes the entries under the constant kind and its date', async () => {
      mockSend.mockResolvedValueOnce({})

      const written = await setCorpus(packDate, corpusEntries)

      expect(written).toEqual(true)
      expect(mockSend).toHaveBeenCalledWith({
        ConditionExpression: 'attribute_not_exists(#corpusDate)',
        ExpressionAttributeNames: { '#corpusDate': 'Date' },
        Item: {
          Data: { S: JSON.stringify(corpusEntries) },
          Date: { S: packDate },
          Kind: { S: 'phrase' },
        },
        TableName: 'corpus-table',
      })
    })

    // The write is conditional to protect usedIds, not to protect the entries. EventBridge delivers
    // at least once, so a second invocation the same night would otherwise replace the corpus item
    // wholesale -- discarding the used-id set accumulated by any pack built in between, and letting
    // those phrases be served twice.
    it('returns false rather than throwing when a corpus already exists for the date', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ $metadata: {}, message: 'The conditional request failed' }),
      )

      expect(await setCorpus(packDate, corpusEntries)).toEqual(false)
    })

    it('rethrows any other failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('table on fire'))

      await expect(setCorpus(packDate, corpusEntries)).rejects.toThrow('table on fire')
    })
  })

  describe('markCorpusEntriesUsed', () => {
    // ADD on a string set is a set union, which is atomic and idempotent. Two packs consuming from
    // the same fallback corpus concurrently both land, and a retried invocation adding ids already
    // present is a no-op -- so this needs no condition, no read-modify-write, and no retry logic.
    it('unions the ids into the used set', async () => {
      mockSend.mockResolvedValueOnce({})

      await markCorpusEntriesUsed(corpus.date, ['f8c8a0b1', 'd4e5f6a7'])

      expect(mockSend).toHaveBeenCalledWith({
        ExpressionAttributeNames: { '#corpusDate': 'Date' },
        ExpressionAttributeValues: { ':usedIds': { SS: ['f8c8a0b1', 'd4e5f6a7'] } },
        Key: {
          Date: { S: packDate },
          Kind: { S: 'phrase' },
        },
        TableName: 'corpus-table',
        UpdateExpression: 'ADD UsedIds :usedIds',
      })
    })

    // DynamoDB rejects an empty string set outright, so the guard is required rather than an
    // optimization. A pack that consumed nothing is the ordinary case on a complete day.
    it('makes no call when nothing was consumed', async () => {
      await markCorpusEntriesUsed(corpus.date, [])

      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
