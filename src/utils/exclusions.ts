import { PackDate, PhrasePuzzleData, Puzzle, PuzzleType, ThemedAnagramsData } from '../types'
import { passesStringGates } from './model-output-checks'
import { packDateDistance } from './pack-date'

// Restated rather than imported from services/phrases.ts (MAX_TEXT_LENGTH): that one bounds what
// may be written, this one what may re-enter a prompt.
const MAX_ANSWER_LENGTH = 80

// 41 packs (packDateWindow at 20 reaches both ways and includes the target) x 8 phrase puzzles
// = 328 derived, bounded at ~1.67x. Every bound here is a hard slice, so it must sit above what a
// healthy night produces or it silently truncates the list that stops repeats.
export const MAX_EXCLUDED_PHRASES = 550

// A type joins if reusing its answer would be a repeat OF A PHRASE. A type whose answer is an
// ordinary single English word stays out: a list titled "phrases not to reuse" holding SIDE bans
// that word from three other types for twenty nights. An explicit allowlist, because `answer` is a
// plain string on four unrelated types and no structural test separates them.
export const PHRASE_CORPUS_TYPES = new Set<PuzzleType>(['cryptogram', 'missingvowels', 'phrazle'])

// Cryptic Clue keeps its own list because its answer is a single English word, not a phrase.
// 41 packs x 1 clue = 41 derived, at 3x rather than the 1.67x elsewhere here: 1.7x of 41 is 70,
// inside the ordinary variance of a type producing one item a night.
export const MAX_EXCLUDED_CRYPTIC_ANSWERS = 130

// The cast is sound only because it is applied to types this file declares to carry
// PhrasePuzzleData. The `typeof` check is redundant with G1 downstream but keeps the return type
// honest for a caller that reads answerOf unfiltered.
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
 * DynamoDB does not preserve BatchGetItem order, so every reader below sorts before its hard slice
 * or the slice keeps whatever arrived first. Nearest, not newest, because packDateWindow reaches
 * both ways: newest-first would drop yesterday's pack to keep one twenty days out. Ties fall back
 * to a date comparison so the slice is deterministic, and a pack without a date sorts last.
 * `origin` is required so a caller passing `limit` positionally cannot land a number in this slot.
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
 * Re-gated because gates change and stored packs do not, and this is a closed loop: model output is
 * stored in a pack, read back for 20 nights, and interpolated into the next prompt's context slot.
 * G1-G4 and G6, not G5: every entry here IS an answer, so G5 would empty the list nightly. It is
 * waived by omitting `answer`, never by passing an empty one.
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
      // Rejected, never truncated: truncating changes an entry's normalizeAnswer key, so it would
      // stop matching the excludedKeys dedupe in services/phrases.ts that it exists to drive.
      passesStringGates({ maxLength: MAX_ANSWER_LENGTH, typeable: true, value: answer }),
    )
    .slice(0, limit)

// Narrowed on the type literal, never on structure: a structural read of `answer` would pick up
// every phrase answer in the archive.
const CRYPTIC_TYPES = new Set<PuzzleType>(['crypticclue'])

/**
 * Recent cryptic answers, re-gated on read and bounded. Nearest to `origin` first. A wrapper rather
 * than a second reader, so the re-gate rows and the sort-before-slice cannot drift from the phrase
 * corpus's copy; the inherited 80-character cap cannot bind on a 4-8 letter lemma.
 */
export const recentCrypticAnswers = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  origin: PackDate,
  limit: number = MAX_EXCLUDED_CRYPTIC_ANSWERS,
): string[] => recentAnswersOfTypes(packs, CRYPTIC_TYPES, origin, limit)

// Themed Anagrams keeps two repeat units: a theme reused with different words is a different
// puzzle, but one word appearing twice in a fortnight is a repeat a player notices.
// 41 packs x 3 sets = 123 themes and x 4 words = 492 words derived, each bounded at roughly 1.7x.
export const MAX_EXCLUDED_THEMES = 210
export const MAX_EXCLUDED_WORDS = 840

// Restated rather than imported from services/anagram-sets.ts, for the reason MAX_ANSWER_LENGTH is.
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_WORD_LENGTH = 9
const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

const anagramDataOf = (puzzle: Puzzle): Partial<ThemedAnagramsData> | undefined =>
  puzzle.type === 'themedanagrams' ? ((puzzle.data as Partial<ThemedAnagramsData> | null) ?? undefined) : undefined

/**
 * Recent themes, re-gated on read and bounded. Nearest to `origin` first. G5 is waived by omitting
 * `answer`; entries are rejected rather than truncated, because truncation changes the
 * normalizeAnswer key the dedupe in services/anagram-sets.ts uses.
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
 * order. `typeable: true` because each is a string a player types, under this type's own nine-
 * character cap rather than the phrase corpus's eighty.
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
