import { nouns } from '../../assets/nouns'
import { normalizeAnswer } from '../../rules/normalize-answer'
import { containsChargedWord } from '../../utils/model-output-checks'
import { getRandomSample } from '../../utils/random-sample'

// The band the enumeration is stated against, and the band hints.ts asserts its answer against.
//
// EXPORTED FOR A TEST AND NOT FOR hints.ts. That module declares the same two numbers itself, which
// looks like drift waiting to happen and is the lesser of two evils: hints.ts is reachable from
// worst-case.ts, which is a LEAF so esbuild never pulls a string builder into
// GetPackByDateFunction's bundle, and an import from here would pull nouns.ts -- 2,000 lemmas -- in
// behind it. The duplication is held by an equality assertion in hints.test.ts instead, which is
// where a test can import both without shipping either.
export const MIN_ANSWER_LENGTH = 4
export const MAX_ANSWER_LENGTH = 8

// Five times the ask. A shortlist EQUAL to the ask forces the model to clue every word it is given
// or come back short, and the whole point of over-asking is that it may SKIP the words it cannot
// clue. Five times is room to skip without letting a batch drift onto whatever four words the model
// finds easiest.
export const SHORTLIST_SIZE = 40

/**
 * The shortlist for one call, keyed by normalizeAnswer, mapping to the spelling code supplies.
 *
 * ANSWERS COME FROM THE SOURCE CORPUS -- nouns.ts -- AND NOT FROM THE MEMBERSHIP ORACLE, because
 * MEMBERSHIP IS NOT GETTABILITY. An ENABLE-shaped check admits AALII and ZORIL as cryptic answers. A
 * cryptic answer is SHOWN TO THE PLAYER and has to be a word they know, which is what nouns.ts is
 * for: 2,000 concreteness-filtered lemmas, of which 1,395 sit in the 4-8 band. Using the oracle as
 * an answer source is a one-job-each violation; data/known-words.ts answers "is this a word", this
 * answers "is this a word worth showing".
 *
 * ONE STRUCTURE, because verifyClue's round-trip and the answer lookup are the same question asked
 * twice and two structures can disagree. The values are UPPERCASE: CrypticClueData.answer is the
 * code-supplied word uppercased and the two letter rungs read its first and last characters, so the
 * uppercasing happens once, here, rather than at three read sites.
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
