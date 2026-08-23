import { HintLadder } from '../../types'
import { logError } from '../../utils/logging'
import { passesStringGates } from '../../utils/model-output-checks'
import { MAX_CLUE_LENGTH, VerifiedClue } from './verify'

// `The definition is "X".` is 21 characters of frame, so the composed rung cannot exceed
// MAX_CLUE_LENGTH + 21 = 141 -- well inside the foundation's 200-character hint cap. ASSERTED rather
// than assumed, because "cannot bind" is a property of today's constants.
export const MAX_CRYPTIC_RUNG_LENGTH = MAX_CLUE_LENGTH + 21

// A closed five-entry table, matching the 4-8 answer band. A length outside it is UNREACHABLE from
// model output -- verify step 2 round-trips the answer and takes the code-supplied spelling -- so it
// is a CODE DEFECT, and a code-defect gate is a logError-with-reason rejection at runtime and a
// throwing assertion in a test. Never a throw on the nightly path: buildHints runs inside `accept`,
// whose contract is per-item and throw-free, and requestBatch downgrades a throwing accept to a
// per-item rejection anyway -- precisely the "a gate would quietly drop the evidence" outcome a
// throw would have been for.
const INTEGER_WORDS: Record<number, string> = { 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight' }

// DEVICE FIRST, and the reversal is the argument worth keeping: for `hidden`, naming which half is
// the definition hands the solver the WORDPLAY half by elimination, and the wordplay half of a
// hidden clue contains the answer's letters in order. That is nearly the whole solve. Naming the
// device tells the solver the mechanism without telling them where to look. HintLadder order is the
// player's experience with nothing downstream permitted to correct it, so this order is the whole of
// the decision.
const DEVICE_RUNGS: Record<string, string> = {
  anagram: 'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
  hidden:
    "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
}

/**
 * Three code-authored rungs. Device, then the quoted definition, then the enumeration and initial.
 *
 * RUNG 2 QUOTES THE DEFINITION rather than pointing at it, and HintMetadata gains NO MEMBER from
 * this type. The asymmetry: a substring degrades to no highlight, an offset degrades to a WRONG one
 * -- and a wrong highlight on a cryptic clue points the player at the wrong half of the puzzle, a
 * rendering defect in another repo caused by a number this repo shipped. Quoting is safe BECAUSE
 * verify step 4 already proved the span occurs exactly once, which is the same proof a highlight
 * would have relied on, spent on the option whose failure is benign.
 *
 * It quotes a slice OF THE CLUE, never a string the model handed over: there is no second copy of
 * the text for a model to make disagree with the first.
 *
 * NEVER THROWS. Returns undefined with a logged reason instead.
 *
 * ONE KNOWN WEAKNESS, recorded rather than fixed: `enumeration` already ships on `data` and the UI
 * renders it beside the clue, so rung 3 reveals ONE LETTER and repeats something already on screen.
 * That is a thin top rung. The stronger replacement -- rung 3 naming the device's payoff and quoting
 * the fodder -- is deferred until this type clears its probation.
 */
export const buildHints = (verified: VerifiedClue): HintLadder | undefined => {
  const word = INTEGER_WORDS[verified.answer.length]
  if (word === undefined) {
    logError('Cryptic answer outside the shortlist band', {
      answer: verified.answer,
      reason: 'answer-not-on-shortlist',
    })
    return undefined
  }

  const definition = verified.clue.slice(verified.definitionSpan.start, verified.definitionSpan.end)
  const texts = [
    DEVICE_RUNGS[verified.device],
    `The definition is "${definition}".`,
    `${word} letters, beginning with ${verified.answer[0]}.`,
  ]

  // G1/G2/G3/G4 on the COMPOSED rung, through the only exported entry point to those rows. G4 is
  // re-run even though the definition's tokens are a subset of the clue's, because the composition
  // adds tokens of its own. G5 is waived BY ROLE -- `answer` omitted, never passed empty -- and
  // replaced by verify step 11's inflection check over the whole clue. G6 is not requested: a rung
  // is not a string the player types.
  const gated = texts.every((text) => passesStringGates({ maxLength: MAX_CRYPTIC_RUNG_LENGTH, value: text }))
  if (!gated) {
    logError('A cryptic rung failed the string gates', { reason: 'rung-gate', texts })
    return undefined
  }

  return [{ text: texts[0] }, { text: texts[1] }, { text: texts[2] }]
}
