import { CrypticClueData, Difficulty, Puzzle } from '../../types'
import { crypticClueContribution } from './contribution'
import { MAX_EXPLANATION_LENGTH } from './explanation'
import { MAX_GLOSS_LENGTH } from './hints'
import { CONNECTIVES, MAX_CLUE_LENGTH, MAX_DEFINITION_TOKENS, MAX_SEAM_TOKENS } from './verify'

// The LARGEST shape this type can emit, every capped string filled to its cap. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound below is a constant that exists in this repo today, and the
// one that is not importable is pinned by an assertion in packs-size.test.ts.
//
// THE SUBTLETY THIS FILE EXISTS TO GET RIGHT, and it survived the device change intact: THE SHAPE IS
// BOUNDED AS A WHOLE, NOT FIELD BY FIELD. The previous version records what filling every cap at
// once cost -- a figure 122 bytes over this type's row for a ladder the verifier cannot emit,
// because two rungs quoting disjoint slices of one 120-character clue were each filled to the
// per-rung cap. The devices changed and the trap did not: `explanation` and the definition rung now
// quote THE SAME definition, and `explanation` quotes every cue the clue carries as well. So the
// reveal's cap reaches back through the clue.
//
// TWO CAPS THEREFORE DO NOT BIND, and saying which is the point:
//
//   * MAX_CLUE_LENGTH (120) IS UNREACHABLE. A charade's clue is its definition, its cue ranges and
//     at most MAX_SEAM_TOKENS connectives -- verify step 6's cover, which admits nothing else -- and
//     buildExplanation quotes the definition AND every cue inside MAX_EXPLANATION_LENGTH. Writing
//     `d` for the definition, `C` for the summed cue text, `a` for the answer's length and `n` for
//     the number of parts, the reveal is `d + a + C + 6n + 2 <= 100`, so d + C <= 98 - a - 6n. The
//     clue adds the two widest seams (11) and one space per block boundary (n + 2), which tops out
//     at 111 - a - 5n = 97 characters on the gentlest legal shape and 93 on the one built below. A
//     clue at 120 is a clue whose reveal was dropped, and a dropped reveal drops the candidate.
//   * MAX_CRYPTIC_RUNG_LENGTH (145) IS NOT READ HERE, for the reason its own comment gives: it is a
//     PER-RUNG gate cap and cannot bound an array whose members share a budget. The widest rung this
//     pool can compose is 80 characters wide.
//
// THE DEFINITION IS BOUNDED BY THE LEXICON, NOT BY THE CLUE, and that is the single largest
// correction to the previous figure. It used MAX_CLUE_LENGTH - 4 = 116, which was true when nothing
// checked a definition's words. Verify step 12b is UN-STRUCK: every definition token is a lexicon
// word or a connective, and the lexicon is ENABLE filtered to 2-12 letters. Four tokens of twelve
// letters and three spaces is 51 characters, and 51 is less than half of 116.
//
// THE TEN REACHABLE LADDERS, which is what buildHints' three per-device pools give -- four shapes on
// charade, four on deletion, two on double definition, one per gloss-survives x definition-rung-
// survives combination the device admits. Rung widths, each derived from a constant rather than
// measured off a literal: gloss <= MAX_GLOSS_LENGTH (80); charade device sentence 72; double
// definition device sentence 64; definition rung 21 + d <= 72; first part 18 + t + 1 <= 25, since
// two parts of at least two letters split an answer of at most eight; all parts 14 + a + 3(n - 1)
// + 1 <= 32 at four two-letter parts; source 25 + (a + 1) + 1 <= 35; letter rung 25.
//
//   charade  gloss + device + definition   80 + 72 + 72   = 224  <-- THE LARGEST LADDER
//   charade  gloss + device + first        80 + 72 + 25   = 177
//   charade  device + definition + first   72 + 72 + 25   = 169
//   charade  device + first + all          72 + 25 + 32   = 129
//   deletion gloss + definition + letter   80 + 72 + 25   = 177
//   deletion gloss + letter + source       80 + 25 + 35   = 140
//   deletion definition + letter + source  72 + 25 + 35   = 132
//   deletion letter + source               25 + 35        =  60
//   double   gloss + device + letter       80 + 64 + 25   = 169
//   double   device + letter               64 + 25        =  89
//
// THE HEAVIEST LADDER IS NOT AUTOMATICALLY THE HEAVIEST PUZZLE, so the three devices are compared on
// the WHOLE payload -- clue + explanation + ladder + answer -- with the reveal at its cap in each:
//
//   charade   93 + 100 + 224 + 8 = 425   <-- built below
//   deletion  d + ind - p + 331, worst 51 + 15 - 21 + 331 = 376
//   double    88 + 100 + 169 + 8 = 365
//
// Deletion buys clue length its reveal does not pay for -- the indicator is a declared range and the
// reveal does not quote it -- but the widest committed indicator is `without a heart` at 15, and it
// pays for that twice over in a ladder with no device rung and a removal phrase inside the reveal.
// A double definition spends its whole reveal budget on two definitions and ships the narrower
// device sentence. Charade wins on both halves at once: the only device whose full ladder holds two
// wide rungs AND a definition rung.
//
// THE ANSWER'S LENGTH IS NEUTRAL, which is worth stating because 8 looks like a choice. A longer
// answer costs the reveal exactly what it adds to the `answer` field -- the parts concatenate to it
// -- so it buys the clue four fewer characters for four more of its own. 8 is the top of the 4-8
// shortlist band answers.ts draws, and the enumeration is one digit either way.
//
// THE GLOSS IS A RUNG AND NOT A DATA FIELD. CrypticClueData gains nothing from it -- the client is
// told what the answer means in a sentence, not handed a field to render its own way -- so it costs
// this shape exactly one rung and no key.
//
// NO METADATA ON ANY RUNG, and that is this type's decision rather than an omission: the quoting
// rung QUOTES a clue slice instead of pointing at one, so HintMetadata gains no member. A substring
// degrades to no highlight; an offset degrades to a wrong one.

// THE ONE BOUND HERE THAT IS NOT IMPORTABLE. scripts/build-cryptic-words.ts's MAX_LENGTH is the
// filter that produced data/known-words.ts, and importing it would drag a script that reads
// scripts/data/enable.txt into a module whose whole job is to import nothing. packs-size.test.ts
// asserts the two equal, which is what makes this a copy rather than a guess.
export const LEXICON_MAX_WORD_LENGTH = 12

// The lexicon's floor, and it is why a cue cannot be one character: the same step 12 that caps a cue
// token at twelve letters refuses a one-letter one.
const LEXICON_MIN_WORD_LENGTH = 2

// 4 tokens of 12 letters and 3 spaces = 51. MULTI-TOKEN BY CONSTRUCTION, which is load-bearing
// rather than decoration: the definition rung drops on a single-token definition, and dropping it
// would quietly select a lighter ladder while this file went on measuring something.
const WORST_CASE_DEFINITION = Array.from({ length: MAX_DEFINITION_TOKENS }, () =>
  'x'.repeat(LEXICON_MAX_WORD_LENGTH),
).join(' ')

// TWO PARTS, the minimum a charade may claim, because a third part costs the reveal six characters
// of frame and buys the clue nothing -- see the d + C bound above. They split an eight-letter answer,
// so each is a four-letter lexicon word by the same letter math verify step 10 proves.
const WORST_CASE_ANSWER = 'A'.repeat(8)
const WORST_CASE_PARTS = [WORST_CASE_ANSWER.slice(0, 4), WORST_CASE_ANSWER.slice(4)]

// buildExplanation's charade arm, spelled out here rather than called, because calling it would need
// a VerifiedClue and the spans that go with one. The frame is `"<definition>" = <part> (<cue>)` per
// part, joined with ` + `.
const explanationOf = (cues: string[]): string =>
  `"${WORST_CASE_DEFINITION}" = ${WORST_CASE_PARTS.map((text, index) => `${text} (${cues[index]})`).join(' + ')}`

// WHAT IS LEFT OF THE REVEAL ONCE EVERY OTHER TERM IS AT ITS BOUND, and the cue text is what absorbs
// it. Computed rather than written down, so a change to MAX_EXPLANATION_LENGTH or to the definition
// bound moves the clue with it instead of leaving this shape a byte-count that used to be true.
const CUE_BUDGET = MAX_EXPLANATION_LENGTH - explanationOf(['', '']).length

// Tokens of at most LEXICON_MAX_WORD_LENGTH letters separated by single spaces, so a cue is a shape
// step 12 could accept rather than one unbroken run no lexicon holds. The second cue takes the
// lexicon's minimum and the first takes the rest.
const lexicalRun = (length: number): string =>
  Array.from({ length }, (_, index) => ((index + 1) % (LEXICON_MAX_WORD_LENGTH + 1) === 0 ? ' ' : 'x')).join('')

const WORST_CASE_CUES = [lexicalRun(CUE_BUDGET - LEXICON_MIN_WORD_LENGTH), 'x'.repeat(LEXICON_MIN_WORD_LENGTH)]

// THE TWO WIDEST MEMBERS OF THE COMMITTED SEAM ALPHABET -- LEAVES and GIVES, 11 characters between
// them -- read off CONNECTIVES rather than quoted, because the list grows one entry at a time from
// rejection logs and a quoted pair would stop being the widest without anything saying so.
// MAX_SEAM_TOKENS is the count, and it is a TOTAL over the clue rather than a per-seam allowance.
const WIDEST_SEAMS = [...CONNECTIVES].sort((left, right) => right.length - left.length).slice(0, MAX_SEAM_TOKENS)

// Definition first, then the wordplay, because verify step 5b puts the definition at one end. Five
// blocks and four separators: 51 + 25 + 6 + 2 + 5 + 4 = 93, against a MAX_CLUE_LENGTH of 120 that
// this type can no longer reach.
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
      // DEVICE_RUNGS.charade, quoted because that table is module-private to hints.ts and exporting
      // it to be measured would widen a builder's surface for a test's convenience. It is the longer
      // of the two device sentences, and charade is the heavier device on every other term as well.
      { text: 'The answer is built from two or more shorter words, one after the other.' },
      { text: `The definition is "${WORST_CASE_DEFINITION}".` },
    ],
  },
  difficulty,
  estimatedSeconds:
    crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-10-01:crypticclue:${'f'.repeat(8)}`,
  type: 'crypticclue',
})
