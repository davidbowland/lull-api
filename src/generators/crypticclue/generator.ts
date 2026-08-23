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
import { buildHints } from './hints'
import { crypticIndicators } from './indicators'
import { CONNECTIVES, MAX_CLUE_LENGTH, verifyClue } from './verify'

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
// that bug which passes review. One call has no N to multiply. The 05:33 run is the second attempt,
// at a scheduler-bounded once-a-day rate, from outside the invocation.
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
    'from the supplied list for that device; and `fodder`, the words the wordplay operates on, ' +
    'copied verbatim from `clue`.',
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
interface CrypticCandidate extends Candidate<CrypticClueData> {
  answer: string
}

/**
 * One Bedrock call, over-asked eight to one, gated per candidate, with ZERO retries.
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
      // counterpart in verify.ts at all. Rung 2 quotes a slice of this string, so this is the pass
      // buildHints' subset argument stands on. G5 is waived BY ROLE: a cryptic clue legitimately
      // contains its answer's letters, and verify step 11's inflection check is its replacement.
      if (!passesStringGates({ maxLength: MAX_CLUE_LENGTH, value: clue.clue })) {
        rejections.gated = (rejections.gated ?? 0) + 1
        log('Rejected a cryptic candidate', { reason: 'gated', type: PUZZLE_TYPE })
        return undefined
      }
      const hints = buildHints(clue)
      if (hints === undefined) {
        return undefined
      }
      verified += 1

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
            // is the only test that would.
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
      }
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

  // A DELIVERABLE rather than telemetry garnish: the cheap kill criterion reads this line, and the
  // per-reason counts are what turn "the model is bad at cryptics" into a clause to argue about.
  //
  // A `log`, NOT a logError. The handler already raises 'Model type is still short after its call'
  // unconditionally on a short type, and a second ERROR for one event into a stack whose only alarm
  // channel is a level="ERROR" subscription is the noise the whole alarm design exists to avoid.
  log('Fetched cryptic clues', { asked, kept: kept.length, rejections, returned, type: PUZZLE_TYPE, verified })
  return kept
}

export const crypticClueGenerator: ModelGenerator<CrypticClueData> = {
  ...crypticClueContribution,
  fetchCandidates,
}
