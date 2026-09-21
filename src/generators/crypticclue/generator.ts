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

// This type has the lowest pass rate in the catalog, so the multiplier tracks the pass rate rather
// than convention: REQUEST_MULTIPLIER = 3 in the phrase handler tolerates rejecting two thirds and
// this rejects more. It does not go higher because the ask cannot usefully exceed the dedupe --
// requestBatch collapses on normalized answer, so SHORTLIST_SIZE (40) bounds what one call keeps,
// and doubling an ask of 16 would force the model to clue nearly every word it is handed.
//
// THERE IS DELIBERATELY NO MAX_ATTEMPTS CONSTANT HERE. CLAUDE.md requires every redraw loop to be
// bounded; this type never redraws, so nothing can spin inside a 900-second Lambda. The second
// attempt comes from outside the invocation, rate-limited by claimPackGeneration.
//
// The cost of over-asking in ONE call is that a partial failure becomes total: a large output
// shares max_tokens with adaptive thinking, so a run that spends the budget thinking returns no
// tool_use block. stopReason is logged on every invocation and promoted to logError on max_tokens.
const CANDIDATES_PER_PUZZLE = 8

// Built once at module scope, never inside verify.ts, which stays pure and takes isKnownWord as a
// parameter. This module is reachable from generators/model.ts and from nothing on the request
// path, so nothing lexical ships into GetPackByDateFunction; generators/index.test.ts holds that.
const KNOWN_WORDS = new Set(knownWords)
const isKnownWord = (word: string): boolean => KNOWN_WORDS.has(word)

const defaultShortId = (): string => randomBytes(4).toString('hex')

export const crypticTool: ToolSchema = {
  // An element is opaque to ajv, so this string is the only thing that specifies a clue to the
  // model. It must agree with prompts/create-cryptic-clues.txt field for field: a field this
  // sentence does not name is one the model learns about from the prompt alone, or not at all.
  description:
    'Submit the cryptic clues for this pack. Each element is an object with: `answer`, one of the ' +
    'supplied answer words, spelled exactly as supplied; `clue`, the surface reading, letters and ' +
    'single spaces only, at most 120 characters, carrying no enumeration; `device`, one of ' +
    '"charade", "deletion" or "doubledefinition"; `gloss`, one sentence of at most 80 ' +
    'characters saying what the ANSWER is or does, never naming it and never reusing a substantive ' +
    'word from the definition; and `wordGloss`, a PHRASE of at most 56 characters that starts ' +
    'lowercase and does not end with a period, naming the sense of the word the device hides -- a ' +
    "charade's first part, a deletion's source, or for a double definition a third angle on the " +
    'answer -- naming neither that word nor the answer in any form, and reusing no substantive word ' +
    'from that cue (or, on a double definition, from either half or from `gloss`). Then the fields ' +
    'that device owes. A "charade" carries `definition`, ' +
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
      // `items: {}` keeps an element opaque to ajv deliberately. ANY keyword here, including
      // `type`, fails the entire eight-clue payload over one malformed element, which is the
      // opposite of a per-candidate filter.
      clues: { items: {}, type: 'array' },
    },
    // The one surviving constraint, at the top level: a payload with no `clues` key is not a batch.
    required: ['clues'],
    type: 'object',
  },
  name: 'submit_cryptic_clues',
}

// Carries its answer so keyOf can read it (Candidate has no key of its own), and the VerifiedClue
// it was built from, because the review pass runs after requestBatch and needs the clue. Without
// the latter the review would reconstruct a decomposition out of a built Puzzle, which is the
// "second copy of the text" this type is organized to never have.
interface CrypticCandidate extends Candidate<CrypticClueData> {
  answer: string
  verified: VerifiedClue
}

/**
 * The difficulty dial, a READ of fields the verifier already proved rather than a new rating, so a
 * fourth device is a compile error rather than an unbanded clue. The bands count unknowns and
 * signposts: a deletion has one unknown and an indicator that names the operation, a two-part
 * charade has two unknowns and no indicator, a longer charade has three or more, and a double
 * definition has no letter mechanics and must be recognized before it can be started.
 *
 * Each band has TWO devices behind it because this type can starve a band on DEVICE MIX rather
 * than on clue quality. ONE BAND PER CANDIDATE: widening usableAt would let a run of deletions
 * fill band 5 with the type's gentlest shape.
 */
const bandOf = (clue: VerifiedClue): Difficulty =>
  clue.device === 'deletion' ? 3 : clue.device === 'doubledefinition' ? 5 : clue.parts.length === 2 ? 3 : 5

/**
 * One verified clue to one candidate, or undefined if its ladder cannot be built. Its own function
 * because it is called twice: inside `accept`, and again after the reviewer replaces a gloss.
 * `build` closes over `clue`, so a candidate is only as current as the VerifiedClue it was made
 * from, and rebuilding through this path is what stops a fixed gloss shipping the original ladder.
 */
const toCandidate = (clue: VerifiedClue): CrypticCandidate | undefined => {
  const hints = buildHints(clue)
  if (hints === undefined) {
    return undefined
  }

  // A failed gloss costs a rung; a failed explanation costs the puzzle. A pool entry that drops
  // backfills silently, which is fine for a hint and wrong for the one string that cannot be
  // backfilled from anywhere -- CAR and BRANDY are not written in the clue.
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
        // BYTE-IDENTICAL to the string the verifier proved. `explanation` and every quoting rung
        // are slices of it taken against spans computed over it, so any normalization on the way
        // out ships a reveal quoting words the clue no longer holds at those offsets, and nothing
        // catches it because the composed strings still render something. generator.test.ts
        // round-trips `data` and re-verifies. The reviewer may not touch it either, which review.ts
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
    // One band, from the map above. bestEffort is what makes a starved band survivable: isComplete
    // skips this type, so a night that fills only one band still reads complete.
    usableAt: [bandOf(clue)],
    verified: clue,
  }
}

/**
 * TWO SERIAL BEDROCK CALLS -- the batch, then the review -- over-asked eight to one, gated per
 * candidate, with zero retries of its own. The count is not trivia: GENERATOR_BUDGET_MS in
 * handlers/create-model-puzzles.ts reserves the tail of a 900-second Lambda for the slowest
 * generator, and a reserve sized for one call does not cover two, so adding a third call here
 * moves a number in that file.
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
      // The clue's own G1-G4 pass: G4, the charged-term check, has no counterpart in verify.ts.
      // G5 is waived BY ROLE, since a cryptic clue legitimately contains its answer's letters, and
      // verify step 11's inflection check is its replacement.
      if (!passesStringGates({ maxLength: MAX_CLUE_LENGTH, value: clue.clue })) {
        rejections.gated = (rejections.gated ?? 0) + 1
        log('Rejected a cryptic candidate', { reason: 'gated', type: PUZZLE_TYPE })
        return undefined
      }
      // The gloss is gated HERE, before review.ts sends the clue to a second Bedrock call: the
      // reviewer must see the rung the player will get, and an ungated model string must not reach
      // a downstream model with no length bound and no content check. It costs the RUNG rather
      // than the candidate, and buildHints still runs its own gatedGloss -- see the note there.
      //
      // On a double definition the definition is the UNION of both halves, and THIS MUST STAY
      // EQUAL TO THE DERIVATION IN buildHints: a gloss this gate keeps and that one drops puts a
      // rung in the reviewer's hands that the player never sees. Held by generator.test.ts.
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
      // The one channel feeding model output back into a prompt, and it is safe because it carries
      // ANSWERS ONLY: every entry is a single word that already passed a charset gate, so a
      // re-injected string cannot carry a tag, a brace, a newline or a directive-shaped token. NO
      // CLUE TEXT AND NO HINT PROSE EVER ENTERS AN EXCLUSION LIST.
      crypticAnswersAlreadyUsed: excluded,
      // Keyed by removal kind, never flattened, because that is the shape verify step 8 gates on:
      // a model handed one flat list would write `endless` on a clue that beheads. Derived from
      // the record so a fourth removal kind reaches the model the day it reaches the verifier.
      // crypticIndicators' charade and doubledefinition entries are absent rather than sent empty,
      // since an empty list reads as "none available today" instead of "this device takes none".
      deletionIndicators: Object.fromEntries(
        Object.entries(deletionIndicators).map(([removal, entries]) => [removal, [...entries]]),
      ),
      // The charset is deliberately absent. The prompt text states it; a second copy here is a
      // second place for it to drift out of agreement with CLUE_CHARSET.
    },
    excludedKeys,
    itemsOf: (payload) => ((payload as { clues?: unknown[] })?.clues ?? []) as unknown[],
    keyOf: (candidate) => normalizeAnswer(candidate.answer),
    promptId: llmCrypticPromptId,
    tool: crypticTool,
    type: PUZZLE_TYPE,
  })

  // The second model call, over what code already ACCEPTED rather than over everything returned: a
  // candidate the decomposition rejected will never ship, so reviewing it learns nothing.
  //
  // `asked` does not bound this payload -- requestBatch never truncates to `count`. The real
  // ceiling is its dedupe on normalized answer, so SHORTLIST_SIZE. reviewClues carries the
  // token-budget consequence; it never throws, so a failed review degrades to no review at all.
  const reviewed = await reviewClues(kept.map((candidate) => candidate.verified))
  const byKey = new Map(reviewed.map((clue) => [normalizeAnswer(clue.answer), clue]))

  // Rebuilt only when the gloss actually moved. `build` closes over the VerifiedClue it was made
  // from, so a clue whose gloss the reviewer replaced must go back through toCandidate or it ships
  // the ladder composed from the original. Compares the gloss VALUE, not the clue's identity.
  const survivors = kept
    .filter((candidate) => byKey.has(normalizeAnswer(candidate.answer)))
    .map((candidate) => {
      const clue = byKey.get(normalizeAnswer(candidate.answer)) as VerifiedClue
      // `?? candidate` on the rebuild: a fixed gloss whose ladder somehow cannot be composed keeps
      // the candidate it already had rather than losing a reviewed clue to a builder failure.
      return clue.gloss === candidate.verified.gloss ? candidate : (toCandidate(clue) ?? candidate)
    })

  // A `log`, not a logError: this type declares bestEffort, so a short cryptic night raises no
  // ERROR by design, and the stack's only alarm channel is a level="ERROR" subscription.
  //
  // `glossed` and `wordGlossed` count the RAW supply of the two model strings, because gatedGloss
  // returns before its own log when the model supplied nothing. Read against the `Dropped a cryptic
  // gloss` / `Dropped a cryptic word gloss` counts in the same stream, high supply with high drops
  // is a gate problem and low supply is a prompt problem. Without them the two are identical logs.
  log('Fetched cryptic clues', {
    asked,
    glossed: survivors.filter((candidate) => candidate.verified.gloss !== undefined).length,
    kept: survivors.length,
    rejections,
    returned,
    reviewDropped: kept.length - survivors.length,
    type: PUZZLE_TYPE,
    verified,
    wordGlossed: survivors.filter((candidate) => candidate.verified.wordGloss !== undefined).length,
  })
  return survivors
}

export const crypticClueGenerator: ModelGenerator<CrypticClueData> = {
  ...crypticClueContribution,
  fetchCandidates,
}
