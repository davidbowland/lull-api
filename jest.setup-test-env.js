// Dates are UTC calendar dates; a developer machine east of UTC must not pass what CI would fail
process.env.TZ = 'UTC'

// DynamoDB

process.env.DYNAMODB_CORPUS_TABLE_NAME = 'corpus-table'
process.env.DYNAMODB_PACKS_TABLE_NAME = 'packs-table'
process.env.DYNAMODB_PROMPTS_TABLE_NAME = 'prompts-table'

// Packs

process.env.PACK_START_DATE = '2026-01-01'

// LLM

process.env.LLM_CORPUS_PROMPT_ID = 'create-phrase-corpus'

// Corpus

process.env.CORPUS_PHRASE_COUNT = '30'
process.env.INSPIRATION_ADJECTIVES_COUNT = '5'
process.env.INSPIRATION_NOUNS_COUNT = '10'
process.env.INSPIRATION_VERBS_COUNT = '8'

// Logging

process.env.DEBUG_LOGGING = 'false'

// Lambda

process.env.CREATE_CORPUS_FUNCTION_NAME = 'create-corpus-function'
process.env.CREATE_PACK_FUNCTION_NAME = 'create-pack-function'

// Generation claims

process.env.CORPUS_GENERATION_TIMEOUT = '900'
process.env.PACK_GENERATION_TIMEOUT = '900'
