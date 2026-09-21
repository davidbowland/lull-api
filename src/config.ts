// DynamoDB

export const dynamodbPacksTableName = process.env.DYNAMODB_PACKS_TABLE_NAME as string
export const dynamodbPromptsTableName = process.env.DYNAMODB_PROMPTS_TABLE_NAME as string

// Packs

export const packStartDate = process.env.PACK_START_DATE as string

// Lambda

export const createPhrasePuzzlesFunctionName = process.env.CREATE_PHRASE_PUZZLES_FUNCTION_NAME as string
export const createModelPuzzlesFunctionName = process.env.CREATE_MODEL_PUZZLES_FUNCTION_NAME as string
export const createPackFunctionName = process.env.CREATE_PACK_FUNCTION_NAME as string

// LLM

export const llmAnagramPromptId = process.env.LLM_ANAGRAM_PROMPT_ID as string
export const llmCrypticPromptId = process.env.LLM_CRYPTIC_PROMPT_ID as string
// The only check in the repo on whether a clue's definition means its answer. Its absence is a
// logError and an unreviewed batch, never a thrown build -- see generators/crypticclue/review.ts.
export const llmCrypticReviewPromptId = process.env.LLM_CRYPTIC_REVIEW_PROMPT_ID as string
export const llmPhrasePromptId = process.env.LLM_PHRASE_PROMPT_ID as string
export const llmReviewPromptId = process.env.LLM_REVIEW_PROMPT_ID as string

// Generation claims

// A TTL window on a claim, not a timeout on the work: it bounds how often the request path may
// hand the same job to the async builder. Sized against the builder's 900-second ceiling, so a
// genuinely slow build is never double-started and a crashed one does not block the next attempt
// for long.
export const packGenerationTimeoutMs = parseInt(process.env.PACK_GENERATION_TIMEOUT as string, 10) * 1000

// Phrases

// How many days of recent packs to read for the "already used" list handed to the model. Bounded
// on purpose: it is a BatchGetItem over that many known keys, so cost does not grow with the
// archive.
export const phraseHistoryDays = parseInt(process.env.PHRASE_HISTORY_DAYS as string, 10)

// Inspiration seeds seen by the model on every phrase generation. They knock the model out of its
// default attractor basins: an unseeded model asked for phrases returns the same idioms every
// night, and one prompt supplies a whole night of content for three puzzle types.
export const inspirationAdjectivesCount = parseInt(process.env.INSPIRATION_ADJECTIVES_COUNT as string, 10)
export const inspirationNounsCount = parseInt(process.env.INSPIRATION_NOUNS_COUNT as string, 10)
export const inspirationVerbsCount = parseInt(process.env.INSPIRATION_VERBS_COUNT as string, 10)

// Phrazle

// The directory the guess dictionary lives in, not a file: a two-version overlap ships two lists,
// and the version segment is appended only after it has been checked against DICTIONARY_VERSIONS,
// so no unvalidated string ever reaches a path.
//
// Unset in GetPackByDateFunction, which never calls the loader. Every value here is an unchecked
// cast and this module throws on nothing, so a missing variable stays a no-op; adding a throw
// would break that function.
export const dictionaryPath = process.env.DICTIONARY_PATH as string

// Logging

export const debugLogging = (process.env.DEBUG_LOGGING as string) === 'true'
