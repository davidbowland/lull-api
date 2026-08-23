import { CrypticClueData, Difficulty, Puzzle } from '../../types'
import { crypticClueContribution } from './contribution'
import { MAX_GLOSS_LENGTH } from './hints'
import { MAX_CLUE_LENGTH } from './verify'

// The LARGEST shape this type can emit, every capped string filled to its cap. Read by
// __tests__/unit/services/packs-size.test.ts and by NOTHING in src/ -- deliberately a leaf module so
// esbuild never pulls a string builder into GetPackByDateFunction's bundle.
//
// DERIVED, not estimated. Every bound is a constant that exists in this repo today:
//
//   * clue MAX_CLUE_LENGTH = 120, the per-field G2 cap in verify.ts.
//   * answer 8 letters -- the top of the 4-8 band answers.ts draws, and enumeration follows from it.
//   * two spans of two integers each, both indexing the clue, so both are bounded by its length.
//   * three rungs. THE LADDER IS BOUNDED AS A WHOLE, not rung by rung, and that is the correction
//     this file's previous version needed: buildHints can now ship BOTH quoting rungs at once, and
//     filling each to MAX_CRYPTIC_RUNG_LENGTH double-counts the clue. The definition and the fodder
//     are DISJOINT TOKEN RANGES of one 120-character string, so their quoted text is bounded
//     TOGETHER, not separately -- and the difference is 145 characters of budget the type does not
//     have.
//
// THE EIGHT REACHABLE LADDERS, since the pool's three drop rules give exactly eight. `d` is the
// definition's length and `f` the fodder's; the clue holds both plus an indicator plus two spaces, so
// d + f <= 117, and where a dropped definition still occupies at least one character, f <= 116. The
// gloss is capped at 80 and quotes nothing, so it shares no budget with the rest.
//
//   gloss device def    80 + 109 + (21 + d)   <=  80 + 109 + 21 + 116 = 326  <-- THE LARGEST
//   gloss device --     80 + 109 + 23         =   212
//   gloss --     def    80 + (21 + d) + 23    <=  80 + 21 + 116 + 23  = 240
//   gloss --     --     80 + 23 + 25          =   128
//   --    device def    109 + (21 + d) + 23   <= 109 + 21 + 116 + 23  = 269
//   --    device --     109 + 23 + 25         =   157
//   --    --     def    (21 + d) + 23 + 25    <=  21 + 116 + 23 + 25  = 185
//   --    --     --     23 + 25 + (25 + f)    <=  23 + 25 + 25 + 116  = 189
//
// So the worst case is the ladder where NOTHING drops -- an 80-character gloss, the longer of the two
// device literals, and a definition rung over 116 characters -- and it is built below.
//
// THE FODDER RUNG APPEARS IN EXACTLY ONE ROW, the all-dropped one, because it now sits BELOW both
// letter rungs: it is the strongest rung in the pool on both devices and a prefix of three can only
// reach it when the three conditional rungs are gone. That is why this figure FELL when the ordering
// was corrected -- the two widest quoting rungs can no longer co-occur at all, so the heaviest shape
// carries one quotation rather than two.
//
// THE GLOSS IS A RUNG AND NOT A DATA FIELD. CrypticClueData gains nothing from it -- the client is
// told what the answer means in a sentence, not handed a field to render its own way -- so it costs
// this shape exactly one rung and no key.
//
// MAX_CRYPTIC_RUNG_LENGTH IS NOT READ HERE ANY MORE, and that is deliberate rather than an
// oversight. It is the PER-RUNG gate cap -- the widest a single composed rung may be before
// buildHints rejects the clue -- and a per-rung cap cannot bound a three-rung array whose members
// quote overlapping budgets. Reaching for it here is what produced a figure 122 bytes over this
// type's row for a shape the verifier cannot emit.
//
// NO METADATA ON ANY RUNG, and that is this type's decision rather than an omission: the quoting
// rungs QUOTE a clue slice instead of pointing at one, so HintMetadata gains no member. A substring
// degrades to no highlight; an offset degrades to a wrong one.

// d + f <= MAX_CLUE_LENGTH - 3: two spaces separate the three parts, and the indicator between them
// is at least one character. The definition takes the rest, since the fodder still holds one.
const MAX_DEFINITION_LENGTH = MAX_CLUE_LENGTH - 4

// A SPACE INSIDE THE DEFINITION'S SLICE, and it is load-bearing rather than decoration: the
// definition rung drops on a single-token definition, so an all-`x` clue would drop it and this
// shape would quietly stop being the heaviest ladder while still measuring something. The space sits
// well inside MAX_DEFINITION_LENGTH so the slice spans it.
const WORST_CASE_CLUE = `${'x'.repeat(57)} ${'x'.repeat(MAX_CLUE_LENGTH - 58)}`

export const worstCasePuzzle = (difficulty: Difficulty): Puzzle<CrypticClueData> => ({
  data: {
    answer: 'A'.repeat(8),
    clue: WORST_CASE_CLUE,
    // MULTI-TOKEN, so the definition rung survives -- which is what selects the heaviest ladder
    // above. It was one token while the fodder rung sat higher in the pool and the heaviest shape
    // was the definition-DROPPED one; the ordering fix inverted that.
    definitionSpan: { end: MAX_DEFINITION_LENGTH, start: 0 },
    // `hidden` rather than `anagram`, and only because its device rung is the longer literal of the
    // two. Nothing else in this shape depends on the device.
    device: 'hidden',
    enumeration: [8],
    fodderSpan: { end: MAX_CLUE_LENGTH, start: MAX_CLUE_LENGTH - 1 },
    hints: [
      { text: 'x'.repeat(MAX_GLOSS_LENGTH) },
      {
        text: "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
      },
      { text: `The definition is "${'x'.repeat(MAX_DEFINITION_LENGTH)}".` },
    ],
  },
  difficulty,
  estimatedSeconds:
    crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
  id: `2026-10-01:crypticclue:${'f'.repeat(8)}`,
  type: 'crypticclue',
})
