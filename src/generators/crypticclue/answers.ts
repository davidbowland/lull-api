import { nouns } from '../../assets/nouns'
import { normalizeAnswer } from '../../rules/normalize-answer'
import { containsChargedWord } from '../../utils/model-output-checks'
import { getRandomSample } from '../../utils/random-sample'

// The answer band the enumeration is stated against. hints.ts declares the same two numbers rather
// than importing them: it is reachable from worst-case.ts, a leaf module, and an import from here
// would pull nouns.ts (2,000 lemmas) into GetPackByDateFunction's bundle. hints.test.ts asserts the
// two copies equal.
export const MIN_ANSWER_LENGTH = 4
export const MAX_ANSWER_LENGTH = 8

// 2.5x the ask, where `asked` is countPerDay * CANDIDATES_PER_PUZZLE = 2 * 8 = 16. What matters is
// the ratio staying above one: a shortlist equal to the ask forces the model to clue every word it
// is handed or come back short, where over-asking lets it SKIP the words it cannot clue. Raising the
// ask without raising this trades a skip the model should take for a clue it should not have written.
export const SHORTLIST_SIZE = 40

/**
 * The shortlist for one call, keyed by normalizeAnswer, mapping to the spelling code supplies.
 *
 * Answers come from nouns.ts, never from the membership oracle: an ENABLE-shaped check admits AALII
 * and ZORIL, and a cryptic answer is shown to the player. data/known-words.ts answers "is this a
 * word"; this answers "is this a word worth showing".
 *
 * One structure, because verifyClue's round-trip and the answer lookup are the same question asked
 * twice. Values are uppercase so CrypticClueData.answer and the letter rungs need no second
 * uppercasing.
 *
 * Pure, with `random` injectable per CLAUDE.md.
 */
export const drawAnswers = (
  excluded: ReadonlySet<string>,
  count: number = SHORTLIST_SIZE,
  random: () => number = Math.random,
): ReadonlyMap<string, string> => {
  const eligible = nouns.filter(
    (word) =>
      word.length >= MIN_ANSWER_LENGTH &&
      word.length <= MAX_ANSWER_LENGTH &&
      !containsChargedWord(word) &&
      !excluded.has(normalizeAnswer(word)),
  )
  return new Map(getRandomSample(eligible, count, random).map((word) => [normalizeAnswer(word), word.toUpperCase()]))
}
