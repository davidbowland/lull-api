// Dates are UTC calendar dates; a developer machine east of UTC must not pass what CI would fail
process.env.TZ = 'UTC'

// DynamoDB

process.env.DYNAMODB_PACKS_TABLE_NAME = 'packs-table'
process.env.DYNAMODB_PROMPTS_TABLE_NAME = 'prompts-table'

// Packs

process.env.PACK_START_DATE = '2026-01-01'

// LLM

process.env.LLM_PHRASE_PROMPT_ID = 'create-phrases'

// Phrases

process.env.PHRASE_HISTORY_DAYS = '20'
process.env.INSPIRATION_ADJECTIVES_COUNT = '5'
process.env.INSPIRATION_NOUNS_COUNT = '10'
process.env.INSPIRATION_VERBS_COUNT = '8'

// Logging

process.env.DEBUG_LOGGING = 'false'

// Lambda

process.env.CREATE_PHRASE_PUZZLES_FUNCTION_NAME = 'create-phrase-puzzles-function'
process.env.CREATE_PACK_FUNCTION_NAME = 'create-pack-function'

// Generation claims

process.env.PACK_GENERATION_TIMEOUT = '900'
