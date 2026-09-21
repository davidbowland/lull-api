import { ClueSpan, CrypticDevice, HintLadder } from '../../types'
import { log, logError } from '../../utils/logging'
import { containsAnswerToken, passesStringGates } from '../../utils/model-output-checks'
import { CONNECTIVES, MAX_CLUE_LENGTH, VerifiedClue, crypticInflections } from './verify'

// The per-rung gate cap, deliberately slack: its job is to be non-binding over every rung the pool
// can compose, so tightening it to the widest frame would turn the next frame into a rejected clue.
// hints.test.ts asserts every composed rung fits and deliberately does NOT assert it is tight.
// MAX_GLOSS_LENGTH is what actually bounds a rung; this fires if a frame quotes the clue again.
export const MAX_CRYPTIC_RUNG_LENGTH = MAX_CLUE_LENGTH + 25

// The CEILING, not the length: a cryptic ladder is one to three rungs. Declared here rather than
// beside HintLadder because types.ts is a types-only module and may hold no runtime value.
export const MAX_HINT_RUNGS = 3

// The gloss ships verbatim as a rung, so this is a rung cap, at the 80 every code-built rung in
// either repo is capped to. lull-ui's MAX_ANAGRAM_RUNG_LENGTH and MAX_PHRAZLE_RUNG_LENGTH are the
// same 80 and are not importable from here; each carries a comment naming this constant, and their
// own tests are what hold them. Deliberately not MAX_HINT_LENGTH (200), which is sized for phrase
// prose; a gloss is one clause about one word, and a longer one drifts toward naming the answer.
export const MAX_GLOSS_LENGTH = 80

// 56 rather than 80 because this string is INTERPOLATED: the widest frame is `The answer also
// means ` at 22, so 56 + 22 + 1 for the period is 79, inside MAX_GLOSS_LENGTH. hints.test.ts
// asserts that arithmetic against the frame rather than restating 79, so widening a frame reddens
// the row instead of pushing a rung over.
export const MAX_WORD_GLOSS_LENGTH = 56

// The 4-8 shortlist band, restated rather than imported (see answers.ts; hints.test.ts asserts the
// copies equal). A length outside it is unreachable from model output, so it is a CODE DEFECT: a
// logError rejection at runtime, never a throw, because buildHints runs inside `accept`, whose
// contract is per-item and throw-free.
const MIN_ANSWER_LENGTH = 4
const MAX_ANSWER_LENGTH = 8

// The openings of every composed rung, as constants rather than inline literals because
// isComposedRung below has to agree with the pools exactly. One frame per device, each over a word
// the clue does not print, which is the only content a rung can spend itself on.
const FIRST_PART_FRAME = 'The first part is '
const LONGER_WORD_FRAME = 'The longer word is '
const ALSO_MEANS_FRAME = 'The answer also means '
const ALL_PARTS_FRAME = 'The answer is '
const SOURCE_FRAME = 'The wordplay starts from '
const BEGINS_FRAME = 'The answer begins with '

/**
 * The frame each device wraps its word gloss in, and the thing that phrase is ABOUT. The targets
 * are what make this a hint rather than a restatement: a charade's first part and a deletion's
 * source are words verify proves are never printed in the clue, and a double definition, which
 * hides no word, gets a third angle on the answer with the gate carrying the weight.
 *
 * FIRST_PART_FRAME is shared with the letter-bearing rung deliberately: `The first part is a noisy
 * argument.` and `The first part is ROW.` sit one above the other, reading as one hint escalating.
 */
const WORD_GLOSS_FRAMES: Record<CrypticDevice, string> = {
  charade: FIRST_PART_FRAME,
  deletion: LONGER_WORD_FRAME,
  doubledefinition: ALSO_MEANS_FRAME,
}

/**
 * Whether a shipped rung was composed here rather than written by the model, for
 * scripts/audit-cryptic.ts. No rung on this type carries metadata -- the pack row is 700 against a
 * measured shape of 640 -- so the text is all there is, and this is sound only because it reads
 * THE POOLS' OWN CONSTANTS: a prefix table copied into the audit would stop matching the day a
 * template is reworded. Directional in the safe direction, since a gloss that happens to open with
 * a frame under-reports the gloss rate rather than hiding a dead prompt.
 */
export const isComposedRung = (text: string): boolean =>
  [ALL_PARTS_FRAME, ALSO_MEANS_FRAME, BEGINS_FRAME, FIRST_PART_FRAME, LONGER_WORD_FRAME, SOURCE_FRAME].some((frame) =>
    text.startsWith(frame),
  )

/**
 * The only place a gloss -- model prose shipped verbatim as rung one -- is judged.
 *
 * Returns the gloss if it may ship as a rung, undefined if the rung drops. NEVER rejects the clue:
 * every failure costs one hint, and the pool backfills from rungs composed in code. All five rows
 * of `passesStringGates` report as `gloss-gate`, which names the CALL rather than the row that
 * fired -- worth knowing before reading a `gloss-gate` count as a length problem.
 *
 * BOTH CALL SITES MUST STAY. generator.ts's `accept` gates before review.ts sends the clue to a
 * second model; buildHints gates because it is the only entry point to a ladder, and a builder
 * that trusts its caller ships an ungated rung the day a second caller appears. The repeat is
 * idempotent and silent, so there is no double log to suppress.
 *
 * G5 RUNS, the opposite of what buildHints does to every other rung: the leak gate is waived BY
 * ROLE over the clue and rungs that quote it, because a cryptic clue legitimately carries its
 * answer's letters, and a gloss is shown before the solve. The inflection check beside it is not
 * redundant, since G5 matches whole tokens with no stemming.
 *
 * The definition-reuse rule rejects a gloss restating the definition -- definition "Bird" rejects
 * "A bird that cannot fly" -- and on a double definition takes the union of both halves. It uses
 * `containsAnswerToken` rather than the repo's answer-leak predicate, which is banned in this
 * directory by an eslint rule and a source scan in imports.test.ts (comments included, so it is
 * not named here) because it would reject a clue whose wordplay spells the answer out. It is also
 * the better check: the banned predicate keeps only tokens of four characters or more, so
 * definitions like "Cat" and "Owl" would slip through.
 */
export const gatedGloss = (
  gloss: string | undefined,
  answer: string,
  definition: string,
  // Which model wrote the string. Required rather than defaulted: it is the only thing separating a
  // create-cryptic-clues gloss from a review-cryptic-clues replacement in the logs, and tuning a
  // prompt by reading which gate fires needs to know which prompt.
  source: 'generator' | 'review',
): string | undefined => {
  if (gloss === undefined) {
    return undefined
  }

  // A `log`, not a logError: a dropped gloss is a working gate on model prose and an expected
  // outcome. The reason travels so the prompt can be tuned by reading which gate fires.
  const drop = (reason: string): undefined => {
    log('Dropped a cryptic gloss', { answer, reason, source, type: 'crypticclue' })
    return undefined
  }

  if (!passesStringGates({ answer, maxLength: MAX_GLOSS_LENGTH, value: gloss })) {
    return drop('gloss-gate')
  }
  if (crypticInflections(answer).some((form) => containsAnswerToken(form, gloss))) {
    return drop('gloss-inflection')
  }
  // Whole tokens on both sides. The definition is a slice of a clue that cleared CLUE_CHARSET, so it
  // is letter-runs separated by single spaces and needs no tokenizer of its own to split.
  const substantive = definition
    .toUpperCase()
    .split(' ')
    .filter((token) => !CONNECTIVES.has(token))
  if (substantive.some((token) => containsAnswerToken(token, gloss))) {
    return drop('gloss-restates-definition')
  }
  return gloss
}

/**
 * A length floor that applies to free PROSE and not to a clue slice, and the split is the point.
 * CONNECTIVES is not a stopword list but the cryptic SEAM alphabet, holding `of` and `with` but
 * not `on`, `it` or `at`. Over a clue slice that is exactly right, and a floor would be wrong
 * there, since `Cat` and `Owl` are pure content; over free prose it is not enough, because a
 * double definition forbids its word gloss the whole GLOSS above it, so two strings sharing only
 * `on` would kill the rung. Four matches the floor the repo's answer-leak filter uses on the same
 * kind of text; two glosses sharing a real four-letter content word still drop.
 */
const MIN_PROSE_TOKEN_LENGTH = 4

/**
 * The substantive tokens of some text, for the restatement rules. Splits on non-alphanumerics
 * rather than spaces: a no-op on a clue slice, and what makes the floor above meaningful on prose,
 * where `paper.` would otherwise measure six characters.
 */
const substantiveTokens = (texts: readonly string[], minLength = 1): string[] =>
  texts
    .flatMap((text) => text.toUpperCase().split(/[^A-Z0-9]+/))
    .filter((token) => token.length >= minLength && !CONNECTIVES.has(token))

/**
 * Whether a model-supplied string names any form of any protected word. Whole tokens, with this
 * type's inflection list, and it is the check G5 cannot make: G5 keeps only tokens of four
 * characters or more, so CAR and ROW pass, and it has no stemming, so CARPETS passes too.
 */
const namesAny = (protectedWords: readonly string[], prose: string): boolean =>
  protectedWords.flatMap(crypticInflections).some((form) => containsAnswerToken(form, prose))

/**
 * What a word gloss may not restate, separated by the KIND of text rather than gathered into one
 * list, because the two take different token filters and merging them is a bug that typechecks.
 */
export interface WordGlossForbids {
  // Free prose -- the gloss already shipped as rung one -- so it takes the length floor.
  prose?: string
  // Clue slices: short, curated, and filtered on CONNECTIVES alone so a three-letter definition
  // counts.
  slices: readonly string[]
}

/**
 * The gate on a WORD GLOSS -- the model's phrase for the sense of a word the answer is built from.
 *
 * A SECOND GATE RATHER THAN A SECOND CALLER OF gatedGloss, because three of its rows differ. It
 * protects TWO words, the target and the answer, where a gloss protects one. It carries a SHAPE
 * row, because a word gloss is INTERPOLATED rather than shipped verbatim, so `A noisy argument.`
 * composes `The first part is A noisy argument..` -- a DROP rather than a rung-gate rejection,
 * since a malformed phrase must never cost the puzzle. And it forbids SEVERAL texts: a charade
 * forbids the cue that already means the target, and a double definition forbids both printed
 * halves AND the gloss shipped as rung one, since a second angle repeating the first is one hint
 * delivered twice.
 *
 * G5 runs here, with the answer supplied, for the reason gatedGloss gives.
 *
 * Never rejects the clue. Every failure costs one rung and the pool backfills.
 */
export const gatedWordGloss = (
  wordGloss: string | undefined,
  // The word the phrase is about: a charade's first part, a deletion's source, or -- on a double
  // definition, which hides no word -- the answer itself.
  target: string,
  answer: string,
  // Text the phrase may not restate, split by what KIND of text it is because the two take
  // different token filters -- see MIN_PROSE_TOKEN_LENGTH.
  forbid: WordGlossForbids,
  source: 'generator' | 'review',
): string | undefined => {
  if (wordGloss === undefined) {
    return undefined
  }

  const drop = (reason: string): undefined => {
    log('Dropped a cryptic word gloss', { answer, reason, source, type: 'crypticclue' })
    return undefined
  }

  if (!passesStringGates({ answer, maxLength: MAX_WORD_GLOSS_LENGTH, value: wordGloss })) {
    return drop('word-gloss-gate')
  }
  // After the string gates, which are what prove this is non-empty, so `wordGloss[0]` is defined.
  if (wordGloss.endsWith('.') || wordGloss[0] !== wordGloss[0].toLowerCase()) {
    return drop('word-gloss-shape')
  }
  if (namesAny([answer, target], wordGloss)) {
    return drop('word-gloss-inflection')
  }
  const restated = [
    ...substantiveTokens(forbid.slices),
    ...substantiveTokens(forbid.prose === undefined ? [] : [forbid.prose], MIN_PROSE_TOKEN_LENGTH),
  ]
  if (restated.some((token) => containsAnswerToken(token, wordGloss))) {
    return drop('word-gloss-restates-cue')
  }
  return wordGloss
}

/**
 * Up to three rungs drawn from THIS DEVICE'S pool: the first three that say something the player
 * cannot already read off their screen, weakest first.
 *
 * A RUNG THAT RESTATES THE CLUE IS NOT A HINT. `clue` ships on `data` and the client renders it
 * beside the enumeration, so a rung naming the device, quoting the definition or stating the length
 * spends a hint and returns nothing.
 *
 * ONE POOL PER DEVICE, AND DELIBERATELY NO SHARED ORDERING, because the same rung is worth
 * different amounts on each and ranking by how much a rung LOOKS like it says is the error
 * CLAUDE.md records this type making twice, in opposite directions. Each pool is ranked by what
 * its rungs YIELD in the player's hand, and the reasoning stays at the pool rather than in a
 * shared table, which is what invites the next reviewer to rank by appearance again. Nothing is
 * appended below a pool: that is only safe when the appended rung is weaker than everything IN it.
 *
 * Common to all three: the gloss leads, and no rung sits below one that yields more. The gloss is
 * the only rung about the ANSWER rather than the clue, and the only one this type does not compose
 * itself, so it is the only one passing a content gate.
 *
 * A charade ships no letter rung, because the parts concatenate to the answer in clue order, so
 * the first part's first letter IS the answer's and shipping both spends a hint twice. Its
 * all-parts rung and a deletion's source rung are COMPLETE SOLVES and sit at the bottom. A double
 * definition ships no quoting rung, both halves being on screen with neither distinguishable as
 * "the definition", and its letter rung is the STRONGEST of its three, because with two straight
 * definitions a letter plus a length is a lookup.
 *
 * A rung that quotes the clue quotes a SLICE rather than pointing at one, and HintMetadata gains
 * no member from this type: a substring degrades to no highlight, an offset to a WRONG one that
 * points the player at the wrong half of the puzzle.
 *
 * NEVER THROWS. Returns undefined with a logged reason instead.
 */
export const buildHints = (verified: VerifiedClue): HintLadder | undefined => {
  const { answer, clue, gloss } = verified
  if (answer.length < MIN_ANSWER_LENGTH || answer.length > MAX_ANSWER_LENGTH) {
    logError('Cryptic answer outside the shortlist band', { answer, reason: 'answer-not-on-shortlist' })
    return undefined
  }

  const slice = (span: ClueSpan): string => clue.slice(span.start, span.end)

  // The UNION of both halves on a double definition: gatedGloss's restates-the-definition rule must
  // reject a gloss leaning on either. Derived rather than destructured, because `definitionSpan`
  // does not exist on every arm of VerifiedClue. Must stay equal to generator.ts's derivation.
  const definition =
    verified.device === 'doubledefinition'
      ? verified.definitionSpans.map(slice).join(' ')
      : slice(verified.definitionSpan)

  // Once, above the pools: gatedGloss logs on every drop, so calling it inside each arm would be
  // three call sites for one line, and a duplicate log the day an arm evaluates two of them.
  const glossRung = gatedGloss(gloss, answer, definition, 'generator')

  // The word the phrase is about, and the text it may not restate. On charade and deletion the
  // target is a word verify proved absent from the clue and the forbidden text is the cue that
  // already means it; a double definition prints both halves, so its target is the answer and it
  // forbids both halves plus the gloss above it.
  const [wordTarget, forbidden]: [string, WordGlossForbids] =
    verified.device === 'charade'
      ? [verified.parts[0].text, { slices: [slice(verified.parts[0].cueSpan)] }]
      : verified.device === 'deletion'
        ? [verified.source.text, { slices: [slice(verified.source.cueSpan)] }]
        : [answer, { prose: glossRung, slices: verified.definitionSpans.map(slice) }]

  // Composed from the GATED phrase, never the raw field, so a dropped phrase is an absent rung
  // rather than a frame wrapped around nothing.
  const gatedPhrase = gatedWordGloss(verified.wordGloss, wordTarget, answer, forbidden, 'generator')
  const wordGlossRung = gatedPhrase === undefined ? undefined : `${WORD_GLOSS_FRAMES[verified.device]}${gatedPhrase}.`

  // One character of the answer. Composed above the switch because two pools share it and its rank
  // differs on every device -- absent on charade, third of four on deletion, last on double
  // definition -- so the three placements are visibly placements of the same string.
  const letterRung = `${BEGINS_FRAME}${answer[0]}.`

  // The pool for this device, WEAKEST FIRST so taking a prefix preserves the escalation. Every arm
  // ends with an unconditional entry, so no pool can be empty, which is what makes the ladder's
  // non-empty type honest, and that last entry is also its strongest. hints.test.ts names the
  // winner per shape rather than deriving it, since a derivation would re-encode this order.
  const pool = (
    verified.device === 'charade'
      ? [
          glossRung,
          wordGlossRung,
          `${FIRST_PART_FRAME}${verified.parts[0].text}.`,
          `${ALL_PARTS_FRAME}${verified.parts.map((part) => part.text).join(' + ')}.`,
        ]
      : verified.device === 'deletion'
        ? [glossRung, wordGlossRung, letterRung, `${SOURCE_FRAME}${verified.source.text}.`]
        : [glossRung, wordGlossRung, letterRung]
  ).filter((text): text is string => text !== undefined)

  // The first three and never a fourth. A pool longer than the ladder is what lets a rung drop
  // without shortening the ladder, and taking a PREFIX is what makes "weakest first" and
  // "strongest last" the same statement.
  const texts = pool.slice(0, MAX_HINT_RUNGS)

  // A ladder may be shorter than three; this is the lower bound, not the count, and cannot fire
  // while every pool ends with an unconditional entry. It is the code-defect gate on the property
  // HintLadder's non-empty type depends on, so a future drop rule over a pool's last entry becomes
  // a logged rejection instead of an empty array that typechecks.
  if (texts.length === 0) {
    logError('The cryptic rung pool ran dry', { available: texts.length, reason: 'rung-pool' })
    return undefined
  }

  // G1-G4 on the COMPOSED rung. G5 is waived BY ROLE (`answer` omitted, never passed empty) and
  // MUST stay waived: a charade's parts concatenate to the answer by verify step 10, so the leak
  // gate would reject every charade, and verify step 11's inflection check is the replacement. The
  // gloss already had G5 run over it in gatedGloss -- do not "unify" the two passes, because the
  // waiver here is what lets the part rungs exist.
  const gated = texts.every((text) => passesStringGates({ maxLength: MAX_CRYPTIC_RUNG_LENGTH, value: text }))
  if (!gated) {
    logError('A cryptic rung failed the string gates', { reason: 'rung-gate', texts })
    return undefined
  }

  // Mapped rather than spread into a literal naming three indices, which would ship
  // `{ text: undefined }` as a third rung on a two-rung ladder -- typechecking, rendering empty and
  // telling nobody. The cast carries the non-emptiness the gate above proved, which `map` loses.
  return texts.map((text) => ({ text })) as HintLadder
}
