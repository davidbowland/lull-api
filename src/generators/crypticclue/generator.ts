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
import { buildHints, gatedGloss } from './hints'
import { crypticIndicators } from './indicators'
import { reviewClues } from './review'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, verifyClue } from './verify'

const PUZZLE_TYPE = 'crypticclue'

// The catalog rates this the lowest pass rate in the catalog, and the cover is the harshest gate in
// this repo, so the multiplier tracks the pass rate rather than convention: REQUEST_MULTIPLIER = 3
// in the phrase handler tolerates rejecting two thirds, and this will reject more than that at
// launch.
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
  description:
    'Submit the cryptic clues for this pack. Each element is an object with: `answer`, one of the ' +
    'supplied answer words, spelled exactly as supplied; `clue`, the surface reading, letters and ' +
    'single spaces only, at most 120 characters, carrying no enumeration; `device`, either "hidden" ' +
    'or "anagram"; `definition`, the definition half of the clue, one to four words, copied ' +
    'verbatim from `clue`; `indicator`, the wordplay signal, copied verbatim from `clue` and drawn ' +
    'from the supplied list for that device; `fodder`, the words the wordplay operates on, ' +
    'copied verbatim from `clue`; and `gloss`, one sentence of at most 80 characters saying what ' +
    'the ANSWER is or does, never naming it and never reusing a substantive word from `definition`.',
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

  return {
    answer: clue.answer,
    build: async (
      date: PackDate,
      difficulty: Difficulty,
      createShortId: () => string = defaultShortId,
    ): Promise<Puzzle<CrypticClueData>> => ({
      data: {
        answer: clue.answer,
        // BYTE-IDENTICAL to the string the verifier proved. Any future normalization on the way
        // out -- a trim, a whitespace collapse, a re-encode -- silently invalidates both spans,
        // and nothing would catch it because they still typecheck and still render SOMETHING.
        // generator.test.ts round-trips the spans through a serialized-and-parsed `data`, which
        // is the only test that would. THE REVIEWER MAY NOT TOUCH IT EITHER, which review.ts
        // enforces by only ever replacing `gloss`.
        clue: clue.clue,
        definitionSpan: clue.definitionSpan,
        device: clue.device,
        enumeration: clue.answer.split(' ').map((word) => word.length),
        fodderSpan: clue.fodderSpan,
        hints,
      },
      difficulty,
      estimatedSeconds:
        crypticClueContribution.baseSeconds + crypticClueContribution.secondsPerDifficulty * (difficulty - 1),
      id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
      type: PUZZLE_TYPE,
    }),
    // One band, because the type declares one.
    usableAt: [3],
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
): Promise<Candidate<CrypticClueData>[]> => {
  const excluded = recentCrypticAnswers(recent)
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
      // counterpart in verify.ts at all. The definition and fodder rungs quote slices of this
      // string, so this is the pass buildHints' subset argument stands on. G5 is waived BY ROLE: a
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
      const definition = clue.clue.slice(clue.definitionSpan.start, clue.definitionSpan.end)
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
      anagramIndicators: [...crypticIndicators.anagram],
      answerChoices: [...answers.values()],
      clueCount: asked,
      connectives: [...CONNECTIVES],
      // The one live feedback channel, and the property that closes it is that it carries ANSWERS
      // ONLY: every entry is a single word that already passed a charset gate, so a re-injected
      // string cannot carry a tag, a brace, a newline or a directive-shaped token. No clue text and
      // no hint prose ever enters an exclusion list.
      crypticAnswersAlreadyUsed: excluded,
      hiddenIndicators: [...crypticIndicators.hidden],
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
