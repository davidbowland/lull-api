import { PackDate, PhrasePuzzleData, Puzzle, PuzzleType, ThemedAnagramsData } from '../types'
import { passesStringGates } from './model-output-checks'
import { packDateDistance } from './pack-date'

// A character count, and the same number services/phrases.ts applies on the WRITE side
// (MAX_TEXT_LENGTH). It is restated here rather than imported because the two are different gates in
// different directions: that one bounds what may be written, this one bounds what may re-enter a
// prompt, and a shared constant would make a change to either silently change the other. The number
// is the same today and the reason each holds it is not.
const MAX_ANSWER_LENGTH = 80

// 41 packs (packDateWindow at 20 reaches BOTH ways and includes the target) x 8 phrase puzzles
// (3 Missing Vowels + 2 Cryptogram + 3 Phrazle) = 328 on a healthy night, at 1.67x. The DERIVED
// figure is what a healthy night produces; this BOUND is what the code enforces, and a ceiling
// computed from a typical input is not a ceiling. At the bound and the 80-character cap it is
// <= 44.0KB.
//
// IT WAS 200 AGAINST A DERIVED 120, and both halves of that arithmetic were stale: the window was
// backward-only (20 packs, not 41) and the count table still read 2 Missing Vowels + 2 Phrazle. A
// bound below the derived figure is not a safety margin, it is a silent truncation of the list that
// stops repeats -- so this moved WITH the window rather than after someone noticed.
//
// The headroom is for a count table that moves, and it is not headroom a runaway list can hide in:
// every bound is a HARD SLICE, not a target.
export const MAX_EXCLUDED_PHRASES = 550

// The types drawing on the shared phrase corpus, and the only ones whose `answer` belongs in a list
// of "phrases not to reuse". A phrase type joins by being added here -- deliberately explicit, for
// the same reason scripts/audit-hints.ts gives: every type now ships the same shapes, so a
// structural test cannot tell them apart and the type is the only thing that can.
//
// Membership is NARROWER than "has an answer", and that distinction is a rule rather than one type's
// carve-out: a type joins if reusing its answer would be a repeat OF A PHRASE. A type whose answer
// is an ordinary single English word stays out -- a list titled "phrases not to reuse" containing
// SIDE bans that word from three other types for twenty nights.
//
// Phrazle is in, on the rule rather than by habit: its `answer` IS a phrase from the shared corpus,
// so reusing it would be a repeat of a phrase. It contributes the CANONICAL form rather than the
// corpus text, which changes nothing here -- the list keys on normalizeAnswer, which strips spacing
// and case, so the two forms collapse to one key. Cryptic Clue never joins -- see
// recentCrypticAnswers below.
export const PHRASE_CORPUS_TYPES = new Set<PuzzleType>(['cryptogram', 'missingvowels', 'phrazle'])

// Cryptic Clue's own repeat unit, read through its own narrowed reader for the same reason Themed
// Anagrams has two: the type is NOT in PHRASE_CORPUS_TYPES, and that is a rule rather than a
// carve-out. A type joins that set if reusing its answer would be a repeat OF A PHRASE; a cryptic
// answer is an ordinary single English word, and a list titled "phrases not to reuse" holding
// AARDVARK bans that word from three other types for twenty nights.
//
// 41 packs x 1 clue = 41 derived against a bound of 130. THE HEADROOM IS 3x WHERE EVERY OTHER ROW
// HERE IS 1.67x, and that is deliberate rather than sloppy: 1.7x of 41 is 70, a bound inside the
// ordinary variance of a type producing ONE item a night, so the first fortnight of over-production
// would silently start truncating the list.
export const MAX_EXCLUDED_CRYPTIC_ANSWERS = 130

// The cast survives, and is now SOUND: it is applied only to types this file declares to carry
// PhrasePuzzleData, rather than to every puzzle of every type. That is the whole difference.
//
// The `typeof === 'string'` below is REDUNDANT with G1 and is kept anyway. Measured, not assumed:
// removing it leaves the whole suite green, because passesStringGates rejects a non-string at G1
// either way. It stays because it is what makes this function's `string | undefined` return an
// honest one rather than a cast, so a later caller that reads answerOf directly -- without the
// filter below -- does not silently receive a number typed as a string. That it cannot be falsified
// is stated here rather than dressed up as a covered branch.
const answerOf = (puzzle: Puzzle, types: Set<PuzzleType>): string | undefined => {
  if (!types.has(puzzle.type)) {
    return undefined
  }
  const data = puzzle.data as Partial<PhrasePuzzleData> | null
  return typeof data?.answer === 'string' ? data.answer : undefined
}

/**
 * Packs ordered by how close they sit to the date being built, nearest first.
 *
 * getRecentPacks issues one BatchGetItemCommand and reads response.Responses directly, and DynamoDB
 * does not preserve request order -- so every reader below sorts before its hard slice, or the slice
 * keeps whichever entries the service happened to return first.
 *
 * NEAREST, NOT NEWEST, because packDateWindow reaches in BOTH directions. Over a backward-only
 * window the two orders agree; over a symmetric one, newest-first would drop yesterday's pack to
 * keep one twenty days in the future, which is precisely the wrong end to lose. Ties -- the pack one
 * day before against the one day after -- fall back to a date comparison so the order is total and
 * the slice is deterministic.
 *
 * `origin` IS REQUIRED, AND THAT IS A SAFETY DECISION RATHER THAN A STYLE ONE. It sits ahead of the
 * optional `limit` on every reader below, so an optional origin would let a caller passing a limit
 * positionally land a NUMBER in this slot -- and `__tests__` is not covered by tsconfig's `include`,
 * so nothing would say so until a bound quietly stopped applying. Required means src/ cannot omit it
 * and the compiler names anyone who tries.
 *
 * A pack's `date` stays optional, because `{ puzzles: Puzzle[] }[]` is the parameter type every
 * caller satisfies structurally. One without a date has no distance to measure and sorts last.
 */
const nearestFirst = <T extends { date?: PackDate }>(packs: T[], origin: PackDate): T[] =>
  [...packs].sort((left, right) => {
    if (left.date === undefined || right.date === undefined) {
      return (right.date ?? '').localeCompare(left.date ?? '')
    }
    const byDistance = packDateDistance(left.date, origin) - packDateDistance(right.date, origin)
    return byDistance === 0 ? right.date.localeCompare(left.date) : byDistance
  })

/**
 * Recent answers of the given types, re-gated on read and bounded. Nearest to `origin` first.
 *
 * RE-GATED, because gates change and stored packs do not -- the only thing that would rewrite one is
 * a manual runbook. This list is a closed loop: model output is stored in a pack, read back 20
 * nights running, and interpolated into the context slot of the next prompt. What bounds that loop
 * is a charset whitelist, a length cap and the blocklist, and all three ran on the write side only.
 *
 * G1, G2, G3, G4 and G6 -- NOT G5. Every entry here IS an answer, so leaksAnswerTokens(answer,
 * answer) is true for any entry of four characters or more, and running that row would empty the
 * list every night. That is the silent poisoning this reader exists to prevent, arriving through the
 * fix for it. G5 is waived by OMITTING `answer`, never by passing an empty one.
 *
 * SORTED here rather than trusted from the caller. getRecentPacks issues one BatchGetItemCommand and
 * reads response.Responses directly, and DynamoDB does not preserve request order -- so without this
 * sort the hard slice below would keep whichever entries the service happened to return first.
 *
 * `origin` is the date being BUILT, and passing it is what makes the order meaningful over a window
 * that reaches both ways. See nearestFirst.
 */
export const recentAnswersOfTypes = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  types: Set<PuzzleType>,
  origin: PackDate,
  limit: number = MAX_EXCLUDED_PHRASES,
): string[] =>
  nearestFirst(packs, origin)
    .flatMap((pack) => pack.puzzles.map((puzzle) => answerOf(puzzle, types)))
    .filter((answer): answer is string =>
      // REJECTED, never truncated. The same list builds excludedKeys in services/phrases.ts, and
      // truncating an entry changes its normalizeAnswer key -- so a truncated phrase would stop
      // matching the dedupe it exists to drive, and the model would be shown a phrase not to reuse
      // while the code stopped recognizing it. Rejection is what a re-gate does anyway.
      passesStringGates({ maxLength: MAX_ANSWER_LENGTH, typeable: true, value: answer }),
    )
    .slice(0, limit)

// A one-member set rather than an inline literal, so the narrowing is the SAME mechanism
// PHRASE_CORPUS_TYPES uses -- narrowed on the type literal, never on structure. A structural read of
// `answer` would pick up every phrase answer in the archive.
const CRYPTIC_TYPES = new Set<PuzzleType>(['crypticclue'])

/**
 * Recent cryptic answers, re-gated on read and bounded. Nearest to `origin` first.
 *
 * A THIN NAMED WRAPPER over recentAnswersOfTypes rather than a second reader, so the re-gate rows
 * G1/G2/G3/G4/G6 -- and the nearest-first sort before the hard slice, which getRecentPacks cannot
 * guarantee -- come for free and cannot drift from the phrase corpus's copy of the same argument.
 *
 * `typeable: true` comes from recentAnswersOfTypes; the length cap is the phrase corpus's eighty,
 * which cannot bind on a 4-8 letter lemma and is left alone rather than duplicated as a third
 * number.
 */
export const recentCrypticAnswers = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  origin: PackDate,
  limit: number = MAX_EXCLUDED_CRYPTIC_ANSWERS,
): string[] => recentAnswersOfTypes(packs, CRYPTIC_TYPES, origin, limit)

// Themed Anagrams keeps TWO repeat units, and they are read by two readers over the ONE 20-day pack
// read the handler already makes. A theme reused with different words is a different puzzle, but one
// word appearing twice in a fortnight is a repeat a player notices.
//
// NARROWED ON THE TYPE LITERAL, never on structure. A structural read of `theme` would pick up a
// phrase puzzle's `category` the day someone renames a field, and a structural read of an entry's
// `answer` would pick up every phrase answer in the archive.
//
// NO CROSS-CONTAMINATION IN EITHER DIRECTION: anagram words never enter phrasesAlreadyUsed and
// phrase answers never enter these lists. That is the whole reason `answer` is defined narrowly and
// PHRASE_CORPUS_TYPES is an explicit allowlist -- this type joins nothing, and omission from an
// allowlist is the mechanism.

// 41 packs x 3 sets = 123 themes and x 4 words = 492 words on a healthy night, each bound at roughly
// 1.7x. As with MAX_EXCLUDED_PHRASES above, the DERIVED figure is what a healthy night produces and
// the BOUND is what the code enforces: a ceiling computed from a typical input is not a ceiling.
// Both moved with packDateWindow: at the old 100 and 400 the window's own output would have been
// truncated on every healthy night.
export const MAX_EXCLUDED_THEMES = 210
export const MAX_EXCLUDED_WORDS = 840

// Restated here rather than imported from services/anagram-sets.ts, for the reason MAX_ANSWER_LENGTH
// above is restated: that one bounds what may be WRITTEN, this one bounds what may RE-ENTER a
// prompt, and a shared constant would make a change to either silently change the other.
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_WORD_LENGTH = 9
const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

const anagramDataOf = (puzzle: Puzzle): Partial<ThemedAnagramsData> | undefined =>
  puzzle.type === 'themedanagrams' ? ((puzzle.data as Partial<ThemedAnagramsData> | null) ?? undefined) : undefined

/**
 * Recent themes, re-gated on read and bounded. Nearest to `origin` first.
 *
 * RE-GATED because gates change and stored packs do not: this is a closed loop, where model output
 * is stored in a pack, read back for 20 nights and interpolated into the next prompt's context slot.
 * G5 is waived by OMITTING `answer` -- there is no answer a theme could leak here, and supplying an
 * empty one would be a waiver that looks applied.
 *
 * REJECTED, NEVER TRUNCATED. The same list builds excludedKeys in services/anagram-sets.ts, and
 * truncating an entry changes its normalizeAnswer key -- so a truncated theme would stop matching the
 * dedupe it exists to drive.
 */
export const recentThemes = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  origin: PackDate,
  limit: number = MAX_EXCLUDED_THEMES,
): string[] =>
  nearestFirst(packs, origin)
    .flatMap((pack) => pack.puzzles.map((puzzle) => anagramDataOf(puzzle)?.theme))
    .filter(
      (theme): theme is string =>
        passesStringGates({ maxLength: MAX_THEME_LENGTH, value: theme }) && THEME_CHARSET.test(theme as string),
    )
    .slice(0, limit)

/**
 * Recent anagram answers, re-gated on read and bounded. Nearest to `origin` first, entries in wire
 * order.
 *
 * `typeable: true` because every one of these IS an answer a player typed, which is the role that
 * charset belongs to. The length cap is this type's own nine, not the phrase corpus's eighty.
 */
export const recentAnagramWords = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  origin: PackDate,
  limit: number = MAX_EXCLUDED_WORDS,
): string[] =>
  nearestFirst(packs, origin)
    .flatMap((pack) =>
      pack.puzzles.flatMap((puzzle) => (anagramDataOf(puzzle)?.entries ?? []).map((entry) => entry?.answer)),
    )
    .filter((answer): answer is string =>
      passesStringGates({ maxLength: MAX_ANAGRAM_WORD_LENGTH, typeable: true, value: answer }),
    )
    .slice(0, limit)
