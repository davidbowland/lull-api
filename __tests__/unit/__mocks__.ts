/* eslint sort-keys:0 */
import {
  CryptogramData,
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
    // The design's difficulty-4 worked example. One tuple (++*), so the wording is unhedged, and the
    // slots come out 1, 0, 2. U+00D7 MULTIPLICATION SIGN is written as an escape rather than pasted,
    // because it and the letter x are indistinguishable in a diff -- which is also why this comment
    // names it by code point instead of showing it.
    //
    // hints.test.ts asserts this ladder equals buildHints(acceptedSolutions, 4). Nothing else would:
    // tsconfig.json excludes __tests__/, so the Puzzle<GoFigureData> annotation above is not checked
    // at CI time, and junk in here would otherwise pass the whole suite.
    hints: [
      { kind: 'operator', operator: '+', slot: 1, text: 'The 2nd operator from the left is "+".' },
      { kind: 'operator', operator: '+', slot: 0, text: 'The 1st operator from the left is "+".' },
      { kind: 'operator', operator: '*', slot: 2, text: 'The 3rd operator from the left is "\u00D7".' },
    ],
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
  category: 'Film',
  hints: [
    'A space opera sequel',
    'The middle chapter, where the heroes lose',
    'The one where a lightsaber duel ends with a revelation about parentage',
  ],
  familiarity: 4,
}

// Deliberately spans all four shapes and a range of lengths, and is longer than a pack needs so
// selection has something to choose between.
export const phrases: Phrase[] = [
  phrase,
  {
    text: 'Time flies like an arrow',
    shape: 'idiom',
    category: 'Saying',
    hints: [
      'A saying about how fast life goes',
      'What people notice on a birthday',
      'A pun beloved of computer scientists',
    ],
    familiarity: 3,
  },
  {
    text: 'To be or not to be',
    shape: 'quote',
    category: 'Quote',
    hints: [
      'A line from a tragedy',
      'A prince weighs whether to go on living',
      'The opening of the most famous soliloquy in English',
    ],
    familiarity: 5,
  },
  {
    text: 'Raiders of the Lost Ark',
    shape: 'title',
    category: 'Film',
    hints: ['An adventure film', 'An archaeologist races Nazis for a relic', 'The first Indiana Jones picture'],
    familiarity: 4,
  },
  {
    text: 'Pride and Prejudice',
    shape: 'title',
    category: 'Book',
    hints: [
      'A Regency novel',
      'Five sisters, one wealthy newcomer, and a bad first impression',
      'Jane Austen on Mr Darcy',
    ],
    familiarity: 4,
  },
  {
    text: 'Bite the bullet',
    shape: 'idiom',
    category: 'Saying',
    hints: [
      'A saying about endurance',
      'What surgery before anaesthetic asked of a patient',
      'Bracing yourself and getting the awful thing over with',
    ],
    familiarity: 4,
  },
]

// One verdict per phrase in `phrases`, all keeps. Individual tests override single entries.
export const verdicts = phrases.map((_phrase, index) => ({
  familiarity: 4,
  index,
  reason: 'Recognizable, ladder climbs cleanly.',
  verdict: 'keep',
}))

// Bedrock
//
// Vendored alongside bedrock.ts itself, so lull's own Jest run proves the copy behaves rather than
// trusting that connections-api tested it.

export const invokeModelPhrases = {
  phrases: [
    {
      category: 'Film',
      hints: [
        'A space opera sequel',
        'The middle chapter, where the heroes lose',
        'The one where a lightsaber duel ends with a revelation about parentage',
      ],
      shape: 'title',
      text: 'The Empire Strikes Back',
    },
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
      name: 'submit_phrases',
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
    hints: [
      'A space opera sequel',
      'The middle chapter, where the heroes lose',
      'The one where a lightsaber duel ends with a revelation about parentage',
    ],
  },
}

// Cryptogram
//
// A real derangement of the answer, not a hand-typed string: JBT TSXZGT FJGZNTF EDRN was produced
// by derange() and checked to round-trip under its inverse, to preserve every space, and to leave
// no letter standing on itself. A fixture whose ciphertext did not decipher would teach the wrong
// shape of the type to every test that reads it.
//
// Difficulty 3 hides the category, so this fixture carries none -- the canonical example of the
// type is the one the shelf's hardest-to-render case produces.
export const cryptogramPuzzle: Puzzle<CryptogramData> = {
  id: '2026-06-15:cryptogram:7c6b5a49',
  type: 'cryptogram',
  difficulty: 3,
  estimatedSeconds: 240,
  data: {
    ciphertext: 'JBT TSXZGT FJGZNTF EDRN',
    answer: 'The Empire Strikes Back',
    hints: [
      'A space opera sequel',
      'The middle chapter, where the heroes lose',
      'The one where a lightsaber duel ends with a revelation about parentage',
    ],
  },
}
