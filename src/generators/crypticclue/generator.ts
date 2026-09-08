import { randomBytes } from 'node:crypto'

import { llmCrypticPromptId } from '../../config'
import { normalizeAnswer } from '../../rules/normalize-answer'
import { requestBatch } from '../../services/model-batch'
import { Candidate, CrypticClueData, Difficulty, ModelGenerator, PackDate, Puzzle, ToolSchema } from '../../types'
import { recentCrypticAnswers } from '../../utils/exclusions'
import { log } from '../../utils/logging'
import { passesStringGates } from '../../utils/model-output-checks'
import { drawAnswers } from './answers'
import { crypticClueContribution } from './contribution'
import { knownWords } from './data/known-words'
import { buildExplanation } from './explanation'
import { buildHints, gatedGloss } from './hints'
import { deletionIndicators } from './indicators'
import { reviewClues } from './review'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, verifyClue } from './verify'

const PUZZLE_TYPE = 'crypticclue'

// The catalog rates this the lowest pass rate in the catalog, and the cover is the harshest gate in
// this repo, so the multiplier tracks the pass rate rather than convention: REQUEST_MULTIPLIER = 3
// in the phrase handler tolerates rejecting two thirds, and this rejects more than that.
//
// EIGHT SURVIVES THE DEVICE CHANGE, AND THE ARGUMENT FOR IT IS NOT THE ONE IT WAS. The number was
// set against `hidden` and `anagram`, whose failures were mostly the cover's -- a stray token, a
// gap too wide. The synonym devices reject on strictly more: `parts-out-of-order`,
// `ambiguous-removal`, `definitions-not-distinct`, `cue-too-long`, `connective-in-cue` and
// `unknown-definition-word` are all new codes, and `unknown-part-word` now runs over EVERY cue token
// and EVERY part text where its predecessor ran over one fodder span. So the pass rate went DOWN and
// the multiplier did not go up, which is a claim that needs its own reason.
//
// THE REASON IS THE CEILING, not comfort. The ask cannot usefully exceed the dedupe: requestBatch
// collapses on normalized answer, one clue per distinct shortlist word, so SHORTLIST_SIZE (40) is
// the most this call can ever keep. At countPerDay 2 the ask is 16, and doubling it to 32 would sit
// against a shortlist of 40 -- forcing the model to clue nearly every word it is handed, which is
// precisely what the over-ask on the SHORTLIST exists to avoid (answers.ts: a shortlist equal to the
// ask means the model may not skip the words it cannot clue). Raising this number without raising
// SHORTLIST_SIZE trades a skip the model should take for a clue it should not have written.
//
// WHAT ABSORBS THE HARDER REJECTION IS bestEffort AND THE BAND MAP, not a bigger ask. A short night
// is a declared-acceptable outcome for this type, and the two bands are each fed by TWO devices --
// see bandOf -- so a band survives one device failing wholesale.
//
// THERE IS DELIBERATELY NO MAX_ATTEMPTS CONSTANT IN THIS GENERATOR. CLAUDE.md requires every redraw
// loop to be bounded and to throw at the bound; a type that never redraws has nothing to bound and
// cannot spin inside a 900-second Lambda. NO LOOP TO BOUND IS STRONGER THAN A BOUNDED LOOP -- and
// "bounded because each attempt is bounded, times N devices times N difficulties" is the version of
// that bug which passes review. One call has no N to multiply. The second attempt comes from
// OUTSIDE the invocation -- the next GET for this date, rate-limited by claimPackGeneration rather
// than by a bound in here.
//
// THE ONE COST OF OVER-ASKING IN A SINGLE CALL, named because it converts a partial failure into a
// total one: eight clues is a large output and it shares max_tokens with adaptive thinking, so a run
// that spends the budget thinking returns no tool_use block and the whole night is lost, where eight
// separate calls would lose one eighth. Mitigated rather than hoped: the prompt's config line
// carries maxTokens 32000, and stopReason is logged on every invocation and promoted to logError on
// max_tokens.
const CANDIDATES_PER_PUZZLE = 8

// Built ONCE at module scope, never inside verify.ts -- which stays pure and takes isKnownWord as a
// parameter. This module is imported by generators/model.ts and by nothing the request path can
// reach, which is what satisfies the rule as it is actually applied: nothing lexical ships into
// GetPackByDateFunction. The registry-bundle probe in generators/index.test.ts is what holds it.
const KNOWN_WORDS = new Set(knownWords)
const isKnownWord = (word: string): boolean => KNOWN_WORDS.has(word)

const defaultShortId = (): string => randomBytes(4).toString('hex')

export const crypticTool: ToolSchema = {
  // An element is OPAQUE to ajv, so this string is the ONLY thing that specifies a clue to the
  // model. Every field the schema no longer describes is described here instead.
  // IT AGREES WITH prompts/create-cryptic-clues.txt FIELD FOR FIELD, and that agreement is the whole
  // specification of an element: the schema below says only that `clues` is an array, so a field this
  // sentence does not name is a field the model learns about from the prompt alone -- or not at all.
  // The two cue rules are stated HERE as well as in the prompt's <parts> block because verify.ts
  // rejects on them (`cue-too-long`, `connective-in-cue`) and a rule that only one of the two
  // documents carries is a rule half the batch will break.
  description:
    'Submit the cryptic clues for this pack. Each element is an object with: `answer`, one of the ' +
    'supplied answer words, spelled exactly as supplied; `clue`, the surface reading, letters and ' +
    'single spaces only, at most 120 characters, carrying no enumeration; `device`, one of ' +
    '"charade", "deletion" or "doubledefinition"; and `gloss`, one sentence of at most 80 ' +
    'characters saying what the ANSWER is or does, never naming it and never reusing a substantive ' +
    'word from the definition. Then the fields that device owes. A "charade" carries `definition`, ' +
    'one to four words copied verbatim from `clue`, and `parts`, an array of two or more objects ' +
    'each with `text`, the uppercase letters that part contributes, which is NOT written in the ' +
    'clue, and `cue`, the clue words that mean it, copied verbatim; the parts concatenate in the ' +
    'order listed to exactly the answer, and their cues appear in the clue in that same order. A ' +
    '"deletion" carries `definition`; `indicator`, copied verbatim from `clue` and drawn from the ' +
    'supplied list for the claimed removal; `removal`, one of "first", "last" or "middle"; and ' +
    '`source`, one object with `text`, the uppercase longer word, which is NOT written in the clue, ' +
    'and `cue`, the clue words that mean it, where removing the stated letter from `text` leaves ' +
    'exactly the answer. A "doubledefinition" carries `definitions` alone -- exactly two strings, ' +
    'both copied verbatim from `clue`, each ONE TO THREE WORDS and a definition of the answer in a ' +
    'genuinely different sense -- and no `definition`, no `indicator` and no `parts`. A linking word ' +
    'inside a definition counts against the two the whole clue is allowed, except a leading article. ' +
    'Two rules bind every `cue`: at ' +
    'most THREE WORDS, and NO LINKING WORD inside it (a, an, and, as, by, for, from, gets, gives, ' +
    'in, is, leaves, makes, of, the, to, with) -- on "Floor covering from vehicle with animal" the ' +
    'cue is "vehicle", never "from vehicle".',
  input_schema: {
    properties: {
      // items: {} -- an element is OPAQUE to ajv, deliberately. ANY keyword below this line,
      // INCLUDING `type`, fails the ENTIRE eight-clue payload over one malformed element, which is
      // the exact opposite of a per-candidate filter. services/phrases.ts and services/review.ts
      // each carry a live counter-example to this rule, one of them four lines below a comment
      // forbidding it. Nothing here copies either.
      clues: { items: {}, type: 'array' },
    },
    // The one surviving constraint, and it is at the top level: a payload with no `clues` key is not
    // a batch, and there is nothing left for a per-item filter to do.
    required: ['clues'],
    type: 'object',
  },
  name: 'submit_cryptic_clues',
}

// The accepted item carries its answer so keyOf can read it: requestBatch calls keyOf ONLY on
// something accept returned, and Candidate carries no key of its own.
//
// It also carries the VerifiedClue it was built from, because the REVIEW PASS runs after
// requestBatch has finished and needs the clue rather than the candidate. Without it the review
// would have to reconstruct a decomposition out of a built Puzzle, which is the "second copy of the
// text" this type is organized to never have.
interface CrypticCandidate extends Candidate<CrypticClueData> {
  answer: string
  verified: VerifiedClue
}

/**
 * THE DIAL, and it is a READ of fields the verifier already proved -- `device`, and for a charade
 * `parts.length` -- never a new rating. NOTHING HERE DERIVES, RATES OR MEASURES: verify.ts is
 * exhaustive on CrypticDevice and `parts` is a proved, ordered, non-empty list, so this map is total
 * by construction and a fourth device is a compile error rather than a silently unbanded clue.
 *
 * THE BANDS COUNT UNKNOWNS AND SIGNPOSTS, which is the only thing separating these three devices in
 * the player's hand:
 *
 *   deletion -> 3.       ONE unknown -- the source word -- and the indicator SIGNPOSTS the operation.
 *                        Every deletion indicator names what it does (tellingIndicators.deletion is
 *                        the WHOLE set), so the mechanism is printed on the page and only the synonym
 *                        is not.
 *   charade-2 -> 3.      Two unknowns and NO signpost at all -- a charade carries no indicator, so
 *                        nothing says the answer is two words abutting -- but they are the two
 *                        SHORTEST unknowns this type asks for, and the definition sits at one end.
 *   charade-3+ -> 5.     Three or more unknowns, each of which must be reached from its own cue
 *                        before any of them can be checked against the others.
 *   doubledefinition -> 5. No letter mechanics WHATSOEVER, plus a device the player must recognize
 *                        before they can start: the surface reads as one sentence and is two
 *                        definitions.
 *
 * BAND 5 HAS TWO INDEPENDENT OCCUPANTS BY DESIGN, and that is the correction to the hazard the
 * previous dial shipped with. This type can starve a band on DEVICE MIX rather than on clue quality
 * -- a night where the model writes no usable clue of one device leaves a band empty -- so one device
 * per band reintroduces exactly that failure. With charade-3+ and doubledefinition both landing on 5,
 * a night with no double definition still fills the band, and band 3 is fed by deletion and
 * charade-2 for the same reason.
 *
 * ONE BAND PER CANDIDATE, NEVER BOTH. A candidate usable at every band is one the selection loop can
 * spend anywhere, and this type over-asks eight to one precisely so the pool can afford to be picky.
 * Widening usableAt would let a run of deletions fill band 5 with the type's gentlest shape, which is
 * this type shipping the same puzzle twice under two labels -- the failure the dial exists to
 * prevent.
 */
const bandOf = (clue: VerifiedClue): Difficulty =>
  clue.device === 'deletion' ? 3 : clue.device === 'doubledefinition' ? 5 : clue.parts.length === 2 ? 3 : 5

/**
 * One verified clue to one candidate, or undefined if its ladder cannot be built.
 *
 * ITS OWN FUNCTION because it is called TWICE: once inside `accept`, and again after the reviewer
 * replaces a gloss. Rebuilding through the same path is what stops a fixed gloss shipping a ladder
 * composed from the original -- `build` closes over `clue`, so a candidate is only ever as current
 * as the VerifiedClue it was made from.
 */
const toCandidate = (clue: VerifiedClue): CrypticCandidate | undefined => {
  const hints = buildHints(clue)
  if (hints === undefined) {
    return undefined
  }

  // A FAILED GLOSS COSTS A RUNG; A FAILED EXPLANATION COSTS THE PUZZLE. The asymmetry is the reason
  // the reveal is built in its own module rather than as a fifth entry in the hint pool: a pool entry
  // that drops backfills silently and the player gets a slightly meaner ladder, which is a fine
  // outcome for a hint and the WRONG one for the only string that cannot be backfilled from anywhere.
  // A puzzle with two hints ships. A puzzle where the player solves the clue, taps to reveal, and the
  // board has nothing to say does not -- and under these devices there is nothing on the page to fall
  // back to, because CAR and BRANDY are not written in the clue.
  const explanation = buildExplanation(clue)
  if (explanation === undefined) {
    return undefined
  }

  return {
    answer: clue.answer,
    build: async (
      date: PackDate,
      difficulty: Difficulty,
      createShortId: () => string = defaultShortId,
    ): Promise<Puzzle<CrypticClueData>> => ({
      data: {
        answer: clue.answer,
        // BYTE-IDENTICAL to the string the verifier proved. THE SPANS CAME OFF THE WIRE and this
        // requirement did not leave with them: `explanation` and every quoting rung are composed
        // from slices of THIS string taken against spans computed over it, so a normalization on
        // the way out -- a trim, a whitespace collapse, a re-encode -- would ship a reveal quoting
        // words the clue no longer holds at those offsets. Nothing would catch it, because the
        // composed strings still typecheck and still render SOMETHING. generator.test.ts
        // round-trips `data` through a serialize-and-parse and re-verifies the stored clue, which
        // is the only test that would. THE REVIEWER MAY NOT TOUCH IT EITHER, which review.ts
        // enforces by only ever replacing `gloss`.
        clue: clue.clue,
        enumeration: clue.answer.split(' ').map((word) => word.length),
        // Composed above rather than here, because its failure has to be able to drop the candidate
        // and `build` is async, already committed, and has nowhere to return `undefined` to.
        explanation,
        hints,
      },
      difficulty,
      estimatedSeconds:
        crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
      id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
      type: PUZZLE_TYPE,
    }),
    // ONE BAND, from the map above. THE COST IS STATED: this type can starve a band on DEVICE MIX
    // rather than only on clue quality, and the prompt is what supplies the mix -- which is why each
    // band has two devices behind it. bestEffort is what makes the residue survivable: isComplete
    // skips this type, so a night that fills only one band is a pack that still reads complete.
    usableAt: [bandOf(clue)],
    verified: clue,
  }
}

/**
 * TWO SERIAL BEDROCK CALLS -- the batch, then the review -- over-asked eight to one, gated per
 * candidate, with ZERO retries of its own.
 *
 * The count is not trivia. GENERATOR_BUDGET_MS in handlers/create-model-puzzles.ts reserves the tail
 * of a 900-second Lambda for the slowest GENERATOR, and this is the generator that made that
 * distinction necessary: it runs last, and a reserve sized for one call does not cover two. Adding a
 * third call here moves a number in another file.
 *
 * `recent` is THE RECENT PACKS, not a pre-flattened exclusion list, which costs this type exactly
 * one line -- the narrowed reader below -- and keeps per-type dispatch out of the handler.
 */
const fetchCandidates = async (
  count: number,
  recent: { puzzles: Puzzle[] }[],
  origin: PackDate,
): Promise<Candidate<CrypticClueData>[]> => {
  const excluded = recentCrypticAnswers(recent, origin)
  const excludedKeys = new Set(excluded.map(normalizeAnswer))
  const answers = drawAnswers(excludedKeys)
  const asked = count * CANDIDATES_PER_PUZZLE
  const rejections: Record<string, number> = {}
  let returned = 0
  let verified = 0

  const kept = await requestBatch<unknown, CrypticCandidate>({
    // PER ITEM, and it NEVER throws. Every check that could throw is a logged per-item rejection
    // instead, so a bad candidate costs one of eight rather than the batch.
    accept: (raw) => {
      returned += 1
      const clue = verifyClue(raw, answers, isKnownWord, (reason, detail) => {
        rejections[reason] = (rejections[reason] ?? 0) + 1
        log('Rejected a cryptic candidate', { ...detail, reason, type: PUZZLE_TYPE })
      })
      if (clue === undefined) {
        return undefined
      }
      // The clue's own G1-G4 pass. It is model-authored player-visible prose, and the verifier's
      // charset and length gates are not the same rows -- G4, the charged-term check, has no
      // counterpart in verify.ts at all. The definition rung quotes a slice of this string, so this
      // is the pass buildHints' subset argument stands on. G5 is waived BY ROLE: a
      // cryptic clue legitimately contains its answer's letters, and verify step 11's inflection
      // check is its replacement.
      if (!passesStringGates({ maxLength: MAX_CLUE_LENGTH, value: clue.clue })) {
        rejections.gated = (rejections.gated ?? 0) + 1
        log('Rejected a cryptic candidate', { reason: 'gated', type: PUZZLE_TYPE })
        return undefined
      }
      // THE GLOSS'S GATES RUN HERE, AND THAT IS A MOVE RATHER THAN AN ADDITION. They used to run
      // only inside buildHints, whose rejection reaches the ladder and never writes back to the
      // VerifiedClue -- so the clue carried the RAW model string onward, and review.ts sent that
      // string to a second Bedrock call under a prompt that calls it "the first hint the player is
      // shown". For a gloss that had already failed its gates that sentence is FALSE: the rung was
      // dropped and the pool backfilled before the reviewer ever read it. A reviewer shown a
      // sentence the player will never see may reasonably answer `keep`, so the one case where its
      // `fix` would actually recover a rung was the one case it could not detect. It was also the
      // only field on VerifiedClue reaching a downstream model with no length bound and no content
      // check, which CLAUDE.md's input-validation rule does not permit.
      //
      // Deliberately the shape the clue's own prose gate directly above already has -- verify proves
      // structure, `accept` gates prose -- so it adds no new pattern here. And it costs the RUNG
      // rather than the candidate: a dropped gloss is `undefined` from here on and every reader,
      // reviewer and builder alike, sees the ladder the player will actually get.
      //
      // buildHints STILL RUNS ITS OWN gatedGloss and must. See the note on gatedGloss for why the
      // repeat is both required and free.
      //
      // THE DEFINITION IS DERIVED, NOT DESTRUCTURED, and on a double definition it is the UNION OF
      // BOTH HALVES. `definitionSpan` does not exist on every arm of VerifiedClue --
      // VerifiedDoubleDefinition carries `definitionSpans`, a pair -- so this is a switch on the
      // discriminant, and the union is the right input rather than a convenience: gatedGloss's
      // restates-the-definition rule must reject a gloss leaning on EITHER half, and the second half
      // is the one the player is likelier to be stuck on. IT MUST STAY EQUAL TO THE DERIVATION IN
      // buildHints, which composes the same string for the same call: a gloss this gate keeps and
      // that one drops would put a rung in the reviewer's hands that the player never sees, which is
      // the exact defect moving the gate here was meant to close. Held by generator.test.ts's
      // double-definition row over the second half, not by this comment.
      const definition = (clue.device === 'doubledefinition' ? clue.definitionSpans : [clue.definitionSpan])
        .map((span) => clue.clue.slice(span.start, span.end))
        .join(' ')
      const gated = { ...clue, gloss: gatedGloss(clue.gloss, clue.answer, definition, 'generator') }
      const candidate = toCandidate(gated)
      if (candidate === undefined) {
        return undefined
      }
      verified += 1

      return candidate
    },
    asked,
    context: {
      answerChoices: [...answers.values()],
      clueCount: asked,
      connectives: [...CONNECTIVES],
      // The one live feedback channel, and the property that closes it is that it carries ANSWERS
      // ONLY: every entry is a single word that already passed a charset gate, so a re-injected
      // string cannot carry a tag, a brace, a newline or a directive-shaped token. No clue text and
      // no hint prose ever enters an exclusion list.
      crypticAnswersAlreadyUsed: excluded,
      // KEYED BY REMOVAL KIND, never flattened, because that is the shape verify step 8 gates on:
      // the indicator must be on the CLAIMED removal's own family, so a model handed one flat list
      // would be told to write `endless` on a clue that beheads and then have it rejected. Derived
      // from the record rather than restated, so a fourth removal kind reaches the model the day it
      // reaches the verifier.
      //
      // The charade and doubledefinition entries of crypticIndicators are DELIBERATELY ABSENT rather
      // than sent empty: neither device has an indicator, and an empty list in the context reads as
      // "there are none available today" instead of "this device takes none".
      deletionIndicators: Object.fromEntries(
        Object.entries(deletionIndicators).map(([removal, entries]) => [removal, [...entries]]),
      ),
      // THE CHARSET IS DELIBERATELY ABSENT. The prompt text states it; a second copy here is a
      // second place for it to drift out of agreement with CLUE_CHARSET.
    },
    excludedKeys,
    itemsOf: (payload) => ((payload as { clues?: unknown[] })?.clues ?? []) as unknown[],
    keyOf: (candidate) => normalizeAnswer(candidate.answer),
    promptId: llmCrypticPromptId,
    tool: crypticTool,
    type: PUZZLE_TYPE,
  })

  // THE SECOND MODEL CALL, and it runs over what code already ACCEPTED rather than over everything
  // returned: a candidate the decomposition rejected will never ship, so reviewing it spends Opus
  // tokens to learn nothing.
  //
  // `asked` DOES NOT BOUND THIS PAYLOAD, and a previous version of this comment claimed it did on
  // reasoning that argued the opposite: requestBatch never truncating to `count` is precisely why
  // `asked` is a request rather than a ceiling. The real ceiling is requestBatch's dedupe on
  // normalized answer -- one clue per distinct shortlist word, so SHORTLIST_SIZE. See reviewClues,
  // which carries the token-budget consequence and the degrade.
  //
  // It never throws and never returns more than it was given -- see reviewClues -- so a failed
  // review degrades to exactly the behavior this type had before it existed.
  const reviewed = await reviewClues(kept.map((candidate) => candidate.verified))
  const byKey = new Map(reviewed.map((clue) => [normalizeAnswer(clue.answer), clue]))

  // REBUILT ONLY WHEN THE GLOSS ACTUALLY MOVED. `build` closes over the VerifiedClue it was made
  // from, so a clue whose gloss the reviewer replaced must go back through toCandidate or it ships
  // the ladder composed from the original. It compares the gloss VALUE, not the clue's identity:
  // reviewClues either returns the same object or one spread with a new gloss, and a replacement
  // equal to the original is a string that compares equal either way -- which is the agreement
  // review.ts's applyFix note describes from the other side.
  const survivors = kept
    .filter((candidate) => byKey.has(normalizeAnswer(candidate.answer)))
    .map((candidate) => {
      const clue = byKey.get(normalizeAnswer(candidate.answer)) as VerifiedClue
      // `?? candidate` on the rebuild: a fixed gloss whose ladder somehow cannot be composed keeps
      // the candidate it already had rather than losing a reviewed clue to a builder failure.
      return clue.gloss === candidate.verified.gloss ? candidate : (toCandidate(clue) ?? candidate)
    })

  // A DELIVERABLE rather than telemetry garnish: the cheap kill criterion reads this line, and the
  // per-reason counts are what turn "the model is bad at cryptics" into a clause to argue about.
  //
  // A `log`, NOT a logError, and since 2026-08-26 that agrees with the handler rather than merely
  // deferring to it: create-model-puzzles.ts alarms only when a REQUIRED type produced nothing, and
  // this type declares bestEffort, so a short cryptic night raises no ERROR anywhere by design. A
  // second ERROR for one event into a stack whose only alarm channel is a level="ERROR" subscription
  // is the noise the whole alarm design exists to avoid; a FIRST one here would be worse, since it
  // would page for exactly the outcome bestEffort exists to declare acceptable.
  // `glossed` because a dead gloss prompt is otherwise INVISIBLE on the nightly path. gatedGloss
  // returns before its own log when the model supplied nothing at all -- correctly, since that is not
  // a gate failure -- so a night where every clue carried a gloss and a night where none did produce
  // identical logs, and the only instrument that could tell them apart is an audit script a person
  // has to run. Read against the `Dropped a cryptic gloss` reason counts already in this stream, one
  // field separates "the prompt stopped emitting them" from "the gates are rejecting them".
  log('Fetched cryptic clues', {
    asked,
    glossed: survivors.filter((candidate) => candidate.verified.gloss !== undefined).length,
    kept: survivors.length,
    rejections,
    returned,
    reviewDropped: kept.length - survivors.length,
    type: PUZZLE_TYPE,
    verified,
  })
  return survivors
}

export const crypticClueGenerator: ModelGenerator<CrypticClueData> = {
  ...crypticClueContribution,
  fetchCandidates,
}
