// Dates are UTC calendar dates; a developer machine east of UTC must not pass what CI would fail
process.env.TZ = 'UTC'

// DynamoDB

process.env.DYNAMODB_PACKS_TABLE_NAME = 'packs-table'

// Packs

process.env.PACK_START_DATE = '2026-01-01'

// Logging
