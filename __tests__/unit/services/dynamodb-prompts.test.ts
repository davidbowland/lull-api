import { getPromptById } from '@services/dynamodb'

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

describe('getPromptById', () => {
  const config = {
    anthropicVersion: 'bedrock-2023-05-31',
    maxTokens: 16000,
    model: 'us.anthropic.claude-opus-5',
    thinkingEffort: 'high',
  }
  const item = { Config: { S: JSON.stringify(config) }, SystemPrompt: { S: 'generate phrases' } }

  // UpdatedAt is the sort key, so descending with Limit 1 is "the newest revision of this prompt".
  // Older revisions stay in the table rather than being overwritten, which is what makes a bad
  // prompt deploy diffable after the fact.
  it('queries the newest revision of the prompt', async () => {
    mockSend.mockResolvedValueOnce({ Items: [item] })

    await getPromptById('create-phrase-corpus')

    expect(mockSend).toHaveBeenCalledWith({
      ExpressionAttributeValues: { ':promptId': { S: 'create-phrase-corpus' } },
      KeyConditionExpression: 'PromptId = :promptId',
      Limit: 1,
      ScanIndexForward: false,
      TableName: 'prompts-table',
    })
  })

  it('returns the parsed config and the prompt contents', async () => {
    mockSend.mockResolvedValueOnce({ Items: [item] })

    expect(await getPromptById('create-phrase-corpus')).toEqual({
      config,
      contents: 'generate phrases',
    })
  })
})
