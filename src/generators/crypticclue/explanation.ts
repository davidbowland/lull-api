/**
 * The post-solve reveal, composed here and rendered verbatim. No spans ship, so the client cannot
 * build one: CAR is not in the clue, BRANDY is not in the clue, and a double definition has no
 * wordplay half to underline.
 *
 * `charade` and `deletion` QUOTE THE DEFINITION FIRST -- do not "simplify" that prefix away. Without
 * it a player who guessed the answer still cannot tell which clue words defined it, which is the one
 * thing a cryptic post-mortem has to teach. `doubledefinition` takes no prefix because both halves
 * are definitions and it already names them. endpoints.rest states the asymmetry and
 * explanation.test.ts's prefix table carries a row per prefixed device.
 */
import { RemovalKind } from '../../types'
import { log } from '../../utils/logging'
import { passesStringGates } from '../../utils/model-output-checks'
import { VerifiedClue } from './verify'

// 100, deliberately not the 80 every rung is pinned to. This is not a rung: it is the whole
// reveal, carrying the quoted definition plus its frame (18 characters on the reference charade)
// before the decomposition starts, so at 80 it would drop good clues with a three-word definition.
// The pack-row budget is derived in packs-size.test.ts, whose row is 700 for a shape measuring 640.
export const MAX_EXPLANATION_LENGTH = 100

// Total over RemovalKind, so a fourth kind is a compile error here rather than the string
// "undefined" interpolated into player-visible prose.
const REMOVAL_PHRASE: Record<RemovalKind, string> = {
  first: 'minus its first letter',
  last: 'minus its last letter',
  middle: 'minus its middle letter',
}

// Safe to slice without folding: verify.ts's step 0 trim equality and step 1 charset make the
// string these spans were computed against byte-identical to `clue` here.
const slice = (clue: string, span: { end: number; start: number }): string => clue.slice(span.start, span.end)

/**
 * Returns the reveal, or undefined when it cannot ship.
 *
 * Unlike a gloss, undefined drops the WHOLE CANDIDATE, and that asymmetry is why this is its own
 * module rather than a fifth entry in the hint pool: a dropped pool entry backfills silently, and
 * the reveal is the one string that cannot be backfilled from anywhere.
 *
 * It is gated because a charade's `part.text` and a deletion's `source.text` are the only model
 * strings this type ships that are not clue slices, so they never faced CLUE_CHARSET. Two of
 * passesStringGates' rows are live: G2, because a long clue quoted twice will not fit 100, and G4,
 * because a part text is a lexicon word. All five report as one `explanation-gate` reason.
 *
 * G5 is waived BY ROLE, by not passing `answer`: a charade's parts ARE the answer's letters, and
 * the reveal's job is to give the answer away after the solve. gatedGloss reverses this waiver.
 */
export const buildExplanation = (verified: VerifiedClue): string | undefined => {
  const { clue } = verified

  // No default arm, so a fourth device is a compile error here rather than a mis-rendered reveal:
  // the trailing expression would narrow to a union with no `definitionSpans`.
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
    // A `log`, not a logError, even though this costs the candidate: a gate working on model output
    // is an expected nightly outcome, and the next GET refills the pack. The reason travels so the
    // prompt can be tuned by reading which gate fires.
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
