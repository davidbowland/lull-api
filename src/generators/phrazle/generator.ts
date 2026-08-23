import { randomBytes } from 'node:crypto'

import { everyWordInDictionary, isValidGuess, splitPhrase } from '../../rules/is-valid-guess'
import { markGuess } from '../../rules/mark-guess'
import { Difficulty, PackDate, Phrase, PhraseGenerator, PhrazleData, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { containsChargedWord } from '../../utils/model-output-checks'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { getDictionary } from './dictionary'
import { derivedDifficulty, meetsStructuralFloor, wordsOf } from './difficulty'
import { buildHints } from './hints'

const PUZZLE_TYPE = 'phrazle'

// How far a phrase's derived difficulty may sit from the one being asked for -- this generator's
// appetite, kept out of difficulty.ts, which only says what a phrase IS. The same two-gate shape
// Cryptogram uses, for the same stated reason.
const DIFFICULTY_TOLERANCE = 1

// Six, flat, from the catalog. It ships ON THE WIRE rather than as a client constant: the backend
// decides every game rule, and six is a game rule.
const MAX_GUESSES = 6

const defaultShortId = (): string => randomBytes(4).toString('hex')

/**
 * Whether this phrase can be a Phrazle at this difficulty.
 *
 * FOUR CONJUNCTS AND THE ORDER IS LOAD-BEARING: the three structural clauses, then the dictionary,
 * then the band.
 *
 * THE CHEAP STRUCTURAL GATE RUNS FIRST, and that is not cosmetic. getDictionary() is only reached
 * for phrases that already look like Phrazles, so a batch with no compacts in it never loads the
 * asset at all -- and no request path can reach it, because a phrase generator never runs inside a
 * request by construction.
 *
 * THE DICTIONARY CLAUSE CLOSES THE "PUZZLE REJECTS ITS OWN ANSWER" HOLE OUTRIGHT, which is the one
 * failure that is UNRECOVERABLE ON THE DEVICE: the player types the correct answer, is told it is
 * not a word, and there is no path to a fix that does not involve a deploy. Trusting the corpus
 * instead ships that failure the first time the model returns a plural ENABLE lacks. generate()
 * re-runs the same rule over the canonical answer, so it is enforced twice on two different strings.
 *
 * ENABLE HOLDS NO PROPER NOUNS, so this clause cuts titles harder than the shape tags suggest: `The
 * Great Gatsby` clears the structural floor and derives to 5 and is invisible to this type, as is
 * any compact whose words include a name, a place or a brand. That is the right trade -- a title the
 * player cannot type is worse than a title Phrazle never uses -- and it is stated so nobody reads
 * the supply figures as covering it.
 */
const isUsablePhrase = (phrase: Phrase, difficulty: Difficulty): boolean =>
  meetsStructuralFloor(phrase) &&
  everyWordInDictionary(wordsOf(phrase.text), getDictionary()) &&
  Math.abs(derivedDifficulty(phrase) - difficulty) <= DIFFICULTY_TOLERANCE

// The phrase is an INPUT, handed in by the async builder that generated it. This generator does no
// I/O beyond the memoized dictionary read, and `createShortId` is the ONLY injected non-determinism
// -- there is no `random` parameter, because nothing here is random.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  phrase: Phrase,
  createShortId: () => string = defaultShortId,
): Promise<Puzzle<PhrazleData>> => {
  const words = splitPhrase(phrase.text) // what the floor, the difficulty and the dictionary saw
  const answer = words.join(' ') // what ships as data.answer

  // THE CONTENT GATE ON THE CODE-COMPOSED STRING, and it is here because of what this type does
  // differently: `answer` is the only phrase-type answer that is not `phrase.text` verbatim, so the
  // string a player sees is COMPOSED IN CODE. Themed Anagrams shipped a slur precisely because a
  // build-time filter covered only listed words while code invented the player-visible string, and
  // the lesson is that the composed string gets its own check rather than inheriting its input's.
  //
  // The floor's canonicality clause already makes this provably redundant -- it rejects any phrase
  // whose text is not canonical up to spacing and case, so `answer` can only ever be the gated text
  // uppercased and single-spaced, and splitPhrase never merges two words into one. It is still run,
  // because "provably redundant" is a claim about today's floor and this costs one Set lookup per
  // token. Either way this throw costs ONE puzzle through the per-call catch in services/packs.ts.
  if (containsChargedWord(answer)) {
    throw new Error('Phrazle answer contains a charged word once canonicalized')
  }

  // THE SELF-CHECK, AND IT CAN ACTUALLY FAIL. The answer is put back through the device's own
  // pipeline before it is allowed to ship: isValidGuess re-reads the dictionary and re-checks the
  // shape against wordLengths derived from the SHIPPED string, exactly as the board will on the
  // first guess. Offline-first means a board that rejects its own answer is unrecoverable on the
  // device -- there is no server to patch it from.
  //
  // It goes red whenever the canonical answer contains a word the committed dictionary lacks, or
  // whenever canonicalization changes a word's length after the floor measured it. This is also half
  // of what the src/rules/ exception was granted on: lull-api EXECUTES both vendored files on every
  // generated puzzle, so a drift on this side is caught on the first puzzle, in the right file. An
  // earlier draft proposed markGuess(words, words), which is a tautology -- one array passed as both
  // parameters is green at every position for any content whatsoever.
  if (
    !isValidGuess(
      splitPhrase(answer),
      words.map((word) => word.length),
      getDictionary(),
    )
  ) {
    throw new Error('Phrazle answer is not a valid guess for itself')
  }

  // And it must mark all green. THIS ONE IS HONEST ABOUT WHAT IT IS: splitPhrase(words.join(' ')) and
  // `words` are two arrays computed by two different routes, so it is not the identity comparison
  // above -- but it is unreachable-by-proof rather than merely untriggered, because markGuess throws
  // at step 0 if the round trip changed the word count or any word length, and pass 1 consumes every
  // letter otherwise. No test claims to cover this branch; a test that could not fail would be worse
  // than none. It is asserted anyway because "it is automatic" is the class of claim a refactor
  // falsifies.
  if (markGuess(splitPhrase(answer), words).some((word) => word.some((tile) => tile !== 'green'))) {
    throw new Error('Phrazle answer does not mark all-green against itself')
  }

  // shape and familiarity go HERE and nowhere that decides anything. The tag is model-authored, so
  // gating on it would be a gate the model controls.
  log('Generated phrazle puzzle', { date, difficulty, familiarity: phrase.familiarity, shape: phrase.shape })

  return {
    data: {
      // The CANONICAL form, not phrase.text verbatim. The board paints these characters as tiles and
      // marks them with markGuess, which works on canonical words.
      answer,
      // undefined, not a placeholder. dynamodb.ts stores the pack as JSON.stringify, so an omitted
      // key simply disappears from the payload. With difficulties [3, 5] and the shared visibility
      // table hiding at 3 and 5, THIS TYPE SHIPS NO CATEGORY EVER, on either puzzle -- deliberate,
      // because a category in a guessing game narrows the semantic space and both of these bands are
      // hard ones.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      // Three CODE-BUILT reveals off the canonical answer, never toHintLadder: the shared prose
      // ladder's rung 3 is near-explicit by instruction, and here recognizing the phrase is the
      // entire game.
      hints: buildHints(answer),
      maxGuesses: MAX_GUESSES,
    },
    difficulty,
    estimatedSeconds: phrazleGenerator.baseSeconds + phrazleGenerator.secondsPerDifficulty * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

// `generate` above reads baseSeconds and secondsPerDifficulty off this binding, exactly as its two
// siblings do.
export const phrazleGenerator: PhraseGenerator<PhrazleData> = {
  // FORWARD OF TODAY ON PURPOSE, and it must be moved to the day AFTER lull-ui's Phrazle board
  // deploys before this type appears on any wire. `PuzzleType` growing is a wire-contract change and
  // lull-ui's registry is keyed on it, so the API must not emit a type the client cannot render.
  // Every pack before this date keeps reporting complete without Phrazle, so no archived date
  // converts to incomplete and no backfill fans out.
  availableFrom: '2026-09-01',
  // The catalog rates Phrazle at 3-5 minutes; BASE is the range's low end and PER is (high - low) / 4,
  // so difficulty 5 lands exactly on 300 and the generated 3/5 sit at 240/300. The two constants live
  // on the literal rather than at module scope because the pack-duration ceiling sums them, and a
  // test over the registry can reach them by no other route.
  baseSeconds: 180,
  // Two a day, from the pack-wide count table.
  countPerDay: 2,
  // [3, 5] over [4, 5]. Band 4 is Cryptogram's top declared band and, by its own comment, its
  // scarcest; taking it would put two types in competition at the one band already documented as
  // nearly empty. Band 3 is the modal derived difficulty and is supplied several times over, and it
  // stops the type existing only at the hard end of the shelf.
  //
  // DIFFICULTY 5 IS BINDING ON EVERY OTHER TYPE'S BAND CHOICE -- nobody else may plan around band 5
  // being free -- and is withdrawable only through the published tripwire: if the batch produces no
  // phrase deriving EXACTLY to 5 on more than half the nights of a 14-day window, this drops to
  // [3, 4] and both cross-type comments, the count table and the endpoints.rest note move with it.
  // A promise between types is only worth making if there is a stated condition under which it is
  // withdrawn.
  difficulties: [3, 5],
  generate,
  isUsablePhrase,
  // No bestEffort. The foundation makes it a claim a spec must ARGUE for, and this type cannot:
  // difficulty.test.ts's fifteen-row derivation shows both bands reachable, so a starved band here
  // is a bad night rather than an unclearable nightly ERROR.
  //
  // No budgetMsPerPuzzle either: that field is on Generator, and a PhraseGenerator never runs on the
  // request path by construction.
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
