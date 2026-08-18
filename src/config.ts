// DynamoDB

export const dynamodbPacksTableName = process.env.DYNAMODB_PACKS_TABLE_NAME as string

// Packs

export const packStartDate = process.env.PACK_START_DATE as string

// Logging

export const debugLogging = (process.env.DEBUG_LOGGING as string) === 'true'
