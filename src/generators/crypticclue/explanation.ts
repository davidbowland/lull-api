/**
 * THE POST-SOLVE REVEAL, composed here and rendered verbatim.
 *
 * It replaces `definitionSpan`, `fodderSpan` and `device` on the wire. Those three drove lull-ui's
 * reveal -- underline the definition, show the wordplay half, name the device -- and none of them
 * survives the synonym devices: CAR is not in the clue, BRANDY is not in the clue, and a double
 * definition has no wordplay half to underline. One string does the job for all three.
 *
 * AND IT MATTERS MORE UNDER THESE DEVICES, NOT LESS. Nobody needed to be told PENGUIN was hidden in
 * `sharpen guinea` -- they could see it, once. Everybody needs to be told CARPET was CAR (vehicle) +
 * PET (animal), because none of that is on the page and no amount of re-reading the clue produces
 * it.
 *
 * THE DEFINITION IS QUOTED FIRST ON THE TWO DEVICES THAT HAVE ONE, AND THAT IS LOAD-BEARING -- DO NOT
 * "SIMPLIFY" THE PREFIX AWAY. The device count is stated in the heading rather than left to the
 * closing sentence because "quoted definition first" reads as universal otherwise, and it is not:
 * `charade` and `deletion` open with it, `doubledefinition` opens with `Two definitions: `.
 * endpoints.rest states that asymmetry and explanation.test.ts's prefix table carries a row for the
 * two devices that take a prefix and deliberately none for the one that does not.
 * The span-driven reveal this replaces emitted `"Dance" is the definition.` for every device,
 * unconditionally. A reveal reading only `CAR (vehicle) + PET (animal)` drops that: a player who
 * solved the clue by guessing still cannot tell WHICH WORDS of the clue defined the answer, which is
 * the one thing a cryptic post-mortem has to teach. Dropping the `<mark>` highlight WAS correct --
 * the client has no spans left and must not go string-searching prose it is contractually told to
 * render verbatim -- but dropping the definition along with the highlight was a regression, and a
 * lull-ui review caught it. A `doubledefinition` takes no prefix because both halves ARE
 * definitions: it already names them, and `"Departed" = "Departed" and "still remaining"` says the
 * same thing twice.
 */
import { RemovalKind } from '../../types'
import { log } from '../../utils/logging'
import { passesStringGates } from '../../utils/model-output-checks'
import { VerifiedClue } from './verify'

/**
 * 100, AND DELIBERATELY NOT THE 80 EVERY RUNG IN THIS REPO IS PINNED TO.
 *
 * The 80 is a RUNG cap -- MAX_GLOSS_LENGTH and lull-ui's two sibling rung caps -- and this is not a
 * rung. It is the whole reveal, and it carries what no rung carries: the quoted definition plus its
 * frame, which on the reference charade (`"Floor covering" = `) is eighteen characters before the
 * decomposition starts. Holding it at 80 would not shorten the reveal; it would DROP good clues
 * whose definition is three words, which is the failure a cap exists to prevent rather than cause.
 *
 * THIS IS NOT A NEW KIND OF NUMBER. MAX_CRYPTOGRAM_RUNG_LENGTH already sits deliberately outside
 * that pin at 99, for the same shape of reason -- a string whose role is not the role the pin was
 * set for. See the note on MAX_GLOSS_LENGTH in hints.ts, which names it.
 *
 * IT IS PAID FOR, not assumed, AND IT WAS PAID IN THE OTHER DIRECTION. The `crypticclue` row in
 * __tests__/unit/services/packs-size.test.ts moves 750 -> 700 in the same branch, and the shape
 * measures 640. The field-by-field sum said 800 -- 744 measured before, minus ~94 for the two spans
 * and `device` coming off the wire, plus ~117 for this field and its key -- and every term of it is
 * right while the conclusion is wrong, because it priced the fields that MOVED and not the fields
 * this one BOUNDS: the reveal quotes the definition and every cue inside its own cap, so it holds the
 * clue at 93 characters and MAX_CLUE_LENGTH stops binding. That test's comment says a branch adding
 * a field "has to move the row deliberately rather than discover it here"; this is that branch, and
 * the derivation lives there.
 */
export const MAX_EXPLANATION_LENGTH = 100

// A TOTAL Record over RemovalKind, so a fourth removal kind is a COMPILE ERROR here rather than an
// `undefined` interpolated into player-visible prose as the string "undefined". Same reason
// deletionIndicators is keyed on the union in indicators.ts: the union is closed in types.ts and
// every table over it is total or it is a bug waiting for a bad night.
const REMOVAL_PHRASE: Record<RemovalKind, string> = {
  first: 'minus its first letter',
  last: 'minus its last letter',
  middle: 'minus its middle letter',
}

// Raw character offsets into the clue, which is what ClueSpan holds. Safe to slice without folding:
// verify.ts step 0 rejects a clue that differs from its own trim and step 1 rejects one outside
// CLUE_CHARSET, so the string these spans were computed against is byte-identical to `clue` here.
// See foldWithOffsets' note for why a normalized offset would not be.
const slice = (clue: string, span: { end: number; start: number }): string => clue.slice(span.start, span.end)

/**
 * Returns the reveal, or undefined when it cannot ship.
 *
 * UNLIKE A GLOSS, UNDEFINED DROPS THE WHOLE CANDIDATE. generator.ts treats it that way, and the
 * asymmetry is the entire reason this is its own module rather than a fifth entry in the hint pool:
 * a puzzle with one fewer hint rung is a slightly meaner puzzle, and a puzzle with no reveal is not
 * shippable -- the player solves it, taps to reveal, and the board has nothing to say. A pool entry
 * that dropped would have backfilled silently, which is the wrong behavior for the one string that
 * cannot be backfilled from anywhere.
 *
 * IT CARRIES MODEL-SUPPLIED TEXT, which is why it is gated at all. A charade's `part.text` and a
 * deletion's `source.text` are the ONLY model strings this type ships that are not slices of the
 * clue, so they never passed CLUE_CHARSET; everything else quoted below is a clue slice and is
 * charset-clean and G4-clean by construction (generator.ts's `accept` runs the clue's own
 * passesStringGates before this ever runs). CLAUDE.md is explicit that a new player-visible string
 * from a model needs a length bound and a content check BEFORE it is added.
 *
 * WHAT THE ONE CALL ACTUALLY RUNS, named the way gatedGloss names its own: passesStringGates is G1
 * typeof and non-empty-after-trim, G2 the cap, G3 no control or format codes, G4 no charged term,
 * G5 the answer leak. All five report as one `explanation-gate` reason, so the logs cannot tell them
 * apart -- worth knowing before reading a count of them as a length problem. Two of the five are
 * live here: G2, because a 120-character clue quoted twice will not fit 100; and G4, because a part
 * text is a lexicon word and the lexicon contains charged terms. G1 and G3 are unreachable -- the
 * composed string always holds a frame, and every input is either a clue slice or a normalizeAnswer
 * output, neither of which can carry a control or format code.
 *
 * G5 IS WAIVED BY ROLE, deliberately and necessarily, by NOT passing `answer`. A charade's parts ARE
 * the answer's letters -- CAR + PET is exactly CARPET -- so the answer-leak gate would reject every
 * charade that reached it, and a deletion's source contains the answer whole. The reveal's entire
 * job is to give the answer away AFTER the player has solved it. This is the same waiver buildHints
 * applies to every rung that quotes the clue, and the exact one gatedGloss deliberately REVERSES:
 * a gloss is shown BEFORE the solve, so naming the answer there is the failure. Same helper, same
 * repo, opposite polarity, decided by the string's role rather than by its puzzle type.
 */
export const buildExplanation = (verified: VerifiedClue): string | undefined => {
  const { clue } = verified

  // NARROWED WITH EARLY RETURNS AND NO DEFAULT ARM, which is what makes a fourth device a compile
  // error at this site rather than a silently mis-rendered reveal. Add one to CrypticDevice and the
  // trailing expression narrows to `VerifiedDoubleDefinition | VerifiedTheNewThing`, whose union has
  // no `definitionSpans` -- the compiler names this function. verify.ts's own result block is
  // written the same way for the same reason.
  const text =
    verified.device === 'charade'
      ? `"${slice(clue, verified.definitionSpan)}" = ${verified.parts
          .map((part) => `${part.text} (${slice(clue, part.cueSpan)})`)
          .join(' + ')}`
      : verified.device === 'deletion'
        ? `"${slice(clue, verified.definitionSpan)}" = ${verified.source.text} (${slice(
            clue,
            verified.source.cueSpan,
          )}) ${REMOVAL_PHRASE[verified.removal]}`
        : `Two definitions: "${slice(clue, verified.definitionSpans[0])}" and "${slice(clue, verified.definitionSpans[1])}"`

  if (!passesStringGates({ maxLength: MAX_EXPLANATION_LENGTH, value: text })) {
    // A `log`, not a logError, even though this one costs the candidate. verify.ts's own per-clue
    // rejections log at exactly this level and this is one more of them: a gate working on model
    // output is an EXPECTED outcome on the nightly path, not a fault a person has to act on. The
    // pack is incomplete, the next GET refills it, and the reason travels so the prompt can be tuned
    // by reading which gate fires -- the same operation the indicator list grows by.
    log('Dropped a cryptic explanation', {
      answer: verified.answer,
      length: text.length,
      reason: 'explanation-gate',
      type: 'crypticclue',
    })
    return undefined
  }
  return text
}
