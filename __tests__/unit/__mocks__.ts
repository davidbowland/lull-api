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
  // Matches what the real generator produces for this bank and goal: one operator tuple across two
  // orderings, which difficultyForSolution rates 5. An earlier fixture said difficulty 3 with two
  // solutions -- a shape the code cannot emit, sitting in the shared mock for the canonical example
  // of this type -- and the one before this said difficulty 4, which the code CAN emit but a pack
  // no longer asks for: the pack-wide count table moved goFigure to [1, 3, 5]. Same bank, a
  // different goal off it, taken from a real enumerateSolutions run rather than typed by hand.
  difficulty: 5,
  estimatedSeconds: 180,
  data: {
    goal: 68,
    bank: [6, 9, 7, 7],
    operators: ['+', '-', '*', '/'],
    acceptedSolutions: ['6*9+7+7', '9*6+7+7'],
    // The worked example. Both accepted solutions above are *++ with the two factors swapped, so
    // this is a ONE-TUPLE puzzle: the slots come out 1, 0, 2 and the copy is unhedged, because
    // there is no alternative arrangement for a rung to hedge against.
    //
    // The glyph in rung 2 is written as an escape, never pasted: U+00D7 MULTIPLICATION SIGN is one
    // indistinguishable keystroke from the letter x and a diff cannot tell them apart.
    //
    // hints.test.ts asserts this ladder equals buildHints(acceptedSolutions). Nothing else would:
    // tsconfig.json excludes __tests__/, so the Puzzle<GoFigureData> annotation above is not checked
    // at CI time, and junk in here would otherwise pass the whole suite -- watched go red on this
    // very edit, when the goal moved to 68 and the ladder had not yet followed.
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
// Real response envelopes, not hand-shaped stubs. bedrock.ts parses and ajv-validates what the model
// returns, so a fixture that has been tidied into the shape the parser expects proves nothing about
// the shape it actually receives.

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
  // output_tokens_details.thinking_tokens is what Bedrock actually returns and is the only field
  // that separates "the model wrote a long answer" from "the model spent the night reasoning". The
  // fixture carries it because the max_tokens incident is invisible without it: output_tokens 32000
  // is the same number either way.
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
  // Difficulty 2, NOT 3, and the category below is why. CATEGORY_HIDDEN_BY_DIFFICULTY hides the
  // category at 3 and 5 (generators/category-visibility.ts:16), so a difficulty-3 Missing Vowels
  // puzzle carrying `category: 'Film'` is a shape the generator cannot emit -- and this fixture is
  // what audit-hints.test.ts uses as its CATEGORY SHOWN row, a bucket that puzzle would never be in.
  // estimatedSeconds follows: 60 + 15 * (2 - 1).
  difficulty: 2,
  estimatedSeconds: 75,
  data: {
    category: 'Film',
    displayed: 'THMP RSTR KSBCK',
    answer: 'The Empire Strikes Back',
    // The WIRE shape -- three { text } rungs, matching goFigure -- not the three bare strings a
    // Phrase carries. Missing Vowels is the ONE generator left that wraps through toHintLadder --
    // cryptogram was the other caller and it ships no ladder now -- and
    // __tests__/unit/utils/hints.test.ts pins this ladder to the shared `phrase` fixture, because
    // tsconfig.json excludes __tests__/ and the annotation above is checked by nothing at CI time.
    hints: [
      { text: 'A space opera sequel' },
      { text: 'The middle chapter, where the heroes lose' },
      { text: 'The one where a lightsaber duel ends with a revelation about parentage' },
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
    // NO `hints`, and the shape is the assertion. This type drew the shared prose ladder off the
    // phrase and dropped it at construction: the rungs describe what the phrase MEANS, and a
    // cryptogram is solved one substitution at a time. Its hints are chosen on the device, by the
    // builder at src/rules/hint-cryptogram.ts -- exercised from __tests__/unit/rules/ and imported
    // by nothing here -- against a mapping the player has built.
    // A fixture that carried a ladder anyway would typecheck by nothing -- tsconfig.json excludes
    // __tests__/ -- and would quietly teach every reader of this file the wrong wire shape.
  },
}

// A COMPACT phrase, and the only fixture here that clears Phrazle's structural floor: two or three
// words, three to seven letters each, eighteen or fewer in total. Every other `phrase` fixture above
// is a title or a quote of four or more words, so without this one nothing in the shared mocks
// reaches a Phrazle board at all.
//
// TOE HOLD is one of the prompt's own worked compact examples, and both its words are in
// __tests__/fixtures/v1.txt -- which is the half a reader cannot check from this file, and the half
// that silently rejects a fixture phrase if it is missing.
export const compactPhrase: Phrase = {
  category: 'Saying',
  familiarity: 3,
  hints: ['A grip on something steep', 'What a climber finds with a boot', 'A small purchase you can push off from'],
  shape: 'compact',
  text: 'Toe hold',
}

// `answer` is the CANONICAL form -- uppercase A-Z words separated by single spaces -- and is the only
// phrase-type answer that is not the corpus text verbatim. The board paints these characters as
// tiles, so the answer must be the characters markGuess marks.
//
// Difficulty 3 hides the category, and so does 5, so this type ships none on either of its declared
// bands. There is no `wordLengths` field and there will not be: the grid is
// answer.split(' ').map((word) => word.length), and two fields that can disagree is a board with the
// wrong number of tiles.
export const phrazlePuzzle: Puzzle<PhrazleData> = {
  id: '2026-06-15:phrazle:3f2e1d09',
  type: 'phrazle',
  difficulty: 3,
  estimatedSeconds: 240,
  data: {
    answer: 'TOE HOLD',
    // NO `hints`, and this fixture used to carry the largest field of the three. It held three
    // code-built positional reveals -- `Letter 1 of word 1 is T.` -- which were letter-shaped and
    // BLIND: rung k named the first still-unrevealed position of word `k mod wordCount` whatever the
    // player's guesses had already colored in. The device chooses against the guesses instead, from
    // the builder at src/rules/hint-phrazle.ts -- exercised from __tests__/unit/rules/ and imported
    // by nothing here.
    //
    // ONE FIELD ON THIS FIXTURE, TWO ON THE TYPE, and the difference is the band rather than the
    // shape. PhrazleData is `answer` plus an optional `category`, both inherited from
    // PhrasePuzzleData -- which is what types.ts means by "TWO fields, both of them inherited". This
    // fixture is difficulty 3, CATEGORY_HIDDEN_BY_DIFFICULTY hides at 3 and 5, and an omitted key
    // disappears from the payload -- so what a board reads HERE is `answer` alone. A band-2 phrazle
    // carries both.
  },
}
