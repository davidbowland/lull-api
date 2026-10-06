import { PackDate, PhrasePuzzleData, Puzzle, PuzzleType, ThemedAnagramsData } from '../types'
import { passesStringGates } from './model-output-checks'
import { packDateDistance } from './pack-date'

// Restated rather than imported from services/phrases.ts (MAX_TEXT_LENGTH): that one bounds what
// may be written, this one what may re-enter a prompt.
const MAX_ANSWER_LENGTH = 80

// A type joins if reusing its answer would be a repeat OF A PHRASE. A type whose answer is an
// ordinary single English word stays out: a list titled "phrases not to reuse" holding SIDE bans
// that word from three other types for the whole dedupe window. An explicit allowlist, because
// `answer` is a plain string on four unrelated types and no structural test separates them.
// Cryptogram stays in although its answers are sentences: the phrases it shipped before are still
// inside the dedupe window. Its sentences of eighty characters or fewer join the list too.
export const PHRASE_CORPUS_TYPES = new Set<PuzzleType>(['cryptogram', 'missingvowels', 'phrazle'])

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
 * Packs ordered by how close they sit to the date being built, nearest first. DynamoDB does not
 * preserve BatchGetItem order, and a prompt built from an unordered list defeats caching and
 * reproducible logs. Ties fall back to a date comparison, and a pack without a date sorts last.
 */
const nearestFirst = <T extends { date?: PackDate }>(packs: T[], origin: PackDate): T[] =>
  [...packs].sort((left, right) => {
    if (left.date === undefined || right.date === undefined) {
      return (right.date ?? '').localeCompare(left.date ?? '')
    }
    const byDistance = packDateDistance(left.date, origin) - packDateDistance(right.date, origin)
    return byDistance === 0 ? right.date.localeCompare(left.date) : byDistance
  })

// UNBOUNDED ON PURPOSE. Each list is the complete set of answers the model may not choose, and the
// same list drives the code-side reject. The dedupe window in days (PHRASE_HISTORY_DAYS) is the
// bound; capping the list as well hides exactly the far-back answers the model drifts back to.
// Repeats are collapsed, since the archive already holds some.
const unique = (values: string[]): string[] => [...new Set(values)]

/**
 * Recent answers of the given types, re-gated on read. Nearest to `origin` first.
 *
 * Re-gated because gates change and stored packs do not, and this is a closed loop: model output is
 * stored in a pack, read back for the whole dedupe window, and interpolated into the next
 * prompt's context slot.
 * G1-G4 and G6, not G5: every entry here IS an answer, so G5 would empty the list nightly. It is
 * waived by omitting `answer`, never by passing an empty one.
 */
export const recentAnswersOfTypes = (
  packs: { date?: PackDate; puzzles: Puzzle[] }[],
  types: Set<PuzzleType>,
  origin: PackDate,
): string[] =>
  unique(
    nearestFirst(packs, origin)
      .flatMap((pack) => pack.puzzles.map((puzzle) => answerOf(puzzle, types)))
      .filter((answer): answer is string =>
        // Rejected, never truncated: truncating changes an entry's normalizeAnswer key, so it would
        // stop matching the excludedKeys dedupe in services/phrases.ts that it exists to drive.
        passesStringGates({ maxLength: MAX_ANSWER_LENGTH, typeable: true, value: answer }),
      ),
  )

// Narrowed on the type literal, never on structure: a structural read of `answer` would pick up
// every phrase answer in the archive.
const CRYPTIC_TYPES = new Set<PuzzleType>(['crypticclue'])

/**
 * Recent cryptic answers, re-gated on read. Nearest to `origin` first. Its own list because the
 * answer is a single English word, not a phrase; a wrapper rather than a second reader, so the
 * re-gate rows cannot drift from the phrase corpus's copy.
 */
export const recentCrypticAnswers = (packs: { date?: PackDate; puzzles: Puzzle[] }[], origin: PackDate): string[] =>
  recentAnswersOfTypes(packs, CRYPTIC_TYPES, origin)

const CRYPTOGRAM_TYPES = new Set<PuzzleType>(['cryptogram'])

// Restated rather than imported from generators/cryptogram/sentence.ts, for the reason
// MAX_ANSWER_LENGTH is.
const MAX_CRYPTOGRAM_ANSWER_LENGTH = 100

/**
 * Recent cryptogram answers, re-gated on read. Nearest to `origin` first. Its own reader because a
 * sentence runs past the phrase list's eighty-character cap.
 */
export const recentCryptogramAnswers = (packs: { date?: PackDate; puzzles: Puzzle[] }[], origin: PackDate): string[] =>
  unique(
    nearestFirst(packs, origin)
      .flatMap((pack) => pack.puzzles.map((puzzle) => answerOf(puzzle, CRYPTOGRAM_TYPES)))
      .filter((answer): answer is string =>
        passesStringGates({ maxLength: MAX_CRYPTOGRAM_ANSWER_LENGTH, typeable: true, value: answer }),
      ),
  )

// Themed Anagrams keeps two repeat units: a theme reused with different words is a different
// puzzle, but one word appearing twice is a repeat a player notices.

// Restated rather than imported from services/anagram-sets.ts, for the reason MAX_ANSWER_LENGTH is.
const MAX_THEME_LENGTH = 40
const MAX_ANAGRAM_WORD_LENGTH = 9
const THEME_CHARSET = /^[A-Za-z][A-Za-z0-9 &'-]*$/

const anagramDataOf = (puzzle: Puzzle): Partial<ThemedAnagramsData> | undefined =>
  puzzle.type === 'themedanagrams' ? ((puzzle.data as Partial<ThemedAnagramsData> | null) ?? undefined) : undefined

/**
 * Recent themes, re-gated on read. Nearest to `origin` first. G5 is waived by omitting
 * `answer`; entries are rejected rather than truncated, because truncation changes the
 * normalizeAnswer key the dedupe in services/anagram-sets.ts uses.
 */
export const recentThemes = (packs: { date?: PackDate; puzzles: Puzzle[] }[], origin: PackDate): string[] =>
  unique(
    nearestFirst(packs, origin)
      .flatMap((pack) => pack.puzzles.map((puzzle) => anagramDataOf(puzzle)?.theme))
      .filter(
        (theme): theme is string =>
          passesStringGates({ maxLength: MAX_THEME_LENGTH, value: theme }) && THEME_CHARSET.test(theme as string),
      ),
  )

/**
 * Recent anagram answers, re-gated on read. Nearest to `origin` first, entries in wire
 * order. `typeable: true` because each is a string a player types, under this type's own nine-
 * character cap rather than the phrase corpus's eighty.
 */
export const recentAnagramWords = (packs: { date?: PackDate; puzzles: Puzzle[] }[], origin: PackDate): string[] =>
  unique(
    nearestFirst(packs, origin)
      .flatMap((pack) =>
        pack.puzzles.flatMap((puzzle) => (anagramDataOf(puzzle)?.entries ?? []).map((entry) => entry?.answer)),
      )
      .filter((answer): answer is string =>
        passesStringGates({ maxLength: MAX_ANAGRAM_WORD_LENGTH, typeable: true, value: answer }),
      ),
  )
