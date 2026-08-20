#!/usr/bin/env ts-node
import { DynamoDB, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const dynamodb = new DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' })

interface PromptData {
  promptId: string
  config: string
  systemPrompt: string
  updatedAt: number
}

interface ExistingPrompt {
  config: string
  systemPrompt: string
}

const parsePromptFile = (filename: string, content: string, now: number): PromptData => {
  const promptId = filename.split('.', 1)[0]
  const { config, systemPrompt } =
    /^[\s#]*(?<config>[^\n]+)\s*\n\s+(?<systemPrompt>.*?)\s+$/s.exec(content)?.groups ?? {}

  try {
    JSON.parse(config)
  } catch {
    throw new Error(`Invalid JSON in prompt config: ${filename}`)
  }

  return {
    promptId,
    config,
    systemPrompt,
    updatedAt: now,
  }
}

const getExistingPrompt = async (tableName: string, promptId: string): Promise<ExistingPrompt | null> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':promptId': { S: promptId } },
    KeyConditionExpression: 'PromptId = :promptId',
    Limit: 1,
    ScanIndexForward: false,
    TableName: tableName,
  })

  try {
    const response = await dynamodb.send(command)
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    return {
      config: response.Items[0].Config?.S as string,
      systemPrompt: response.Items[0].SystemPrompt?.S as string,
    }
  } catch {
    return null
  }
}

const deployPrompt = async (tableName: string, promptData: PromptData): Promise<void> => {
  const command = new PutItemCommand({
    Item: {
      PromptId: {
        S: promptData.promptId,
      },
      UpdatedAt: {
        N: `${promptData.updatedAt}`,
      },
      Config: {
        S: promptData.config,
      },
      SystemPrompt: {
        S: promptData.systemPrompt,
      },
    },
    TableName: tableName,
  })

  await dynamodb.send(command)
  console.log('Deployed prompt', { promptId: promptData.promptId, tableName })
}

const deployPrompts = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const tableName = args[0] || 'lull-api-prompts-test'
  const now = Date.now()

  try {
    const promptsDir = join(__dirname, '../prompts')
    const files = await readdir(promptsDir)

    if (files.length === 0) {
      console.warn('No prompt files found', { promptsDir })
      return
    }

    console.log('Found prompt files', { count: files.length, files: files })

    for (const file of files) {
      const filePath = join(promptsDir, file)
      const content = await readFile(filePath, 'utf-8')
      const promptData = parsePromptFile(file, content, now)
      const existingPrompt = await getExistingPrompt(tableName, promptData.promptId)

      if (existingPrompt?.systemPrompt === promptData.systemPrompt && existingPrompt?.config === promptData.config) {
        console.log('Skipping unchanged prompt', { promptId: promptData.promptId })
      } else {
        await deployPrompt(tableName, promptData)
      }
    }

    console.log('Deployment complete', { total: files.length, tableName })
  } catch (error: unknown) {
    console.error('Failed to deploy prompts', error)
    process.exit(1)
  }
}

if (require.main === module) {
  deployPrompts()
}

export { deployPrompts }
