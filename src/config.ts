// DynamoDB

export const dynamodbCorpusTableName = process.env.DYNAMODB_CORPUS_TABLE_NAME as string
export const dynamodbPacksTableName = process.env.DYNAMODB_PACKS_TABLE_NAME as string
export const dynamodbPromptsTableName = process.env.DYNAMODB_PROMPTS_TABLE_NAME as string

// Packs

export const packStartDate = process.env.PACK_START_DATE as string

// Lambda

export const createPackFunctionName = process.env.CREATE_PACK_FUNCTION_NAME as string

// LLM

export const llmCorpusPromptId = process.env.LLM_CORPUS_PROMPT_ID as string

// Generation claims
//
// Both are TTL windows on a claim, not timeouts on the work. They bound how often the request path
// may hand the same job to the async builder: long enough that a slow run is not duplicated, short
// enough that a crashed run does not block the next attempt for long.

// Sized against CreatePackFunction's 900-second ceiling, so a genuinely slow build is never
// double-started.
export const packGenerationTimeoutMs = parseInt(process.env.PACK_GENERATION_TIMEOUT as string, 10) * 1000

// The corpus claim guards a Bedrock call with thinking enabled, which can run minutes.
export const corpusGenerationTimeoutMs = parseInt(process.env.CORPUS_GENERATION_TIMEOUT as string, 10) * 1000

// Corpus

// How many phrases one nightly call asks for. Fourteen puzzles a day need roughly nine phrases,
// so this is deliberate headroom: the three corpus consumers each skip entries a previous pack
// already used, and the fallback path draws from a corpus that may already be several nights old
// with its best entries spent.
export const corpusPhraseCount = parseInt(process.env.CORPUS_PHRASE_COUNT as string, 10)

// Inspiration seeds seen by the model on every corpus generation. Their job is to knock the model
// out of its default attractor basins -- an unseeded model asked for phrases returns the same
// idioms every night, which matters more here than in connections because one prompt supplies a
// whole night of content for three puzzle types.
export const inspirationAdjectivesCount = parseInt(process.env.INSPIRATION_ADJECTIVES_COUNT as string, 10)
export const inspirationNounsCount = parseInt(process.env.INSPIRATION_NOUNS_COUNT as string, 10)
export const inspirationVerbsCount = parseInt(process.env.INSPIRATION_VERBS_COUNT as string, 10)

// Logging

export const debugLogging = (process.env.DEBUG_LOGGING as string) === 'true'
