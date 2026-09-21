/* eslint sort-keys:0 */
import {
  CryptogramData,
  GoFigureData,
  MissingVowelsData,
  Pack,
  Phrase,
  PhrazleData,
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
  // From a real enumerateSolutions run: one operator tuple across two orderings, rated 5.
  difficulty: 5,
  estimatedSeconds: 180,
  data: {
    goal: 68,
    bank: [6, 9, 7, 7],
    operators: ['+', '-', '*', '/'],
    acceptedSolutions: ['6*9+7+7', '9*6+7+7'],
    // Both accepted solutions are *++ with the factors swapped, so this is a one-tuple puzzle and
    // the copy is unhedged. The glyph in rung 2 is an escape, never pasted: U+00D7 is one
    // indistinguishable keystroke from the letter x.
    //
    // hints.test.ts is the only thing checking this ladder, because tsconfig.json excludes
    // __tests__/ and the annotation above is unchecked at CI.
    hints: [
      {
        metadata: { kind: 'gofigure-operator', operator: '+', slot: 1 },
        text: 'The 2nd operator from the left is "+".',
      },
      {
        metadata: { kind: 'gofigure-operator', operator: '*', slot: 0 },
        text: 'The 1st operator from the left is "\u00D7".',
      },
      {
        metadata: { kind: 'gofigure-operator', operator: '+', slot: 2 },
        text: 'The 3rd operator from the left is "+".',
      },
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

// All four shapes and a range of lengths, longer than a pack needs so selection has a choice.
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

// Bedrock: real response envelopes, not hand-shaped stubs. bedrock.ts parses and ajv-validates
// what the model returns, so a fixture tidied into the parser's shape proves nothing.

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
  // thinking_tokens separates "a long answer" from "the model spent the night reasoning".
  usage: { input_tokens: 3_398, output_tokens: 99, output_tokens_details: { thinking_tokens: 61 } },
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
  // Difficulty 2, and the category below is why: CATEGORY_HIDDEN_BY_DIFFICULTY hides it at 3 and
  // 5, so a difficulty-3 puzzle carrying a category is a shape no generator emits.
  difficulty: 2,
  estimatedSeconds: 75,
  data: {
    category: 'Film',
    displayed: 'THMP RSTR KSBCK',
    answer: 'The Empire Strikes Back',
    // The wire shape -- three { text } rungs -- not the three bare strings a Phrase carries.
    // hints.test.ts pins it to the shared `phrase` fixture, because the annotation above is
    // checked by nothing at CI time.
    hints: [
      { text: 'A space opera sequel' },
      { text: 'The middle chapter, where the heroes lose' },
      { text: 'The one where a lightsaber duel ends with a revelation about parentage' },
    ],
  },
}

// A real derangement, not a hand-typed string: the ciphertext came out of derange() and
// round-trips under its inverse. Difficulty 3 hides the category, so this carries none.
export const cryptogramPuzzle: Puzzle<CryptogramData> = {
  id: '2026-06-15:cryptogram:7c6b5a49',
  type: 'cryptogram',
  difficulty: 3,
  estimatedSeconds: 240,
  data: {
    ciphertext: 'JBT TSXZGT FJGZNTF EDRN',
    answer: 'The Empire Strikes Back',
    // No `hints`, and the absence is the assertion: the rungs are built on the device, in lull-ui
    // at src/components/cryptogram/rungs.ts. A ladder here would typecheck against nothing.
  },
}

// The only fixture clearing Phrazle's structural floor: two or three words, three to seven letters
// each. Both its words are in __tests__/fixtures/v1.txt, which silently rejects a phrase whose
// words it lacks.
export const compactPhrase: Phrase = {
  category: 'Saying',
  familiarity: 3,
  hints: ['A grip on something steep', 'What a climber finds with a boot', 'A small purchase you can push off from'],
  shape: 'compact',
  text: 'Toe hold',
}

// `answer` is the canonical form -- uppercase A-Z, single spaces -- and the only phrase-type answer
// that is not the corpus text verbatim, because the board paints these characters as tiles. There
// is no `wordLengths` field: two fields that can disagree is a board with the wrong tile count.
export const phrazlePuzzle: Puzzle<PhrazleData> = {
  id: '2026-06-15:phrazle:3f2e1d09',
  type: 'phrazle',
  difficulty: 3,
  estimatedSeconds: 240,
  data: {
    answer: 'TOE HOLD',
    // No `hints`: the rungs are chosen against the player's guesses, in lull-ui at
    // src/components/phrazle/rungs.ts. One field here and two on the type, because
    // CATEGORY_HIDDEN_BY_DIFFICULTY hides the category at this band.
  },
}
