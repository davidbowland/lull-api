import { pack, packDate } from '../__mocks__'
import { getPackByDate, getPackDates, setPackByDate } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDB: jest.fn(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  GetItemCommand: jest.fn().mockImplementation((x) => x),
  PutItemCommand: jest.fn().mockImplementation((x) => x),
  ScanCommand: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getPackByDate', () => {
    it('reads the pack for a date', async () => {
      mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(pack) } } })

      const result = await getPackByDate(packDate)

      expect(mockSend).toHaveBeenCalledWith({
        Key: { Date: { S: packDate } },
        TableName: 'packs-table',
      })
      expect(result).toEqual(pack)
    })

    it('returns undefined when no pack exists for the date', async () => {
      mockSend.mockResolvedValueOnce({})

      expect(await getPackByDate(packDate)).toBeUndefined()
    })
  })

  describe('setPackByDate', () => {
    it('writes the pack under its date', async () => {
      mockSend.mockResolvedValueOnce({})

      await setPackByDate(packDate, pack)

      expect(mockSend).toHaveBeenCalledWith({
        Item: {
          Data: { S: JSON.stringify(pack) },
          Date: { S: packDate },
        },
        TableName: 'packs-table',
      })
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
})
