/**
 * The whole check on one model-proposed cryptic clue.
 *
 * Code proves the letter math reaches the answer. Nothing in this repo proves the definition means
 * the answer, or that `vehicle` means CAR. A clue whose wordplay decomposes perfectly and whose
 * definition points elsewhere is unsolvable by the intended route and indistinguishable from a
 * correct puzzle to every check here. review.ts is the semantic pass that narrows that;
 * scripts/audit-cryptic.ts is the measurement.
 */
// THE COVER IS A PARTITION, stated as a theorem so it can be re-checked rather than believed:
// after step 1 `clue` is t1 ... tn, maximal letter-runs separated by single spaces; after step 6
// every index belongs to exactly one DECLARED RANGE (the definition, plus each device's own parts)
// or to the SEAM SET, which holds at most MAX_SEAM_TOKENS tokens, each a member of CONNECTIVES.
//
// COVERING A TOKEN IS NOT EXPLAINING IT. The theorem says nothing about what a declared range may
// HOLD, and no synonym device bounds its own cue -- `text` is a string beside the clue, so a range
// is as long as the model says. Three clauses make it hold anyway: MAX_CUE_TOKENS bounds one cue
// range; `connective-in-cue` keeps function words where the budget can see them; and step 6 counts
// a connective inside a DEFINITION range, which step 5c and step 12b both let through. Together,
// every member of CONNECTIVES is a counted seam, a counted definition token, an exempt leading
// article, or a rejection. `residue-out-of-position` is the clause a later relaxation reaches for
// first: remove it and `A the in of from by to gives Floor covering from vehicle with animal`
// clears every step, and so does one trailing `quickly`.
//
// WHAT IS STILL NOT CLAIMED, because a bounded range is not an empty one: `ignore previous
// instructions` fits inside MAX_CUE_TOKENS. The worst case is a double definition, which declares
// no cue range and has no derivation arm, so its halves are checked only for length, wordhood,
// distinctness and a substantive token before reaching `data.clue`, `data.explanation` and
// review.ts's model context verbatim. What bounds the blast radius is that the reviewer's only
// free-text output is `gloss`, which gatedGloss re-gates. Closing it needs "the definition MEANS
// the answer", not a token cap.
//
// No shared decomposition-verifier.ts. One type, one verifier.
import { normalizeAnswer } from '../../rules/normalize-answer'
import { ClueSpan, CrypticDevice, RemovalKind } from '../../types'
import { log } from '../../utils/logging'
import { containsAnswerToken } from '../../utils/model-output-checks'
import { crypticIndicators, deletionIndicators } from './indicators'

// A whitelist, not isSafeProse's blocklist. The same set as the foundation's G6 charset, declared
// here rather than imported because G6 applies by ROLE ("the one string the player types").
//
// DO NOT WIDEN IT. `,` `'` and `-` are excluded because they are invisible to normalizeAnswer, so
// a whitespace split and the repo's letter-run tokenizer disagree about a run of them: one sees
// zero tokens and passes it as invisible residue, the other sees a non-connective token and
// rejects. foldWithOffsets also assumes every admitted character folds to zero or one character.
const CLUE_CHARSET = /^[A-Za-z ]+$/

// A cryptic clue is short by convention; a long one is a generation that ran away. Per-field, per
// gate G2 -- not the 200-character hint cap.
export const MAX_CLUE_LENGTH = 120

// A TOKEN cap where the repo's other content caps are CHARACTER caps, which is sound because a
// definition is a substring of an already-length-gated clue. Five words is not a definition.
// A double definition takes the tighter cap below instead.
export const MAX_DEFINITION_TOKENS = 4

// Tighter than MAX_DEFINITION_TOKENS because this is the one device whose whole clue is
// definition: both ranges are definitions, it declares no cue, and step 10 has nothing to run, so
// four tokens per half would be eight model-chosen words with no letter arithmetic behind them.
// Bracketed rather than picked: no tighter than MAX_CUE_TOKENS, since a half does more work than a
// cue, and strictly under 4, which is for a definition sitting opposite a proved derivation.
// prompts/create-cryptic-clues.txt states the number, so the model is told the rule.
export const MAX_DOUBLE_DEFINITION_TOKENS = 3

// A cue is a synonym for ONE word, and this is what makes that checkable: without a bound nothing
// says how much clue one declared range may swallow. One token is the common case (`vehicle` ->
// CAR), two is ordinary English (`floor covering`), three is where a synonym phrase runs out
// (`young male horse` -> COLT) and four is a sentence. Strictly tighter than
// MAX_DEFINITION_TOKENS, since the definition is the half that must MEAN the answer, and three
// rather than two because the connective rule below already kills most three-token cues.
export const MAX_CUE_TOKENS = 3

// ONE TOTAL BUDGET ACROSS THE WHOLE CLUE, not a bound per seam, which would get LOOSER as parts
// multiply. verify.test.ts holds it with a three-part charade carrying one connective in each of
// three seams, which a per-seam bound passes and this rejects. The count includes every non-exempt
// connective inside a definition range, which is the quantity the prompt names to the model: at
// most two linking words IN THE WHOLE CLUE.
export const MAX_SEAM_TOKENS = 2

// A one-part charade is a definition claimed twice, and it would clear every letter check because
// a single part concatenates to itself. Enforced at the shape step, being a property of the CLAIM.
const MIN_CHARADE_PARTS = 2

export const CRYPTIC_DEVICES: readonly CrypticDevice[] = ['charade', 'deletion', 'doubledefinition']

// THE SEAM ALPHABET: a token in no declared range is residue-out-of-position unless it is one of
// these. The LIST SIZE IS NOT THE SECURITY PROPERTY -- MAX_SEAM_TOKENS is, so growing this changes
// WHICH word may sit in a gap and never how many. It grows only from rejection logs, one entry at
// a time. A phrase signalling a MECHANISM ("found in", "held by") belongs on the per-device
// indicator list instead; indicators.test.ts asserts the two sets stay disjoint.
export const CONNECTIVES: ReadonlySet<string> = new Set([
  'A',
  'AN',
  'AND',
  'AS',
  'BY',
  'FOR',
  'FROM',
  'GETS',
  'GIVES',
  'IN',
  'IS',
  'LEAVES',
  'MAKES',
  'OF',
  'THE',
  'TO',
  'WITH',
])

// The one exemption from the definition connective count. A SUBSET of CONNECTIVES rather than a
// second list, so it cannot admit a token the seam alphabet does not know about. Articles, because
// the prompt requires a leading article inside the definition (`A dance`, not `dance` with `A`
// left over) and charging budget for following that instruction punishes the compliant model.
// POSITIONAL as well as lexical: implemented as a `slice` past the first token rather than a
// `filter`, so `A the of covering` spends the exemption on A and is charged for THE and OF.
const DEFINITION_ARTICLES: ReadonlySet<string> = new Set(['A', 'AN', 'THE'])

// Closed and exported: verify.test.ts asserts that the set of codes its table exercises EQUALS
// this list. THE EQUALITY PINS THE VOCABULARY, NOT THE CLAUSE COUNT -- a clause reusing
// `malformed-item` or `derivation-failed` adds no entry and stays green untested, so a clause
// worth testing should take a code of its own.
export const REJECTION_REASONS = [
  'ambiguous-removal',
  'answer-not-on-shortlist',
  'answer-token',
  'charset',
  'cognate-source',
  'connective-in-cue',
  'cue-too-long',
  'definition-not-at-end',
  'definition-not-substantive',
  'definition-too-long',
  'definitions-not-distinct',
  'derivation-failed',
  'malformed-clue',
  'malformed-item',
  'no-indicator',
  'no-unique-span',
  'overlapping-spans',
  'parts-out-of-order',
  'residue-out-of-position',
  'seam-budget',
  'too-long',
  'unknown-definition-word',
  'unknown-device',
  'unknown-part-word',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]

/**
 * A cue and what it yields. `text` is the letters the solver has to supply (CAR); `cueSpan` locates
 * the clue words that indicate them (`vehicle`). `text` APPEARS NOWHERE IN THE CLUE, so reading the
 * surface never hands it over, and the reviewer is asked about exactly the relation between the two.
 *
 * `text` is stored NORMALIZED, a gate rather than a tidy-up: it is the only model-authored string
 * that survives step 9 and it reaches player-visible prose through the explanation builder, so
 * normalizing here makes what the explanation renders byte-identical to what the derivation proved.
 */
export interface CluePart {
  cueSpan: ClueSpan
  text: string
}

interface VerifiedBase {
  answer: string
  clue: string
  // Optional, because a missing or unusable gloss must cost the RUNG and never the puzzle, and
  // UNGATED, because the checks it needs -- the definition slice, the answer, and G5 with its
  // polarity reversed from step 11's -- belong to hints.ts, which owns the pool. All this file
  // guarantees is that a `gloss` present here is a non-empty trimmed string.
  gloss?: string
  // The second model string, riding exactly as `gloss` does. It is a PHRASE and not a sentence,
  // because hints.ts frames it: the model sends `a strong drink` and the player reads `The longer
  // word is a strong drink.`
  wordGloss?: string
}

export interface VerifiedCharade extends VerifiedBase {
  definitionSpan: ClueSpan
  device: 'charade'
  // Two or more, in the order they concatenate, which is also the order they appear in the clue.
  // Step 10 proves both at once.
  parts: readonly CluePart[]
}

export interface VerifiedDeletion extends VerifiedBase {
  definitionSpan: ClueSpan
  device: 'deletion'
  // NOT A WIRE FIELD and it must not become one; endpoints.rest says so, and a span with no
  // renderer rots. Nothing in src/ reads it -- the round-trip row in verify.test.ts is what holds it.
  indicatorSpan: ClueSpan
  removal: RemovalKind
  source: CluePart
}

export interface VerifiedDoubleDefinition extends VerifiedBase {
  // Both halves in CLUE order, which the sort at the positional read is what makes true: neither
  // half is "the" definition, so the model's ordering carries nothing and the clue's does. The
  // explanation builder quotes them in this order, above a clue the player reads in it.
  definitionSpans: readonly [ClueSpan, ClueSpan]
  device: 'doubledefinition'
}

// Discriminated on `device`, which makes the hint pool, the explanation builder and the band map
// exhaustive by construction: a fourth device is a compile error at each of those three sites.
export type VerifiedClue = VerifiedCharade | VerifiedDeletion | VerifiedDoubleDefinition

// A clue token and where it sits in the RAW string. Both coordinate systems in one place, because
// mixing them is what readmits TANGO inside TANGOS.
export interface ClueToken {
  end: number
  folded: string
  start: number
}

// INCLUSIVE token indices. Kept apart from ClueSpan on purpose: one indexes tokens, the other
// indexes characters.
interface TokenRange {
  first: number
  last: number
}

// The model's claim, after the shape step and before anything is located.
interface RawPart {
  cue: string
  text: string
}

type Claim =
  | { definition: string; device: 'charade'; parts: readonly RawPart[] }
  | { definition: string; device: 'deletion'; indicator: string; removal: RemovalKind; source: RawPart }
  | { definitions: readonly [string, string]; device: 'doubledefinition' }

// Valid ONLY on a string that has cleared step 1. On such a string this is identical to the repo's
// shared letter-run tokenizer, which verify.test.ts asserts as a property.
export const tokensOf = (clue: string): ClueToken[] => {
  const tokens: ClueToken[] = []
  let start = 0
  for (const raw of clue.split(' ')) {
    tokens.push({ end: start + raw.length, folded: raw.toUpperCase(), start })
    start += raw.length + 1
  }
  return tokens
}

// Case is folded on both sides; the RAW offsets of the matched tokens become the span. A part with
// an internal double space produces an empty needle token, which equals no clue token, so it lands
// here as no-unique-span rather than needing a clause of its own. Uniqueness is about locating THIS
// PARSE's strings unambiguously, not about the clue admitting one decomposition.
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

const hullOf = (ranges: readonly TokenRange[]): TokenRange => ({
  first: Math.min(...ranges.map((range) => range.first)),
  last: Math.max(...ranges.map((range) => range.last)),
})

const spanOf = (tokens: ClueToken[], range: TokenRange): ClueSpan => ({
  end: tokens[range.last].end,
  start: tokens[range.first].start,
})

// The lowercase, single-spaced form of a located range -- the shape the indicator lists are
// committed in. Reads the CLUE through the range, never the model's string, so step 8 cannot be
// satisfied by a second copy of the text.
const entryOf = (tokens: ClueToken[], range: TokenRange): string =>
  tokens
    .slice(range.first, range.last + 1)
    .map((token) => token.folded.toLowerCase())
    .join(' ')

/**
 * The fold and its inverse, built in one pass. Every character CLUE_CHARSET admits folds to zero
 * characters (the space) or one (a letter), so rawAt[i] is total -- true ONLY because `,` `'` and
 * `-` are excluded from the charset. KEEP THIS HELPER AND THE CHARSET TOGETHER: widening one
 * without the other reintroduces the coordinate bug that readmits TANGO in TANGOS. Nothing in src/
 * calls it; hints.ts and the explanation builder slice the raw clue directly, which they can only
 * do because of the one-in-at-most-one-out guarantee this pairs with the charset.
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

/**
 * The letter operation, and the ONLY part of a deletion this repo can prove. Returns what the
 * claimed removal leaves, or undefined when it is not well defined on that word. It never consults
 * the clue: whether `spirit` means BRANDY is the reviewer's question.
 *
 * `middle` on an even-length source returns undefined rather than picking; see RemovalKind in
 * types.ts for the HEARTH -> HEATH/HERTH ambiguity. Multi-letter deletions are out of scope, and
 * the way in is a second removal kind with its own indicator family, never a rule that guesses. A
 * source too short to survive its removal returns the empty string, not undefined: emptiness is
 * not an ambiguity, and the caller's comparison against the answer rejects it.
 */
export const applyRemoval = (source: string, removal: RemovalKind): string | undefined => {
  const folded = normalizeAnswer(source)
  if (removal === 'first') {
    return folded.slice(1)
  }
  if (removal === 'last') {
    return folded.slice(0, -1)
  }
  if (folded.length % 2 === 0) {
    return undefined
  }
  const middle = (folded.length - 1) / 2
  return `${folded.slice(0, middle)}${folded.slice(middle + 1)}`
}

// Deliberately not in utils/model-output-checks.ts: a third rule there with the same signature and
// a third polarity is exactly the hazard the import guard on this directory exists for.
//
// A list rather than a stemmer, total over the suffixes it enumerates and not over English. That is
// safe because the answer is a single lemma drawn from nouns.ts, never an inflected form.
//
// Exported for hints.ts, which runs the same list over the GLOSS with the opposite polarity. One
// list, because the inflections are a property of English rather than of either call site.
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

/**
 * The forms of the answer a suffix builds. A deletion may not take one as its source.
 *
 * The rule is "the source must be a DIFFERENT WORD, not a longer form of this one". `Troops cut
 * short leaves a warrior` gives SOLDIER from SOLDIERY and clears every other clause -- perfect
 * letters, both words in the lexicon, no inflection -- and is still not a puzzle, because a solver
 * who reaches the source has already written the answer.
 *
 * Deliberately NOT crypticInflections, the tempting reuse: that list carries `${answer}D`
 * unconditionally, for a clue-leak check where over-matching is free, and here it would kill
 * WIND/WIN and FIND/FIN. The `E` condition is the whole reason this is a second list.
 *
 * A suffix belongs here only when EVERY source it builds is a longer form of the answer: S is the
 * plural on every answer (HANDS/HAND); D is the past tense E-FINAL ONLY (BAKED/BAKE, and the
 * condition keeps WIND/WIN); N is the past participle E-FINAL ONLY (TAKEN/TAKE).
 *
 * -Y and -R are absent although their cognate families are the largest in the language, because
 * each also builds unrelated words that make sound clues: BRANDY/BRAND, PARTY/PART and COVER/COVE
 * are the same string shape. The difference is etymology rather than spelling, so it goes to
 * review-cryptic-clues.txt, which asks it with SOLDIERY/SOLDIER as the worked drop and
 * BRANDY/BRAND as the worked keep. Adding a suffix here is a CLAIM that no clue anyone would want
 * is built by it, and never add an exception for a WORD.
 *
 * It cannot see cognacy that is not a suffix and does not need to: no English derivational prefix
 * is one letter, and a `middle` removal inserts a character inside the answer, which no suffix does.
 */
export const crypticCognates = (answer: string): string[] => [
  `${answer}S`,
  ...(answer.endsWith('E') ? [`${answer}D`, `${answer}N`] : []),
]

// The fields every device carries; the rest are per-device and checked at step 3b, once `device`
// has been narrowed.
const BASE_FIELDS = ['answer', 'clue', 'device'] as const

// Not exported: the union lives in types.ts, and a second exported list of its members is a second
// thing to keep in step with it.
const REMOVAL_KINDS: readonly RemovalKind[] = ['first', 'last', 'middle']

// The tool schema asserts nothing, and "abc".indexOf("") is 0 -- so without this an empty part
// string would be LOCATED successfully and rejected, if at all, by accident.
const trimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value === value.trim() ? value : undefined

const rawPartOf = (value: unknown): RawPart | undefined => {
  const record = value as Record<string, unknown> | undefined
  const cue = trimmedString(record?.cue)
  const text = trimmedString(record?.text)
  return cue === undefined || text === undefined ? undefined : { cue, text }
}

/**
 * Step 3b. The per-device shape check, and the only place the model's field names are read.
 *
 * Every failure is `malformed-item` naming the field, so the detail is something a prompt can be
 * fixed against rather than a decomposition that did not work out three steps later. `removal`
 * lands here rather than taking a code of its own: it is a closed union narrowed from an untyped
 * boundary exactly as `device` is, and this set already has one such reason.
 */
const claimOf = (
  device: CrypticDevice,
  item: Record<string, unknown>,
  onReject: (reason: RejectionReason, detail: Record<string, unknown>) => void,
): Claim | undefined => {
  if (device === 'charade') {
    const definition = trimmedString(item.definition)
    if (definition === undefined) {
      onReject('malformed-item', { field: 'definition' })
      return undefined
    }
    // The length comparison makes ONE malformed member fail the whole field rather than quietly
    // shortening the charade: a filter that dropped it would leave a decomposition the model did
    // not propose, and step 10 would prove something about a clue nobody wrote.
    const raw: unknown[] = Array.isArray(item.parts) ? item.parts : []
    const parts = raw.map(rawPartOf).filter((part): part is RawPart => part !== undefined)
    if (parts.length !== raw.length || parts.length < MIN_CHARADE_PARTS) {
      onReject('malformed-item', { field: 'parts' })
      return undefined
    }
    return { definition, device, parts }
  }

  if (device === 'deletion') {
    const definition = trimmedString(item.definition)
    if (definition === undefined) {
      onReject('malformed-item', { field: 'definition' })
      return undefined
    }
    const indicator = trimmedString(item.indicator)
    if (indicator === undefined) {
      onReject('malformed-item', { field: 'indicator' })
      return undefined
    }
    const removal = item.removal as RemovalKind
    if (!REMOVAL_KINDS.includes(removal)) {
      onReject('malformed-item', { field: 'removal' })
      return undefined
    }
    const source = rawPartOf(item.source)
    if (source === undefined) {
      onReject('malformed-item', { field: 'source' })
      return undefined
    }
    return { definition, device, indicator, removal, source }
  }

  // Exactly two on both counts: two members supplied and two of them well formed. A `filter` that
  // let a malformed member vanish would turn three sloppy definitions into two good ones.
  const raw: unknown[] = Array.isArray(item.definitions) ? item.definitions : []
  const definitions = raw.map(trimmedString).filter((value): value is string => value !== undefined)
  if (raw.length !== 2 || definitions.length !== 2) {
    onReject('malformed-item', { field: 'definitions' })
    return undefined
  }
  return { definitions: [definitions[0], definitions[1]], device }
}

// The default sink. A rejection says WHICH CLAUSE fired and the offending token travels with it,
// which is what makes "the indicator list grows by reading rejection logs" a bounded operation.
const logRejection = (reason: RejectionReason, detail: Record<string, unknown>): void => {
  log('Rejected a cryptic candidate', { ...detail, reason, type: 'crypticclue' })
}

/**
 * Returns undefined with a logged reason; never throws, never partially accepts.
 *
 * `answers` is the shortlist drawn for THIS call, keyed by normalizeAnswer, mapping to the
 * code-supplied spelling that reaches VerifiedClue.answer. The model's `answer` field is a key into
 * this map and nothing else.
 *
 * `isKnownWord` is a PARAMETER rather than an import so this module stays pure and nothing lexical
 * is reachable from it. `onReject` is injected so the caller can count reasons as well as log them.
 */
export const verifyClue = (
  candidate: unknown,
  answers: ReadonlyMap<string, string>,
  isKnownWord: (word: string) => boolean,
  onReject: (reason: RejectionReason, detail: Record<string, unknown>) => void = logRejection,
): VerifiedClue | undefined => {
  // Step 0. The three fields every device owes, before `device` can be trusted to say which others
  // are owed. It also carries the clue's trim equality: a clue differing from its own trim() is
  // REJECTED rather than trimmed, so the string the verifier proves and the string stored are the
  // same bytes and no span can be invalidated by a later normalization.
  const item = candidate as Record<string, unknown>
  for (const field of BASE_FIELDS) {
    if (trimmedString(item?.[field]) === undefined) {
      onReject('malformed-item', { field })
      return undefined
    }
  }

  const clue = item.clue as string
  // Step 1. The double-space half of the clue's shape rule; the trim half fires at step 0 as
  // `malformed-item`. Both are rejections rather than rewrites, for step 0's reason.
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

  // Step 2, second because hints.ts's letter rung and the enumeration both take the answer's
  // length and shape as established. `answer` from here on is the CODE-SUPPLIED spelling.
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

  const claim = claimOf(device, item, onReject)
  if (claim === undefined) {
    return undefined
  }

  // Plural, because a double definition has two and neither is subordinate: every rule below that
  // reads "the definition" runs over each member.
  const definitions = claim.device === 'doubledefinition' ? [...claim.definitions] : [claim.definition]

  // Per device, because a double definition's halves are the whole clue rather than one end of it.
  // The cap travels in the rejection detail, since the two numbers differ.
  const definitionCap = claim.device === 'doubledefinition' ? MAX_DOUBLE_DEFINITION_TOKENS : MAX_DEFINITION_TOKENS
  const tooLong = definitions.map((definition) => definition.split(' ').length).find((count) => count > definitionCap)
  if (tooLong !== undefined) {
    onReject('definition-too-long', { cap: definitionCap, tokens: tooLong })
    return undefined
  }

  // Stated over the DECLARED STRINGS, which is what makes this clause reachable: the span-level
  // form ("the two ranges differ") cannot fire, because an identical pair locates to the same
  // matches and dies at locate's uniqueness clause instead. Asking it of the claim is what gives
  // "the model submitted one definition twice" a code of its own.
  if (
    claim.device === 'doubledefinition' &&
    claim.definitions[0].toUpperCase() === claim.definitions[1].toUpperCase()
  ) {
    onReject('definitions-not-distinct', { definitions: claim.definitions })
    return undefined
  }

  // Step 4. THE DECLARATION. Every device names its ranges as (name, string) pairs, located as
  // TOKEN SEQUENCES and never substrings, so `in` cannot match inside `instant`.
  //
  // THE ORDER OF THIS LIST IS LOAD-BEARING: everything below reads ranges back out by position, so
  // a reordering here silently re-points the definition floor, the end rule and the derivation at
  // each other's ranges. Read positionally exactly once, immediately after locating.
  const tokens = tokensOf(clue)
  const declared =
    claim.device === 'charade'
      ? [
          { name: 'definition', part: claim.definition },
          ...claim.parts.map((part, index) => ({ name: `part${index}`, part: part.cue })),
        ]
      : claim.device === 'deletion'
        ? [
            { name: 'definition', part: claim.definition },
            { name: 'indicator', part: claim.indicator },
            { name: 'source', part: claim.source.cue },
          ]
        : [
            { name: 'definition0', part: claim.definitions[0] },
            { name: 'definition1', part: claim.definitions[1] },
          ]

  const located = declared.map(({ name, part }) => ({ name, range: locate(tokens, part) }))
  const unlocated = located.filter((entry) => entry.range === undefined).map((entry) => entry.name)
  if (unlocated.length > 0) {
    onReject('no-unique-span', { unlocated })
    return undefined
  }
  const ranges = located.map((entry) => entry.range as TokenRange)

  // THE POSITIONAL READ, done once and never again. `cueRanges` holds CUES ONLY: a deletion's
  // indicator is a word on a committed list, so asking the lexicon about `endless` would gate the
  // device on a list with no business deciding it, and multi-word entries legitimately contain a
  // connective (`without a head`) that step 5c would reject. A double definition has no cues and
  // no wordplay half.
  //
  // SORTED for a double definition, which is what makes VerifiedDoubleDefinition's "both halves in
  // clue order" true, since `declared` is in the order the MODEL listed them. Sorted rather than
  // rejected because step 5 proved the ranges disjoint, so `first` totally orders them.
  const definitionRanges =
    claim.device === 'doubledefinition' ? [...ranges].sort((left, right) => left.first - right.first) : [ranges[0]]
  const cueRanges = claim.device === 'charade' ? ranges.slice(1) : claim.device === 'deletion' ? [ranges[2]] : []
  const wordplayRanges =
    claim.device === 'charade' ? ranges.slice(1) : claim.device === 'deletion' ? [ranges[1], ranges[2]] : []

  // Step 5. Pairwise disjoint: a decomposition whose parts share a token has counted one token
  // twice, and the cover below would read a range as explaining a token another already explained.
  const disjoint = ranges.every((range, index) =>
    ranges.every((other, otherIndex) => index === otherIndex || !overlaps(range, other)),
  )
  if (!disjoint) {
    onReject('overlapping-spans', { clue })
    return undefined
  }

  // Step 5b. THE END RULE, per device. A definition wedged BETWEEN the parts passes the cover
  // happily -- it is a declared range -- and is still not a clue, because the solver reads the
  // surface left to right. A double definition is SKIPPED, having no wordplay half to sit
  // opposite; skipped rather than passed vacuously, which would look like the check ran.
  if (claim.device !== 'doubledefinition') {
    const wordplay = hullOf(wordplayRanges)
    const definitionRange = ranges[0]
    const atEnd = definitionRange.last < wordplay.first || definitionRange.first > wordplay.last
    if (!atEnd) {
      onReject('definition-not-at-end', { clue })
      return undefined
    }
  }

  // Step 5c. THE CUE BOUND. Step 6 counts a declared range as explained; this says how much clue a
  // cue range may claim. WITHOUT IT STEP 6 IS A COVERAGE TEST DRESSED AS A PARTITION, because the
  // model can declare its way out of the budget by widening a range it already owns. Both clauses
  // read the LOCATED RANGE, not the model's cue string, and run over `cueRanges` alone: a
  // definition carries a leading article by design and an indicator may be a multi-word entry.
  // Length first, so a five-word cue reports the shape it broke rather than a function word.
  const overlong = cueRanges.find((range) => range.last - range.first + 1 > MAX_CUE_TOKENS)
  if (overlong !== undefined) {
    onReject('cue-too-long', { cue: entryOf(tokens, overlong), tokens: overlong.last - overlong.first + 1 })
    return undefined
  }
  // NO CONNECTIVE MAY SIT INSIDE A CUE, which is what gives the seam budget its denominator: most
  // of CONNECTIVES are ENABLE words, so without this `from vehicle` is a cue like any other and
  // the FROM it swallows stops being counted. It costs real cues -- `bird of prey` dies on one
  // function word -- and the trade is taken because the alternative, counting a cue-internal
  // connective against the budget, puts the model back in charge of the denominator.
  const smuggled = cueRanges
    .flatMap((range) => tokens.slice(range.first, range.last + 1))
    .filter((token) => CONNECTIVES.has(token.folded))
  if (smuggled.length > 0) {
    onReject('connective-in-cue', { connectives: smuggled.map((token) => token.folded) })
    return undefined
  }

  // Step 6 -- THE COVER, and the theorem at the top of this file is this block. The seam set is
  // every index no declared range covers, INCLUDING indices outside the ranges' hull. Tested in
  // this order so a non-connective token reports its true cause rather than an over-budget seam.
  const seams = tokens.map((_token, index) => index).filter((index) => !ranges.some((range) => inRange(range, index)))
  const nonConnective = seams.filter((index) => !CONNECTIVES.has(tokens[index].folded))
  if (nonConnective.length > 0) {
    onReject('residue-out-of-position', { tokens: nonConnective.map((index) => tokens[index].folded) })
    return undefined
  }
  // A connective inside a DEFINITION range is counted, which closes the third hiding place between
  // step 5c's cue ban and the seam set. Counted rather than banned, because a definition is prose
  // that legitimately reads as English, and against the SAME total, because "at most two linking
  // words in the whole clue" is one quantity. `range.first + 1` when the first token is an article
  // is the exemption, a slice rather than a filter so a second article cannot claim it.
  const hidden = definitionRanges.flatMap((range) =>
    tokens
      .slice(DEFINITION_ARTICLES.has(tokens[range.first].folded) ? range.first + 1 : range.first, range.last + 1)
      .filter((token) => CONNECTIVES.has(token.folded)),
  )
  const linking = seams.length + hidden.length
  if (linking > MAX_SEAM_TOKENS) {
    onReject('seam-budget', { hidden: hidden.map((token) => token.folded), linking, seams: seams.length })
    return undefined
  }

  // Step 7. A FLOOR, not a ceiling: at least one definition token that is neither a connective nor
  // a single-token entry of this device's indicator list, since definition="The" clears every
  // other clause. Run over EVERY definition range, because a double definition whose second half
  // is `The` is not two definitions and is the device with the least else holding it up.
  const empty = definitionRanges.find(
    (range) =>
      !tokens
        .slice(range.first, range.last + 1)
        .some((token) => !CONNECTIVES.has(token.folded) && !crypticIndicators[device].has(token.folded.toLowerCase())),
  )
  if (empty !== undefined) {
    onReject('definition-not-substantive', { definition: entryOf(tokens, empty) })
    return undefined
  }

  // Step 8. THE INDICATOR, matched as a whole TOKEN SEQUENCE and never a substring, against the
  // CLAIMED REMOVAL'S OWN FAMILY rather than the flattened crypticIndicators.deletion, so a clue
  // saying "endless" cannot secretly behead. Skipped for charade and doubledefinition, which
  // declare no indicator range -- skipped rather than run against an empty set, because an
  // empty-set match would look like a check.
  if (claim.device === 'deletion') {
    const entry = entryOf(tokens, ranges[1])
    if (!deletionIndicators[claim.removal].has(entry)) {
      onReject('no-indicator', { indicator: entry, removal: claim.removal })
      return undefined
    }
  }

  // Step 9. THE MODEL'S CUE STRINGS ARE THROWN AWAY. From here the verifier reads only `clue`, the
  // spans, the part TEXT (which is not in the clue and so cannot be a span) and the shortlist word.
  // There is no second copy of the located text for a model to make disagree with the first.
  const definitionSpans = definitionRanges.map((range) => spanOf(tokens, range))
  const cueSpans = cueRanges.map((range) => spanOf(tokens, range))
  const partTexts =
    claim.device === 'charade'
      ? claim.parts.map((part) => normalizeAnswer(part.text))
      : claim.device === 'deletion'
        ? [normalizeAnswer(claim.source.text)]
        : []

  if (claim.device === 'charade') {
    // Order before letters, for the diagnosis rather than the verdict: swapped parts fail both
    // clauses, and `parts-out-of-order` is the cause where `derivation-failed` is the symptom.
    const ordered = cueRanges.every((range, index) => index === 0 || cueRanges[index - 1].last < range.first)
    if (!ordered) {
      onReject('parts-out-of-order', { clue })
      return undefined
    }
    // Every letter of every part is spoken for: a part whose letters the answer does not consume
    // is a place a model could hide something the cover cannot see.
    if (partTexts.join('') !== normalizeAnswer(answer)) {
      onReject('derivation-failed', { parts: partTexts })
      return undefined
    }
  }

  if (claim.device === 'deletion') {
    const remainder = applyRemoval(claim.source.text, claim.removal)
    if (remainder === undefined) {
      onReject('ambiguous-removal', { removal: claim.removal, source: partTexts[0] })
      return undefined
    }
    if (remainder !== normalizeAnswer(answer)) {
      onReject('derivation-failed', { removal: claim.removal, source: partTexts[0] })
      return undefined
    }
    // Step 10b. The source must be a DIFFERENT WORD, not a longer form of this one; see
    // crypticCognates. Below the derivation, so a source that does not reach the answer reports the
    // arithmetic it broke, and above steps 11 and 12, so SOLDIERY is not diagnosed as
    // `unknown-part-word`, which would be both wrong and unfixable.
    if (crypticCognates(normalizeAnswer(answer)).includes(partTexts[0])) {
      onReject('cognate-source', { answer, source: partTexts[0] })
      return undefined
    }
  }

  // A `doubledefinition` HAS NOTHING TO DERIVE, and that is the device rather than an unfinished
  // arm. Do not "complete" this switch: the only honest check compares the two halves' MEANINGS,
  // which is review.ts's pass.

  // Step 11. G5 is waived BY ROLE -- a cryptic clue legitimately contains its answer's letters, so
  // the answer-leak gate must never run over this string, which the ESLint rule and imports.test.ts
  // hold -- and this is its replacement. Over a BOUNDED INFLECTION SET, because the shared
  // tokenizer has no stemming: containsAnswerToken('TANGO', 'Dances tangos in instant angora') is
  // false while that clue hands the player the answer in the surface.
  const leaked = crypticInflections(answer).filter((form) => containsAnswerToken(form, clue))
  if (leaked.length > 0) {
    onReject('answer-token', { leaked })
    return undefined
  }

  // Step 12. Every part is a word on BOTH SIDES: the clue tokens of every cue range, and the
  // letters each cue yields. One clause and one code, because it is one property -- a part the
  // solver must supply has to be a thing the language has.
  const unknown = [
    ...cueRanges.flatMap((range) => entryOf(tokens, range).split(' ')),
    ...partTexts.map((text) => text.toLowerCase()),
  ].filter((word) => !isKnownWord(word))
  if (unknown.length > 0) {
    onReject('unknown-part-word', { unknown })
    return undefined
  }

  // Step 12b. The definition slice faces the lexicon too. A charade or deletion survives without
  // this by accident, their cues covering most of the clue; `doubledefinition` DECLARES NO CUE
  // RANGE AT ALL, so without it `Departed and zzz qqq still remaining` is accepted, on the one
  // device with no letter operation behind it. A separate code, because a cue token is half of a
  // thing the solver must SUPPLY where a definition token is prose the player READS.
  //
  // CONNECTIVES ARE EXEMPT FROM THE LEXICON, not as a convenience: `A` is not in ENABLE, which
  // starts at two letters, and the prompt requires a leading article inside the definition. Exempt
  // here is not UNCOUNTED -- step 6 charges for them -- so widening this list without reading that
  // one reopens the hole.
  const unknownDefinition = definitionRanges
    .flatMap((range) => tokens.slice(range.first, range.last + 1))
    .filter((token) => !CONNECTIVES.has(token.folded) && !isKnownWord(token.folded.toLowerCase()))
  if (unknownDefinition.length > 0) {
    onReject('unknown-definition-word', { unknown: unknownDefinition.map((token) => token.folded) })
    return undefined
  }

  // Both model strings ride along unjudged except for shape -- see VerifiedBase. A value of any
  // other type, or one empty or untrimmed, becomes `undefined` rather than a rejection, so the clue
  // survives and the ladder is one rung shorter.
  const gloss = trimmedString(item.gloss)
  const wordGloss = trimmedString(item.wordGloss)

  if (claim.device === 'charade') {
    return {
      answer,
      clue,
      definitionSpan: definitionSpans[0],
      device: 'charade',
      gloss,
      parts: cueSpans.map((cueSpan, index) => ({ cueSpan, text: partTexts[index] })),
      wordGloss,
    }
  }

  if (claim.device === 'deletion') {
    return {
      answer,
      clue,
      definitionSpan: definitionSpans[0],
      device: 'deletion',
      gloss,
      indicatorSpan: spanOf(tokens, ranges[1]),
      removal: claim.removal,
      source: { cueSpan: cueSpans[0], text: partTexts[0] },
      wordGloss,
    }
  }

  return {
    answer,
    clue,
    definitionSpans: [definitionSpans[0], definitionSpans[1]],
    device: 'doubledefinition',
    gloss,
    wordGloss,
  }
}
