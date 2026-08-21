import { randomBytes } from 'node:crypto'

import { CryptogramData, Difficulty, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { derange } from './cipher'
import { derivedDifficulty, meetsStructuralFloor } from './difficulty'

const PUZZLE_TYPE = 'cryptogram'

// The catalog rates Cryptogram at 3-5 minutes, so 210/240/270 sits inside it. This no longer
// determines shelf position: lull-ui orders difficulty, then bench, then id, and only PRINTS this
// number on the row.
const BASE_SECONDS = 180
const SECONDS_PER_DIFFICULTY = 30

// How far a phrase's derived difficulty may sit from the one being asked for. The bands are thin --
// with familiarity 3 a phrase derives to 2, 3 or 4 depending on the two structural flags -- so a
// zero-tolerance generator would reject almost every batch. It is this generator's appetite and
// belongs here rather than in difficulty.ts, which only says what a phrase IS.
const DIFFICULTY_TOLERANCE = 1

const defaultShortId = (): string => randomBytes(4).toString('hex')

// Spec 1 guarantees letters and spaces only, so anything that is not A-Z passes through untouched
// and the ciphertext keeps the answer's word boundaries. The word shapes are the puzzle.
const encipher = (text: string, cipher: Record<string, string>): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => cipher[letter])

/**
 * Whether this phrase can be a cryptogram at this difficulty.
 *
 * Two independent gates. The floor says whether it can be a cryptogram at all; the band says
 * whether it can be THIS one.
 */
const isUsablePhrase = (phrase: Phrase, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(phrase) && Math.abs(derivedDifficulty(phrase) - difficulty) <= DIFFICULTY_TOLERANCE

// The phrase is an INPUT, handed in by the async builder that generated it. This generator does no
// I/O at all, and the difficulty is likewise an input. Both sources of non-determinism are
// injectable with a default, so a test pins the cipher and the id rather than the clock.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  phrase: Phrase,
  createShortId: () => string = defaultShortId,
  random: () => number = Math.random,
): Promise<Puzzle<CryptogramData>> => {
  const cipher = derange(random)

  // familiarity, not just shape: it is what the band was chosen from, so without it the log says
  // which difficulty was produced but nothing about why this phrase could carry it.
  log('Generated cryptogram puzzle', { date, difficulty, familiarity: phrase.familiarity, shape: phrase.shape })

  return {
    data: {
      // Ships to the client, exactly as Missing Vowels ships its own: offline-first means the device
      // adjudicates locally, and the pack is already on it.
      answer: phrase.text,
      // undefined, not a placeholder. dynamodb.ts stores the pack as JSON.stringify, so an omitted
      // key simply disappears from the payload the UI reads.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      ciphertext: encipher(phrase.text, cipher),
      hints: phrase.hints,
    },
    difficulty,
    estimatedSeconds: BASE_SECONDS + SECONDS_PER_DIFFICULTY * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

export const cryptogramGenerator: PhraseGenerator<CryptogramData> = {
  // Three a day. The corpus is shared with Missing Vowels and Cryptogram's filter is far stricter,
  // so asking for more would starve the type that can use anything.
  countPerDay: 3,
  // No difficulty 1 and no difficulty 5. A cryptogram with nothing pre-filled has a floor of effort
  // that a "gentle" rating would misdescribe, and the catalog leaves the top band to Phrazle.
  difficulties: [2, 3, 4],
  generate,
  isUsablePhrase,
  type: PUZZLE_TYPE,
}
