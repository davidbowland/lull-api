import { PackDate, PhrasePuzzleData, Puzzle, PuzzleType, ThemedAnagramsData } from '../types'
import { passesStringGates } from './model-output-checks'

// A character count, and the same number services/phrases.ts applies on the WRITE side
// (MAX_TEXT_LENGTH). It is restated here rather than imported because the two are different gates in
// different directions: that one bounds what may be written, this one bounds what may re-enter a
// prompt, and a shared constant would make a change to either silently change the other. The number
// is the same today and the reason each holds it is not.
const MAX_ANSWER_LENGTH = 80

// 20 packs x 6 phrase puzzles (2 Missing Vowels + 2 Cryptogram + 2 Phrazle) = 120 on a healthy
// night, at 1.67x. The DERIVED figure is what a healthy night produces; this BOUND is what the code
// enforces, and a ceiling computed from a typical input is not a ceiling. At the bound and the
// 80-character cap it is <= 16.0KB.
//
// The headroom is for a count table that moves, and it is not headroom a runaway list can hide in:
// every bound is a HARD SLICE, not a target.
export const MAX_EXCLUDED_PHRASES = 200

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
// Phrazle joins on its own branch. Cryptic Clue never does.
export const PHRASE_CORPUS_TYPES = new Set<PuzzleType>(['cryptogram', 'missingvowels'])

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
 * Recent answers of the given types, re-gated on read and bounded. Newest first.
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
 * SORTED newest-first here rather than trusted from the caller. getRecentPacks issues one
 * BatchGetItemCommand and reads response.Responses directly, and DynamoDB does not preserve request
 * order -- so without this sort the hard slice below would keep whichever 200 entries the service
 * happened to return first.
 *
 * `date` is optional so a bare { puzzles } shape satisfies the parameter as readily as a Pack does;
 * a pack without one sorts as the oldest thing present rather than jumping the window.
 */
export const recentAnswersOfTypes = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  types: Set<PuzzleType>,
  limit: number = MAX_EXCLUDED_PHRASES,
): string[] =>
  [...packs]
    .sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))
    .flatMap((pack) => pack.puzzles.map((puzzle) => answerOf(puzzle, types)))
    .filter((answer): answer is string =>
      // REJECTED, never truncated. The same list builds excludedKeys in services/phrases.ts, and
      // truncating an entry changes its normalizeAnswer key -- so a truncated phrase would stop
      // matching the dedupe it exists to drive, and the model would be shown a phrase not to reuse
      // while the code stopped recognizing it. Rejection is what a re-gate does anyway.
      passesStringGates({ maxLength: MAX_ANSWER_LENGTH, typeable: true, value: answer }),
    )
    .slice(0, limit)

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

// 20 packs x 3 sets = 60 themes and x 4 words = 240 words on a healthy night, each bound at roughly
// 1.7x. As with MAX_EXCLUDED_PHRASES above, the DERIVED figure is what a healthy night produces and
// the BOUND is what the code enforces: a ceiling computed from a typical input is not a ceiling.
export const MAX_EXCLUDED_THEMES = 100
export const MAX_EXCLUDED_WORDS = 400

// Restated here rather than imported from services/anagram-sets.ts, for the reason MAX_ANSWER_LENGTH
// above is restated: that one bounds what may be WRITTEN, this one bounds what may RE-ENTER a
// prompt, and a shared constant would make a change to either silently change the other.
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_WORD_LENGTH = 9
const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

const anagramDataOf = (puzzle: Puzzle): Partial<ThemedAnagramsData> | undefined =>
  puzzle.type === 'themedanagrams' ? ((puzzle.data as Partial<ThemedAnagramsData> | null) ?? undefined) : undefined

// Newest first, for the reason recentAnswersOfTypes sorts: getRecentPacks issues one
// BatchGetItemCommand and reads response.Responses directly, and DynamoDB does not preserve request
// order -- so without this the hard slice below keeps whichever entries the service happened to
// return first.
const newestFirst = (packs: { date?: PackDate; puzzles: Puzzle[] }[]): { date?: PackDate; puzzles: Puzzle[] }[] =>
  [...packs].sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))

/**
 * Recent themes, re-gated on read and bounded. Newest first.
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
  limit: number = MAX_EXCLUDED_THEMES,
): string[] =>
  newestFirst(packs)
    .flatMap((pack) => pack.puzzles.map((puzzle) => anagramDataOf(puzzle)?.theme))
    .filter(
      (theme): theme is string =>
        passesStringGates({ maxLength: MAX_THEME_LENGTH, value: theme }) && THEME_CHARSET.test(theme as string),
    )
    .slice(0, limit)

/**
 * Recent anagram answers, re-gated on read and bounded. Newest first, entries in wire order.
 *
 * `typeable: true` because every one of these IS an answer a player typed, which is the role that
 * charset belongs to. The length cap is this type's own nine, not the phrase corpus's eighty.
 */
export const recentAnagramWords = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  limit: number = MAX_EXCLUDED_WORDS,
): string[] =>
  newestFirst(packs)
    .flatMap((pack) =>
      pack.puzzles.flatMap((puzzle) => (anagramDataOf(puzzle)?.entries ?? []).map((entry) => entry?.answer)),
    )
    .filter((answer): answer is string =>
      passesStringGates({ maxLength: MAX_ANAGRAM_WORD_LENGTH, typeable: true, value: answer }),
    )
    .slice(0, limit)
