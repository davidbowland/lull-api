/**
 * The whole check on one model-proposed cryptic clue.
 *
 * Code proves the wordplay reaches the answer. Nothing in this repo proves the definition means the
 * answer. A clue whose wordplay decomposes perfectly and whose definition points elsewhere is
 * unsolvable by the intended route and indistinguishable from a correct puzzle to every check here.
 * The measurement for that is scripts/audit-cryptic.ts; the exit condition is in the spec.
 */
// WHY THE COVER IS TOTAL, stated as a theorem so it can be re-checked rather than believed:
//
//   After step 1, `clue` is t1 ... tn -- maximal letter-runs separated by single spaces, with no
//   leading, trailing or doubled space and no character outside [A-Za-z ]. After step 6 every index
//   in 1...n belongs to the definition range, the indicator range, the fodder range, the inner seam
//   or the outer seam; the two seams hold at most one token each and each of those tokens is in
//   CONNECTIVES. Therefore n = |definition| + |indicator| + |fodder| + r with r <= 2, and there is
//   no token the decomposition does not name. Step 7 bounds the definition at 4 tokens with at least
//   one substantive; step 8 pins the indicator to a committed list entry; step 10 pins the fodder to
//   exactly the tokens the derivation consumes -- for `anagram` by letter-multiset equality, for
//   `hidden` by requiring the run to begin strictly inside the first fodder token and end strictly
//   inside the last.
//
// THE TIER B CLAIM RESTS ON THAT PARAGRAPH AND NOT ON THE DEVICE NARROWING. Restricting the device
// set makes the FODDER checkable; it does nothing about the fodder being a string beside the clue
// rather than a part of it. A proof about a string that is not the artifact is not a proof.
//
// The two clauses doing the load-bearing work are the ones a later relaxation will reach for first,
// so they are named: `residue-out-of-position`, which is what makes the check a partition, and the
// `hidden` fodder-boundary pair, which is what stops residue relocating INSIDE a span. Removing
// either restores a leak in a form that passes every remaining test. Both leaked, in two independent
// verification passes, before they were written this way.
//
// No shared decomposition-verifier.ts, now or later. Phase 2's Alphametics shares the "model
// proposes, code disposes" shape and not the mechanism -- its proposal is re-derivable by brute
// force and needs no cover check at all. One type, one verifier.
import { normalizeAnswer } from '../../rules/normalize-answer'
import { ClueSpan, CrypticDevice } from '../../types'
import { log } from '../../utils/logging'
import { containsAnswerToken } from '../../utils/model-output-checks'
import { crypticIndicators } from './indicators'

// A WHITELIST, and deliberately not isSafeProse's blocklist. It is character-for-character the
// foundation's G6 charset (isTypeable), and it is declared here rather than imported because G6's
// "applies to" is a ROLE -- "the one string the player types" -- which a clue is not. Same set, two
// reasons, and they may diverge.
//
// `,` `'` and `-` were on this list and are STRUCK. They are invisible to normalizeAnswer, which is
// the same rationale that excludes everything else here, and they made a whitespace split and the
// repo's letter-run tokenizer DISAGREE on residue -- a run of them yields zero letter-run tokens and
// passes as invisible residue, while a whitespace split makes it a token that is not a connective
// and rejects. So the cover's totality depended on which tokenizer an implementer reached for, which
// is not a property, it is a coin toss. Widening this regex re-opens that, and foldWithOffsets below
// assumes every admitted character folds to exactly zero or one character.
//
// Anchored, and the anchors are enough: JS `$` is NOT newline-tolerant without the `m` flag.
// Measured on this checkout's node: /^[A-Za-z ]+$/.test('Dance\n') === false. Two reviews concluded
// otherwise; the finding is recorded as corrected rather than acted on. What the anchored form DOES
// admit is a leading or trailing space, which step 0's trim equality rejects.
const CLUE_CHARSET = /^[A-Za-z ]+$/

// A cryptic clue is short by convention; a long one is a generation that ran away. Per-field, per
// gate G2 -- not the 200-character hint cap.
export const MAX_CLUE_LENGTH = 120

// A TOKEN cap, where MAX_HINT_LENGTH, MAX_CATEGORY_LENGTH and MAX_TEXT_LENGTH are all CHARACTER
// caps. Sound because the definition is a substring of an already-length-gated clue, so
// MAX_CLUE_LENGTH bounds it transitively; a five-word definition is not a definition. Stated rather
// than left as an inconsistency, because the definition rung's length arithmetic depends on it.
export const MAX_DEFINITION_TOKENS = 4

// ONE token at each seam. Two constants because they bound two different seams, and a single shared
// number would make a change to either silently change the other.
export const MAX_TOKENS_BETWEEN_INDICATOR_AND_FODDER = 1
export const MAX_TOKENS_BETWEEN_DEFINITION_AND_WORDPLAY = 1

export const CRYPTIC_DEVICES: readonly CrypticDevice[] = ['anagram', 'hidden']

// The SEAM alphabet, not the residue alphabet: a token outside a seam is residue-out-of-position
// whatever it says. "found in", "held by" and "part of" are INDICATORS, not connectives -- they
// signal a device, so they belong on the per-device list where the predicate has to agree with them.
export const CONNECTIVES: ReadonlySet<string> = new Set([
  'A',
  'AN',
  'BY',
  'FOR',
  'FROM',
  'GIVES',
  'IN',
  'IS',
  'MAKES',
  'OF',
  'THE',
  'TO',
  'WITH',
])

// CLOSED, exported, logged and counted, because the cheap kill criterion reads it and verify.test.ts
// asserts that the set of codes its table exercises EQUALS this list. A clause added without a row,
// or a code declared without a clause, fails the suite -- in BOTH directions, which an
// omission-shaped assertion could not do.
//
// `not-word-aligned` is deliberately absent: step 4 locates parts as TOKEN SEQUENCES, so `in` cannot
// match inside `instant` and the alignment it enforced is structural rather than checked.
export const REJECTION_REASONS = [
  'answer-not-on-shortlist',
  'answer-token',
  'charset',
  'definition-not-at-end',
  'definition-not-substantive',
  'definition-too-long',
  'derivation-failed',
  'malformed-clue',
  'malformed-item',
  'no-indicator',
  'no-unique-span',
  'not-adjacent',
  'overlapping-spans',
  'residue-out-of-position',
  'too-long',
  'uncovered-token',
  'unknown-device',
  'unknown-fodder-word',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]

// `indicatorSpan` IS NOT A WIRE FIELD and must not become one -- endpoints.rest says so in as many
// words, and the reason still holds: the client has `device`, and a span with no renderer rots. It
// exists here because buildHints has to decide whether the device rung is telling the player
// something the indicator already told them, and that question is about WHICH indicator this clue
// used. Derived at step 9 from the same range the cover check ran over, so it cannot disagree with
// the decomposition that was proved.
//
// `gloss` IS OPTIONAL, AND UNGATED HERE, and both halves of that are deliberate.
//
// Optional, because a missing or unusable gloss must cost the RUNG and never the puzzle. Putting it
// on STRING_FIELDS would throw away a clue whose wordplay decomposes perfectly because the model
// forgot one field -- the opposite of CLAUDE.md's isolation rule, applied one level below the
// generator.
//
// Ungated, because the checks it needs are not this file's: they need the DEFINITION SLICE and the
// answer, with G5's polarity REVERSED from the one step 11 applies to the clue. hints.ts owns the
// pool and therefore owns the gate, and the rung simply drops. What this file guarantees is only
// that a `gloss` present here is a non-empty trimmed string.
export interface VerifiedClue {
  answer: string
  clue: string
  definitionSpan: ClueSpan
  device: CrypticDevice
  fodderSpan: ClueSpan
  gloss?: string
  indicatorSpan: ClueSpan
}

// A clue token and where it sits in the RAW string. Both coordinate systems in one place, because
// mixing them is what readmitted TANGO inside TANGOS in the first version of this verifier.
export interface ClueToken {
  end: number
  folded: string
  start: number
}

// INCLUSIVE token indices. Kept apart from ClueSpan on purpose: one indexes tokens, the other
// indexes characters, and the first version of this verifier mixed exactly two such coordinate
// systems.
interface TokenRange {
  first: number
  last: number
}

// Valid ONLY on a string that has cleared step 1: maximal letter runs separated by single spaces. On
// such a string this is identical to the repo's shared letter-run tokenizer, which is what the
// charset narrowing bought and what verify.test.ts asserts as a property, with a control on a string
// the charset excludes.
export const tokensOf = (clue: string): ClueToken[] => {
  const tokens: ClueToken[] = []
  let start = 0
  for (const raw of clue.split(' ')) {
    tokens.push({ end: start + raw.length, folded: raw.toUpperCase(), start })
    start += raw.length + 1
  }
  return tokens
}

// Case is folded on BOTH sides for the search; the RAW offsets of the matched tokens become the
// span. A part with an internal double space produces an empty needle token, which cannot equal any
// clue token, so it lands here as no-unique-span rather than needing a clause of its own.
//
// UNIQUENESS IS ABOUT LOCATING THIS PARSE'S STRINGS UNAMBIGUOUSLY, not about the clue admitting
// exactly one decomposition. The verifier never SEARCHES for a parse; it checks the parse the model
// supplied.
const locate = (tokens: ClueToken[], part: string): TokenRange | undefined => {
  const needle = part.toUpperCase().split(' ')
  const matches: TokenRange[] = []
  for (let first = 0; first + needle.length <= tokens.length; first += 1) {
    const hit = needle.every((token, offset) => tokens[first + offset].folded === token)
    if (hit) {
      matches.push({ first, last: first + needle.length - 1 })
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

const overlaps = (left: TokenRange, right: TokenRange): boolean => left.first <= right.last && right.first <= left.last

const inRange = (range: TokenRange, index: number): boolean => index >= range.first && index <= range.last

const spanOf = (tokens: ClueToken[], range: TokenRange): ClueSpan => ({
  end: tokens[range.last].end,
  start: tokens[range.first].start,
})

/**
 * The fold and its inverse, built in one pass.
 *
 * Every character CLUE_CHARSET admits folds to exactly zero characters (the space) or one (a
 * letter), so rawAt[i] is total and unambiguous -- which is true ONLY because `,` `'` and `-` are
 * struck from the charset. KEEP THIS HELPER AND THE CHARSET TOGETHER: widening one without the other
 * is how the coordinate bug comes back. The first version of this section stated f =
 * normalizeAnswer(raw) and then indexed the RAW slice with an offset taken from the NORMALIZED one;
 * normalizeAnswer is not length-preserving, so there was no such offset, and one of the two obvious
 * guesses readmits TANGO inside TANGOS.
 */
export const foldWithOffsets = (raw: string): { folded: string; rawAt: number[] } => {
  const folded: string[] = []
  const rawAt: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (character === ' ') {
      continue
    }
    folded.push(character.toUpperCase())
    rawAt.push(index)
  }
  return { folded: folded.join(''), rawAt }
}

const sortedLetters = (value: string): string => [...value].sort().join('')

/**
 * The two device predicates, EXHAUSTIVE on CrypticDevice -- so a third device cannot be added
 * without the compiler naming this site.
 *
 * Both take the RAW fodder slice out of the clue and the shortlist answer, and nothing else: step 9
 * has already thrown the model's part strings away.
 */
export const devicePredicates: Record<CrypticDevice, (fodder: string, answer: string) => boolean> = {
  // Multiset equality already forces every fodder letter to be consumed by the answer, so a padding
  // connective can only appear in the fodder if its letters are the answer's. THE DEVICE BOUNDS
  // ITSELF, which is why there is no boundary clause and no MAX_FODDER_TOKENS here. That looks like
  // an omission and is not.
  anagram: (fodder, answer) => {
    const { folded } = foldWithOffsets(fodder)
    const target = normalizeAnswer(answer)
    return folded !== target && sortedLetters(folded) === sortedLetters(target)
  },
  hidden: (fodder, answer) => {
    const { folded, rawAt } = foldWithOffsets(fodder)
    const target = normalizeAnswer(answer)
    const index = folded.indexOf(target)
    // Includes it, exactly once so the reveal is unambiguous, and is not the whole of the fodder.
    if (index < 0 || index !== folded.lastIndexOf(target) || folded === target) {
      return false
    }
    const start = rawAt[index]
    const end = rawAt[index + target.length - 1]
    const firstTokenEnd = fodder.indexOf(' ')
    const lastTokenStart = fodder.lastIndexOf(' ') + 1
    return (
      // The answer spans a word break. Stated in RAW offsets, which is the only coordinate system a
      // space exists in: TANGO inside TANGOS has no space between its first and last letter.
      fodder.slice(start + 1, end).includes(' ') &&
      // Strictly inside the FIRST fodder token -- after its first character, before its end. At
      // least one letter of padding on the left, AND the fodder does not begin with a word the run
      // never enters.
      start > 0 &&
      firstTokenEnd > 0 &&
      start < firstTokenEnd &&
      // The same on the right, and THIS is the clause that rejects fodder "instant angora of the":
      // the case where residue relocates inside a span, where the cover cannot see it. The last
      // fodder token runs to fodder.length - 1, so a run ending there ends AT the token's end rather
      // than strictly inside it. insTANt ANGOra ends at index 11 of 14, two characters clear.
      end > lastTokenStart &&
      end < fodder.length - 1
    )
  },
}

// NOT in utils/model-output-checks.ts. A third rule in that module with the same signature and a
// third polarity is exactly the hazard the import guard on this directory exists for.
//
// Total over the suffixes it enumerates and NOT total over English morphology, which is the honest
// statement and the reason it is a list rather than a stemmer. It is cheap and safe because the
// answer is a single lemma of 4-8 letters: there is no irregular plural to miss on the ANSWER's
// side, only on the clue's. The reverse direction -- the clue holding the answer's stem -- cannot
// arise, because nouns.ts is a list of lemmas, so the answer is never itself an inflected form.
// EXPORTED for hints.ts, which runs the same list over the GLOSS with the opposite polarity. Step 11
// below asks "does the clue hand the answer over in its surface", knowing the clue legitimately
// carries the answer's letters; the gloss check asks "does this sentence name the answer", where any
// occurrence at all is a failure. One list, because two would drift and the inflections are a
// property of English rather than of either call site.
export const crypticInflections = (answer: string): string[] => [
  answer,
  `${answer}S`,
  `${answer}ES`,
  `${answer}D`,
  `${answer}ED`,
  `${answer}ING`,
  `${answer.replace(/E$/, '')}ING`,
  `${answer.replace(/Y$/, 'I')}ES`,
]

const PART_FIELDS = ['definition', 'fodder', 'indicator'] as const
const STRING_FIELDS = ['answer', 'clue', 'device', ...PART_FIELDS] as const

// The default sink. A rejection says WHICH CLAUSE fired rather than reading as "the model is bad at
// cryptics", and the offending token travels with it -- which is what makes "the indicator list
// grows by reading rejection logs" a bounded operation rather than a direction.
const logRejection = (reason: RejectionReason, detail: Record<string, unknown>): void => {
  log('Rejected a cryptic candidate', { ...detail, reason, type: 'crypticclue' })
}

/**
 * Returns undefined with a logged reason; never throws, never partially accepts.
 *
 * `answers` is the shortlist drawn for THIS call, keyed by normalizeAnswer, mapping to the
 * code-supplied spelling -- which is the string that reaches VerifiedClue.answer. The model's
 * `answer` field is a key into this map and nothing else.
 *
 * `isKnownWord` is a PARAMETER rather than an import so this module stays pure and nothing lexical
 * is reachable from it; generator.ts builds the Set once at module scope.
 *
 * `onReject` is injected so the caller can COUNT reasons as well as log them: the funnel line
 * carries a per-reason count and a three-parameter signature has no channel for one. The default
 * logs, so every other caller and every test gets the specified behavior for free.
 */
export const verifyClue = (
  candidate: unknown,
  answers: ReadonlyMap<string, string>,
  isKnownWord: (word: string) => boolean,
  onReject: (reason: RejectionReason, detail: Record<string, unknown>) => void = logRejection,
): VerifiedClue | undefined => {
  // Step 0. This exists because the tool schema asserts nothing, and because "abc".indexOf("") is 0
  // -- an empty part string would otherwise be LOCATED successfully and rejected, if at all, by
  // accident. It also carries the clue's trim equality: a clue differing from its own trim() is
  // REJECTED here rather than trimmed, so the string the verifier proves and the string that is
  // stored are the same bytes and no span can be invalidated by a normalization nobody remembered.
  const item = candidate as Record<string, unknown>
  for (const field of STRING_FIELDS) {
    const value = item?.[field]
    if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
      onReject('malformed-item', { field })
      return undefined
    }
  }

  const clue = item.clue as string
  // Step 1. The double-space half of the clue's shape rule; the trim half is subsumed by step 0
  // above and fires there as `malformed-item`, which is where a shape failure belongs. Both are
  // rejections rather than rewrites for the same reason.
  if (clue.includes('  ')) {
    onReject('malformed-clue', { clue })
    return undefined
  }
  if (!CLUE_CHARSET.test(clue)) {
    onReject('charset', { clue })
    return undefined
  }
  if (clue.length > MAX_CLUE_LENGTH) {
    onReject('too-long', { length: clue.length })
    return undefined
  }

  // Step 2, and it is SECOND because three later things take the answer's length and single-token
  // shape as established: hints.ts's shortlist-band check, the enumeration, and the hidden boundary
  // clauses.
  // The map is keyed by normalizeAnswer, so "exactly one of the forty" is structural rather than
  // counted -- and `answer` from here on is the CODE-SUPPLIED spelling.
  const answer = answers.get(normalizeAnswer(item.answer as string))
  if (answer === undefined) {
    onReject('answer-not-on-shortlist', { answer: item.answer })
    return undefined
  }

  // Step 3. `device` arrives typed string at the boundary and is narrowed here, so a drifted tag
  // costs one candidate rather than the batch. Never an enum in the tool schema.
  const device = item.device as CrypticDevice
  if (!CRYPTIC_DEVICES.includes(device)) {
    onReject('unknown-device', { device: item.device })
    return undefined
  }

  const definitionTokens = (item.definition as string).split(' ')
  if (definitionTokens.length > MAX_DEFINITION_TOKENS) {
    onReject('definition-too-long', { tokens: definitionTokens.length })
    return undefined
  }

  // Step 4. Locating by TOKEN SEQUENCE rather than by substring is what makes `in` fail to match
  // inside `instant`, and it is what made the old `not-word-aligned` code unreachable.
  const tokens = tokensOf(clue)
  const definitionRange = locate(tokens, item.definition as string)
  const indicatorRange = locate(tokens, item.indicator as string)
  const fodderRange = locate(tokens, item.fodder as string)
  if (definitionRange === undefined || indicatorRange === undefined || fodderRange === undefined) {
    onReject('no-unique-span', {
      definition: definitionRange !== undefined,
      fodder: fodderRange !== undefined,
      indicator: indicatorRange !== undefined,
    })
    return undefined
  }

  // Step 5.
  const ranges = [definitionRange, indicatorRange, fodderRange]
  const disjoint = ranges.every((range, index) =>
    ranges.every((other, otherIndex) => index === otherIndex || !overlaps(range, other)),
  )
  if (!disjoint) {
    onReject('overlapping-spans', { clue })
    return undefined
  }

  // Step 6 -- THE COVER. A partition, not a coverage test: every token index belongs to the
  // definition range, the indicator range, the fodder range, the inner seam or the outer seam, and
  // ANYTHING ELSE is residue-out-of-position. Remove that last clause and the check stops being a
  // partition -- `A the in of from by to gives Dance hidden in instant angora` then clears all
  // thirteen steps, and so does one trailing `with`.
  const wordplay = {
    first: Math.min(indicatorRange.first, fodderRange.first),
    last: Math.max(indicatorRange.last, fodderRange.last),
  }
  const definitionFirst = definitionRange.last < wordplay.first
  const definitionLast = definitionRange.first > wordplay.last
  if (!definitionFirst && !definitionLast) {
    onReject('definition-not-at-end', { clue })
    return undefined
  }

  const covered = {
    first: Math.min(definitionRange.first, wordplay.first),
    last: Math.max(definitionRange.last, wordplay.last),
  }
  const indices = tokens.map((_token, index) => index)
  // TESTED BEFORE THE SEAM CHECKS, and the order is not arbitrary: a trailing `with` reports its
  // true cause -- a token outside every range -- rather than reading as an over-long seam.
  const residue = indices.filter((index) => !inRange(covered, index))
  if (residue.length > 0) {
    onReject('residue-out-of-position', { tokens: residue.map((index) => tokens[index].folded) })
    return undefined
  }

  const inner = indices.filter(
    (index) => inRange(wordplay, index) && !inRange(indicatorRange, index) && !inRange(fodderRange, index),
  )
  const outer = indices.filter(
    (index) => inRange(covered, index) && !inRange(wordplay, index) && !inRange(definitionRange, index),
  )
  if (
    inner.length > MAX_TOKENS_BETWEEN_INDICATOR_AND_FODDER ||
    outer.length > MAX_TOKENS_BETWEEN_DEFINITION_AND_WORDPLAY
  ) {
    onReject('not-adjacent', { inner: inner.length, outer: outer.length })
    return undefined
  }

  const uncovered = [...inner, ...outer].filter((index) => !CONNECTIVES.has(tokens[index].folded))
  if (uncovered.length > 0) {
    onReject('uncovered-token', { tokens: uncovered.map((index) => tokens[index].folded) })
    return undefined
  }

  // Step 7. A FLOOR, not another ceiling: at least one definition token that is neither a connective
  // nor a single-token entry of this device's indicator list. definition="The" cleared every other
  // clause. "The definition is a function word" is a STRING property this repo can decide -- unlike
  // "the definition MEANS the answer", which is the named residual risk at the top of this file.
  const substantive = definitionTokens.some(
    (token) => !CONNECTIVES.has(token.toUpperCase()) && !crypticIndicators[device].has(token.toLowerCase()),
  )
  if (!substantive) {
    onReject('definition-not-substantive', { definition: item.definition })
    return undefined
  }

  // Step 8. A whole TOKEN SEQUENCE against the committed list, never a substring: `part of` matches
  // as two adjacent tokens and INSIDER does not match INSIDE. Requiring the CLAIMED device's list
  // and the CLAIMED device's predicate to agree is what makes the surface and the mechanism the same
  // puzzle -- inferring the device instead would ship a clue whose indicator says "shaken" over
  // fodder that happens to hide the answer, cheating the player who read the indicator correctly.
  const indicatorEntry = tokens
    .slice(indicatorRange.first, indicatorRange.last + 1)
    .map((token) => token.folded.toLowerCase())
    .join(' ')
  if (!crypticIndicators[device].has(indicatorEntry)) {
    onReject('no-indicator', { device, indicator: indicatorEntry })
    return undefined
  }

  // Step 9. THE MODEL'S PART STRINGS ARE THROWN AWAY. From here the verifier reads only `clue`, the
  // three spans and the shortlist word. There is no second copy of the text for a model to make
  // disagree with the first.
  const definitionSpan = spanOf(tokens, definitionRange)
  const fodderSpan = spanOf(tokens, fodderRange)
  const indicatorSpan = spanOf(tokens, indicatorRange)

  // Step 10.
  const fodder = clue.slice(fodderSpan.start, fodderSpan.end)
  if (!devicePredicates[device](fodder, answer)) {
    onReject('derivation-failed', { device, fodder })
    return undefined
  }

  // Step 11. G5 is waived BY ROLE here -- a cryptic clue legitimately contains its answer's letters,
  // so the answer-LEAK gate in utils/model-output-checks.ts must never run over this string, which
  // is what the ESLint rule and imports.test.ts hold -- and this is its replacement. Over a BOUNDED
  // INFLECTION SET, because the shared tokenizer has no stemming and
  // containsAnswerToken('TANGO', 'Dances tangos in instant angora') is false while that clue hands
  // the player the answer in the surface.
  const leaked = crypticInflections(answer).filter((form) => containsAnswerToken(form, clue))
  if (leaked.length > 0) {
    onReject('answer-token', { leaked })
    return undefined
  }

  // Step 12. Every fodder token has to be a word. The separate check over the DEFINITION slice is
  // struck: spans hold whole tokens, so the definition's token set is a subset of the clue's.
  const unknown = tokens
    .slice(fodderRange.first, fodderRange.last + 1)
    .map((token) => token.folded.toLowerCase())
    .filter((word) => !isKnownWord(word))
  if (unknown.length > 0) {
    onReject('unknown-fodder-word', { unknown })
    return undefined
  }

  // The gloss rides along UNJUDGED except for its shape -- see the note on VerifiedClue. A value of
  // any other type, or one that is empty or untrimmed, becomes `undefined` here rather than a
  // rejection, so the clue survives and the ladder is one rung shorter.
  const raw = item.gloss
  const gloss = typeof raw === 'string' && raw.trim() !== '' && raw === raw.trim() ? raw : undefined

  return { answer, clue, definitionSpan, device, fodderSpan, gloss, indicatorSpan }
}
