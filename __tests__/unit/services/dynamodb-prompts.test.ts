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

  // A typo'd prompt id, or an LLM_*_PROMPT_ID env var wired to the wrong function, is the ordinary
  // way this fails, and four new ids are about to be added across three branches. Unguarded it
  // throws `SyntaxError: "undefined" is not valid JSON` into handlers that swallow every throw into
  // one generic line, so the symptom is a short pack and an ERROR naming the handler rather than the
  // cause. The id is IN the message: with several prompt ids in one function, the name is the whole
  // diagnostic.
  it.each([
    ['no item at all', {}],
    ['an item carrying no Config', { Items: [{ SystemPrompt: { S: 'generate phrases' } }] }],
  ])('names the prompt id when the query returns %s', async (_description, response) => {
    mockSend.mockResolvedValueOnce(response)

    await expect(getPromptById('typod-id')).rejects.toThrow('No prompt found for id "typod-id"')
  })
})
