// Dates are UTC calendar dates; a developer machine east of UTC must not pass what CI would fail
process.env.TZ = 'UTC'

// DynamoDB

process.env.DYNAMODB_PACKS_TABLE_NAME = 'packs-table'
process.env.DYNAMODB_PROMPTS_TABLE_NAME = 'prompts-table'

// Packs

process.env.PACK_START_DATE = '2026-01-01'

// LLM

process.env.LLM_PHRASE_PROMPT_ID = 'create-phrases'
process.env.LLM_REVIEW_PROMPT_ID = 'review-phrases'

// Phrases

process.env.PHRASE_HISTORY_DAYS = '20'
process.env.INSPIRATION_ADJECTIVES_COUNT = '5'
process.env.INSPIRATION_NOUNS_COUNT = '10'
process.env.INSPIRATION_VERBS_COUNT = '8'

// Phrazle
//
// THE INTEGRATION SEAM for the guess dictionary, and the only one there is: isUsablePhrase calls
// getDictionary() with no arguments and is reached from bestFitIndex and poolBreadth with no
// injection point in between, so a default parameter cannot be intercepted from outside. The suites
// that run the real allocator get their dictionary from here.
//
// __tests__/fixtures/v1.txt is a small hand-maintained list, deliberately NOT the real 51,852-word
// slice: a suite that loads the whole asset to prove an ordering is a suite that hides its own
// dependency. Absolute, via __dirname, so it does not depend on the working directory a runner
// happens to use.
process.env.DICTIONARY_PATH = require('node:path').join(__dirname, '__tests__', 'fixtures')

// Logging

process.env.DEBUG_LOGGING = 'false'

// Lambda

process.env.CREATE_PHRASE_PUZZLES_FUNCTION_NAME = 'create-phrase-puzzles-function'
process.env.CREATE_MODEL_PUZZLES_FUNCTION_NAME = 'create-model-puzzles-function'
process.env.CREATE_PACK_FUNCTION_NAME = 'create-pack-function'

// Generation claims

process.env.PACK_GENERATION_TIMEOUT = '900'
