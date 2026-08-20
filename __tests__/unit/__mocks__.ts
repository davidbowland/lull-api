/* eslint sort-keys:0 */
import {
  GoFigureData,
  MissingVowelsData,
  Pack,
  Phrase,
  PackDate,
  Prompt,
  PromptConfig,
  PromptId,
  Puzzle,
  ToolSchema,
} from '@types'

export const packDate: PackDate = '2026-06-15'

export const goFigurePuzzle: Puzzle<GoFigureData> = {
  id: '2026-06-15:gofigure:abc123de',
  type: 'gofigure',
  // Matches what the real generator produces for this bank and goal: one operator tuple across
  // six orderings, which difficultyForSolution rates 4. An earlier fixture said difficulty 3 with
  // two solutions -- a shape the code cannot emit, sitting in the shared mock for the canonical
  // example of this type.
  difficulty: 4,
  estimatedSeconds: 150,
  data: {
    goal: 154,
    bank: [6, 9, 7, 7],
    operators: ['+', '-', '*', '/'],
    acceptedSolutions: ['6+7+9*7', '6+9+7*7', '7+6+9*7', '7+9+6*7', '9+6+7*7', '9+7+6*7'],
  },
}

export const pack: Pack = {
  date: packDate,
  complete: true,
  puzzles: [goFigurePuzzle],
}

// Phrases

// The catalog's own worked example, so the fixture and the specification cannot drift apart.
export const phrase: Phrase = {
  text: 'The Empire Strikes Back',
  shape: 'title',
  categorySpecific: 'Star Wars film',
  categoryBroad: 'Film',
}

// Deliberately spans all four shapes and a range of lengths, and is longer than a pack needs so
// selection has something to choose between.
export const phrases: Phrase[] = [
  phrase,
  { text: 'Time flies like an arrow', shape: 'idiom', categorySpecific: 'Saying about time', categoryBroad: 'Saying' },
  { text: 'To be or not to be', shape: 'quote', categorySpecific: 'Hamlet soliloquy', categoryBroad: 'Quote' },
  { text: 'Raiders of the Lost Ark', shape: 'title', categorySpecific: 'Indiana Jones film', categoryBroad: 'Film' },
  { text: 'Pride and Prejudice', shape: 'title', categorySpecific: 'Austen novel', categoryBroad: 'Book' },
  { text: 'Bite the bullet', shape: 'idiom', categorySpecific: 'Saying about courage', categoryBroad: 'Saying' },
]

// Bedrock
//
// Vendored alongside bedrock.ts itself, so lull's own Jest run proves the copy behaves rather than
// trusting that connections-api tested it.

export const invokeModelPhrases = {
  phrases: [
    { categoryBroad: 'Film', categorySpecific: 'Star Wars film', shape: 'title', text: 'The Empire Strikes Back' },
  ],
}

export const invokeModelResponseData = {
  id: 'msg_bdrk_01YA7pmVfUZvZM9reruSimYT',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: [
    {
      type: 'thinking',
      thinking: 'Let me think about the phrases...',
    },
    {
      type: 'tool_use',
      id: 'toolu_bdrk_01YA7pmVfUZvZM9reruSimYT',
      name: 'submit_phrase_corpus',
      input: invokeModelPhrases,
    },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 3_398, output_tokens: 99 },
}

export const invokeModelResponse = {
  $metadata: {
    attempts: 1,
    cfId: undefined,
    extendedRequestId: undefined,
    httpStatusCode: 200,
    requestId: 'fragglerock',
    retryDelay: 0,
    statusCode: 200,
    success: true,
    totalRetryDelay: 0,
  },
  body: new TextEncoder().encode(JSON.stringify(invokeModelResponseData)),
}

export const toolSchema: ToolSchema = {
  name: 'submit_data',
  description: 'Submit the data.',
  input_schema: {
    type: 'object',
    properties: { phrases: { type: 'array' } },
    required: ['phrases'],
  },
}

// Prompts

export const promptConfig: PromptConfig = {
  anthropicVersion: 'bedrock-2023-05-31',
  maxTokens: 32_000,
  model: 'the-thinking-ai:1.0',
  thinkingEffort: 'high',
}

export const promptId: PromptId = '5253'

export const prompt: Prompt = {
  config: promptConfig,
  contents: 'You are a helpful assistant. ${data}',
}

export const missingVowelsPuzzle: Puzzle<MissingVowelsData> = {
  id: '2026-06-15:missingvowels:9f8e7d6c',
  type: 'missingvowels',
  difficulty: 3,
  estimatedSeconds: 90,
  data: {
    category: 'Film',
    displayed: 'THMP RSTR KSBCK',
    answer: 'The Empire Strikes Back',
  },
}
