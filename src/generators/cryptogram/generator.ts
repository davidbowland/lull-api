import { randomBytes } from 'node:crypto'

import { CryptogramData, Difficulty, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { derange } from './cipher'
import { derivedDifficulty, meetsStructuralFloor } from './difficulty'

const PUZZLE_TYPE = 'cryptogram'

// How far a phrase's derived difficulty may sit from the one being asked for. The bands are thin,
// so a zero-tolerance generator would reject almost every batch. This generator's appetite, kept
// out of difficulty.ts, which only says what a phrase IS.
const DIFFICULTY_TOLERANCE = 1

const defaultShortId = (): string => randomBytes(4).toString('hex')

// Spec 1 guarantees letters and spaces only, so anything that is not A-Z passes through untouched
// and the ciphertext keeps the answer's word boundaries. The word shapes are the puzzle.
const encipher = (text: string, cipher: Record<string, string>): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => cipher[letter])

/**
 * Whether this phrase can be a cryptogram at this difficulty. Two independent gates: the floor says
 * whether it can be a cryptogram at all, the band whether it can be THIS one.
 */
const isUsablePhrase = (phrase: Phrase, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(phrase) && Math.abs(derivedDifficulty(phrase) - difficulty) <= DIFFICULTY_TOLERANCE

// The phrase is an INPUT, handed in by the async builder that generated it. No I/O. Both sources
// of non-determinism are injectable with a default, so a test pins the cipher and the id.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  phrase: Phrase,
  createShortId: () => string = defaultShortId,
  random: () => number = Math.random,
): Promise<Puzzle<CryptogramData>> => {
  const cipher = derange(random)

  // familiarity, not just shape: it is what the band was chosen from, so without it the log cannot
  // say why this phrase carries this difficulty.
  log('Generated cryptogram puzzle', { date, difficulty, familiarity: phrase.familiarity, shape: phrase.shape })

  return {
    data: {
      // Ships to the client: offline-first means the device adjudicates locally.
      answer: phrase.text,
      // undefined, not a placeholder -- dynamodb.ts stores the pack as JSON.stringify, so an
      // omitted key disappears from the payload.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      ciphertext: encipher(phrase.text, cipher),
      // No `hints`, and `phrase.hints` is dropped on the floor here: the corpus rungs are semantic
      // by instruction, which helps recognize a phrase and not break a cipher. A cryptogram hint
      // worth spending names a letter the player has not yet got right, so the builder runs on the
      // device in lull-ui at src/components/cryptogram/rungs.ts.
      //
      // DEPLOY lull-ui FIRST AND THIS API SECOND: a new pack with no ladder reaching today's
      // lull-ui gets `hintsOf` returning null and no hint bar. This is step 0 of endpoints.rest's
      // clause (b), and only step 0 -- the rest of that clause rebuilds the pack archive, which a
      // stored pack carrying an ignored `hints` does not need.
    },
    difficulty,
    estimatedSeconds: cryptogramGenerator.baseSeconds + cryptogramGenerator.secondsPerDifficulty * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

// `generate` above reads baseSeconds and secondsPerDifficulty off this at call time. These are own
// properties of an exported object, so `const` protects the binding and not the fields.
export const cryptogramGenerator: PhraseGenerator<CryptogramData> = {
  // A literal, never read from config.ts: it is the date this TYPE shipped, not the date the
  // stack's floor happens to sit at, and an env var would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog rates Cryptogram at 3-5 minutes; base is the low end and per is (high - low) / 4.
  // Both live on the literal so a test over the registry can reach them.
  baseSeconds: 180,
  // Two a day, from the pack-wide count table. The corpus is shared and Cryptogram's filter is far
  // stricter than Missing Vowels', so asking for more would starve the type that can use anything.
  countPerDay: 2,
  // One target per puzzle, from the pack-wide count table. Band 2 is a deliberate content call: it
  // promises an elapsed time (estimatedSeconds prints 210) a full substitution cipher may not keep
  // for a slower solver, and is declared anyway because that is where the supply is -- it draws on
  // familiarity 4, which is what the generation prompt asks for. Only band 2 ships a category.
  difficulties: [2, 3],
  generate,
  isUsablePhrase,
  // No budgetMsPerPuzzle: that field is on Generator, and a PhraseGenerator never runs on the
  // request path -- its input comes from a model call, which only happens in the async builder.
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
