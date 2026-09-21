import { CrypticClueData, Difficulty, Puzzle } from '../../types'
import { crypticClueContribution } from './contribution'
import { MAX_EXPLANATION_LENGTH } from './explanation'
import { MAX_GLOSS_LENGTH, MAX_WORD_GLOSS_LENGTH } from './hints'
import { CONNECTIVES, MAX_CLUE_LENGTH, MAX_DEFINITION_TOKENS, MAX_SEAM_TOKENS } from './verify'

// The LARGEST shape this type can emit, every capped string filled to its cap. Read by
// __tests__/unit/services/packs-size.test.ts and by nothing in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// THE SHAPE IS BOUNDED AS A WHOLE, NOT FIELD BY FIELD, which is the trap this file exists to
// avoid: `explanation` and the rungs quote the same definition and cues, so filling every cap at
// once describes a puzzle the verifier cannot emit. Two caps therefore do not bind:
//
//   * MAX_CLUE_LENGTH (120) is unreachable. buildExplanation quotes the definition and every cue
//     inside MAX_EXPLANATION_LENGTH, so with `d` the definition, `C` the summed cue text, `a` the
//     answer length and `n` the part count, d + a + C + 6n + 2 <= 100. Adding the two widest seams
//     and one space per block boundary tops the clue out at 97, and 93 on the shape built below. A
//     clue at 120 is one whose reveal was dropped, and a dropped reveal drops the candidate.
//   * MAX_CRYPTIC_RUNG_LENGTH is a PER-RUNG gate cap and cannot bound an array whose members share
//     a budget. The widest rung this pool composes is 80.
//
// The definition is bounded by the LEXICON, not by the clue: verify step 12b makes every token a
// lexicon word or a connective, and the lexicon is ENABLE filtered to 2-12 letters, so four tokens
// is 51 characters.
//
// The widest ladder is a double definition's, at 184, but compared on the WHOLE payload (clue +
// explanation + ladder + answer) charade wins at 381 against double definition's 380 and
// deletion's 332, which is why charade is the shape built below. The margin is one byte, so a
// one-character widening of `The answer also means ` flips it -- which does not matter against a
// declared pack row of 700 for a shape measuring 640.
//
// The answer's length is neutral: a longer answer costs the reveal exactly what it adds to the
// `answer` field, because the parts concatenate to it. 8 is the top of answers.ts's 4-8 band.

// Not importable: scripts/build-cryptic-words.ts's MAX_LENGTH is the filter that produced
// data/known-words.ts, and importing it would drag a script reading scripts/data/enable.txt into a
// module whose whole job is to import nothing. packs-size.test.ts asserts the two equal.
export const LEXICON_MAX_WORD_LENGTH = 12

// The lexicon's floor, and why a cue token cannot be one character.
const LEXICON_MIN_WORD_LENGTH = 2

// 4 tokens of 12 letters and 3 spaces = 51. Multi-token by construction, because a single-token
// definition drops the definition rung and would quietly select a lighter ladder.
const WORST_CASE_DEFINITION = Array.from({ length: MAX_DEFINITION_TOKENS }, () =>
  'x'.repeat(LEXICON_MAX_WORD_LENGTH),
).join(' ')

// Two parts, the minimum a charade may claim: a third costs the reveal six characters of frame and
// buys the clue nothing (see the d + C bound above). They split an eight-letter answer.
const WORST_CASE_ANSWER = 'A'.repeat(8)
const WORST_CASE_PARTS = [WORST_CASE_ANSWER.slice(0, 4), WORST_CASE_ANSWER.slice(4)]

// buildExplanation's charade arm, spelled out rather than called, because calling it would need a
// VerifiedClue and the spans that go with one.
const explanationOf = (cues: string[]): string =>
  `"${WORST_CASE_DEFINITION}" = ${WORST_CASE_PARTS.map((text, index) => `${text} (${cues[index]})`).join(' + ')}`

// What is left of the reveal once every other term is at its bound; the cue text absorbs it.
// Computed rather than written down, so a change to MAX_EXPLANATION_LENGTH moves the clue with it.
const CUE_BUDGET = MAX_EXPLANATION_LENGTH - explanationOf(['', '']).length

// Tokens of at most LEXICON_MAX_WORD_LENGTH letters, so a cue is a shape step 12 could accept
// rather than one unbroken run no lexicon holds.
const lexicalRun = (length: number): string =>
  Array.from({ length }, (_, index) => ((index + 1) % (LEXICON_MAX_WORD_LENGTH + 1) === 0 ? ' ' : 'x')).join('')

const WORST_CASE_CUES = [lexicalRun(CUE_BUDGET - LEXICON_MIN_WORD_LENGTH), 'x'.repeat(LEXICON_MIN_WORD_LENGTH)]

// The two widest members of the seam alphabet (LEAVES and GIVES, 11 characters), read off
// CONNECTIVES rather than quoted, because that list grows one entry at a time from rejection logs.
const WIDEST_SEAMS = [...CONNECTIVES].sort((left, right) => right.length - left.length).slice(0, MAX_SEAM_TOKENS)

// Definition first, then the wordplay, because verify step 5b puts the definition at one end.
// Five blocks and four separators: 93 characters, against an unreachable MAX_CLUE_LENGTH of 120.
const WORST_CASE_CLUE = [
  WORST_CASE_DEFINITION,
  WORST_CASE_CUES[0],
  WIDEST_SEAMS[0],
  WORST_CASE_CUES[1],
  WIDEST_SEAMS[1],
].join(' ')

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<CrypticClueData> => ({
  data: {
    answer: WORST_CASE_ANSWER,
    clue: WORST_CASE_CLUE,
    enumeration: [WORST_CASE_ANSWER.length],
    explanation: explanationOf(WORST_CASE_CUES),
    hints: [
      { text: 'x'.repeat(MAX_GLOSS_LENGTH) },
      // The framed word gloss: an 18-character frame plus MAX_WORD_GLOSS_LENGTH plus a period = 75.
      { text: `The first part is ${'x'.repeat(MAX_WORD_GLOSS_LENGTH)}.` },
      // The widest third rung this pool can reach. The alternative at this position, the all-parts
      // rung, appears only when a model string dropped, which is a lighter ladder.
      { text: `The first part is ${WORST_CASE_PARTS[0]}.` },
    ],
  },
  difficulty,
  estimatedSeconds:
    crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-10-01:crypticclue:${'f'.repeat(8)}`,
  type: 'crypticclue',
})
