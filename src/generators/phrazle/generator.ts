import { randomBytes } from 'node:crypto'

import { everyWordInDictionary, isValidGuess, splitPhrase } from '../../rules/is-valid-guess'
import { markGuess } from '../../rules/mark-guess'
import { Difficulty, PackDate, Phrase, PhraseGenerator, PhrazleData, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { containsChargedWord } from '../../utils/model-output-checks'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { getDictionary } from './dictionary'
import { derivedDifficulty, meetsStructuralFloor, wordsOf } from './difficulty'

const PUZZLE_TYPE = 'phrazle'

// How far a phrase's derived difficulty may sit from the one being asked for -- this generator's
// appetite, kept out of difficulty.ts, which only says what a phrase IS.
const DIFFICULTY_TOLERANCE = 1

const defaultShortId = (): string => randomBytes(4).toString('hex')

/**
 * Whether this phrase can be a Phrazle at this difficulty.
 *
 * Clause order matters: the cheap structural gate runs first, so getDictionary() only loads the
 * asset for phrases that already look like Phrazles. The dictionary clause closes the "puzzle
 * rejects its own answer" hole, which is unrecoverable on the device. ENABLE holds no proper
 * nouns, so it also cuts titles: `The Great Gatsby` clears the floor and is still invisible here.
 */
const isUsablePhrase = (phrase: Phrase, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(phrase) &&
  everyWordInDictionary(wordsOf(phrase.text), getDictionary()) &&
  Math.abs(derivedDifficulty(phrase) - difficulty) <= DIFFICULTY_TOLERANCE

// The phrase is an INPUT, handed in by the async builder that generated it. No I/O beyond the
// memoized dictionary read, and `createShortId` is the only non-determinism.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  phrase: Phrase,
  createShortId: () => string = defaultShortId,
): Promise<Puzzle<PhrazleData>> => {
  const words = splitPhrase(phrase.text) // what the floor, the difficulty and the dictionary saw
  const answer = words.join(' ') // what ships as data.answer

  // A content gate on the code-composed string: `answer` is the only phrase-type answer that is not
  // `phrase.text` verbatim, so it gets its own check rather than inheriting its input's. Redundant
  // under today's canonicality clause, kept because that is a claim about today's floor.
  if (containsChargedWord(answer)) {
    throw new Error('Phrazle answer contains a charged word once canonicalized')
  }

  // The answer goes back through the device's own pipeline before shipping, exactly as the board
  // will run it on the first guess. Running the vendored src/rules/ files here is also what
  // catches drift in them on this side.
  if (
    !isValidGuess(
      splitPhrase(answer),
      words.map((word) => word.length),
      getDictionary(),
    )
  ) {
    throw new Error('Phrazle answer is not a valid guess for itself')
  }

  // And it must mark all green. Unreachable by proof -- markGuess throws at step 0 if the round
  // trip changed any word length -- so no test covers this branch, but "it is automatic" is the
  // class of claim a refactor falsifies.
  if (markGuess(splitPhrase(answer), words).some((word) => word.some((tile) => tile !== 'green'))) {
    throw new Error('Phrazle answer does not mark all-green against itself')
  }

  // shape and familiarity are logged and decide nothing: the tag is model-authored, so gating on it
  // would be a gate the model controls.
  log('Generated phrazle puzzle', { date, difficulty, familiarity: phrase.familiarity, shape: phrase.shape })

  return {
    data: {
      // The CANONICAL form, not phrase.text verbatim: markGuess works on canonical words.
      answer,
      // undefined, not a placeholder -- dynamodb.ts stores the pack as JSON.stringify, so an
      // omitted key disappears from the payload.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      // No `hints`: which letters are still open depends on guesses the player invents at play
      // time, so the rungs are chosen on the device by lull-ui's src/components/phrazle/rungs.ts.
      //
      // DEPLOY lull-ui FIRST AND THIS API SECOND: a new pack with no ladder reaching today's
      // lull-ui gets `hintsOf` returning null and no hint bar. This is step 0 of endpoints.rest's
      // clause (b), and only step 0 -- the rest of that clause rebuilds the pack archive, which a
      // stored pack carrying an ignored `hints` does not need.

      // No `maxGuesses`: this game is not losable, and a sentinel meaning "unlimited" would be a
      // limit claiming no limit.
    },
    difficulty,
    estimatedSeconds: phrazleGenerator.baseSeconds + phrazleGenerator.secondsPerDifficulty * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

export const phrazleGenerator: PhraseGenerator<PhrazleData> = {
  // Must sit on the day AFTER lull-ui's Phrazle board deploys: `PuzzleType` growing is a
  // wire-contract change, so the API must not emit a type the client cannot render.
  availableFrom: '2026-01-01',
  // The catalog rates Phrazle at 3-5 minutes; base is the low end and per is (high - low) / 4, so
  // difficulty 5 lands on 300. Both live on the literal so a test over the registry can reach them.
  baseSeconds: 180,
  // Must move with `difficulties`: missingDifficulties generates only DECLARED bands while
  // isComplete demands countPerDay of them, so declaring fewer bands than the count makes every
  // pack permanently incomplete with no code path able to clear it.
  countPerDay: 3,
  // Derived 1 is the one cell no other declared band can reach -- 3 takes 2-4 and 5 takes 4-5 under
  // DIFFICULTY_TOLERANCE -- so band 2 draws that breadth-1 supply. Only band 2 ships a category.
  //
  // Difficulty 5 is binding on every other type's band choice, withdrawable only through the
  // published tripwire: if the batch produces no phrase deriving exactly to 5 on more than half
  // the nights of a 14-day window, this drops to [2, 3, 4], and the count table and the
  // endpoints.rest note move with it.
  difficulties: [2, 3, 5],
  generate,
  isUsablePhrase,
  // No bestEffort: every band is reachable, so a starved band is a bad night rather than an
  // unclearable nightly ERROR. No budgetMsPerPuzzle either -- that field is on Generator, and a
  // PhraseGenerator never runs on the request path.
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
