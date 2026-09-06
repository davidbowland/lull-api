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
// appetite, kept out of difficulty.ts, which only says what a phrase IS. The same two-gate shape
// Cryptogram uses, for the same stated reason.
const DIFFICULTY_TOLERANCE = 1

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
      // key simply disappears from the payload.
      //
      // THIS SAID "THIS TYPE SHIPS NO CATEGORY EVER" and it was never a property of this type: the
      // declared bands were [3, 5], the shared table hides at exactly 3 and 5, and the two coincided.
      // Nothing here chose it and nothing would have caught it changing. Under [2, 3, 5] the band-2
      // puzzle carries a category and the other two do not, which is the same rule producing a
      // different answer -- the rationale that used to sit here (a category narrows the semantic
      // space, and both bands are hard ones) still holds for 3 and 5 and never applied to 2.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      // NO `hints`, and TWO ladders were rejected to get here rather than one. The shared prose
      // ladder never applied -- its rungs describe what the phrase MEANS, and here recognizing the
      // phrase is the entire game, so this type never called toHintLadder. What replaced it was
      // three code-built positional reveals off the canonical answer, `Letter 1 of word 1 is T.`,
      // and those were letter-shaped but BLIND: they named a position without regard for what the
      // player's guesses had already colored in, so a rung routinely spent itself proving something
      // four guesses had proved.
      //
      // Which letters are still open is a fact about guesses the player invents at play time, which
      // no generator can enumerate in advance -- the admission criterion for src/rules/ -- so the
      // rungs are chosen on the device and nothing is built here. The builder is
      // src/components/phrazle/rungs.ts in lull-ui. It met that criterion and STILL left this repo,
      // which is not a contradiction: the criterion admits a rule to src/rules/, and src/rules/ is
      // for rules BOTH repos run. Nothing in src/ ever imported this one, so it had one caller in one
      // repo and now lives there, with its tests.
      //
      // DEPLOY lull-ui FIRST AND THIS API SECOND. Removing `hints` from a type that has been live
      // since PACK_START_DATE is endpoints.rest's clause (b), whose step 0 is shipping the client's
      // reader first; a new pack with no ladder reaching today's lull-ui gets `hintsOf` returning
      // null and no hint bar at all. The client can go first because its adapter computes the ladder
      // from `answer`, which already ships. The full argument, including why the stale-pack
      // direction needs no ordering, is in generators/themedanagrams/contribution.ts beside the
      // mirror-image rule it follows from.
      //
      // STEP 0 ALONE, AND STEP 1 MUST NOT BE RUN. Clause (b) lists seven steps and the rest of them
      // delete the pack archive and rebuild it. None applies here: a stored pack that still carries
      // `hints` is ignored rather than misread, so there is nothing to rebuild and therefore nothing
      // to delete first. endpoints.rest names the steps one at a time for this change; read that
      // list before running anything out of it.

      // NO `maxGuesses`, and no field replaces it. This game is not losable: a player guesses until
      // the phrase falls. The limit shipped as six here, which was the right shape for a rule the
      // backend owns and the wrong rule, and a sentinel meaning "unlimited" would be a limit field
      // claiming to have no limit.
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
  availableFrom: '2026-01-01',
  // The catalog rates Phrazle at 3-5 minutes; BASE is the range's low end and PER is (high - low) / 4,
  // so difficulty 5 lands exactly on 300 and the generated 3/5 sit at 240/300. The two constants live
  // on the literal rather than at module scope because the pack-duration ceiling sums them, and a
  // test over the registry can reach them by no other route.
  baseSeconds: 180,
  // THREE a day, from the pack-wide count table, and it moved with `difficulties` rather than after
  // it. types.ts states the invariant -- one target per puzzle, length === countPerDay -- and it is
  // enforced by consequence, not by a compiler: missingDifficulties generates only DECLARED
  // difficulties while isComplete demands countPerDay of them, so declaring fewer bands than the
  // count makes every pack permanently incomplete with no code path able to clear it.
  countPerDay: 3,
  // Band 2 joins [3, 5]. Cryptogram vacated 4 for [2, 3] on the same change, so the old objection to
  // band 4 -- two types competing at the band its own file documented as nearly empty -- is spent
  // rather than answered; this type simply was not the one that moved into it.
  //
  // TWO, NOT ONE, AND THE DIAL IS WHY. The pack-wide reshuffle first asked this type for band 1, and
  // band 1 IS OUT OF THIS TYPE'S RANGE: derivedDifficulty cannot return it. widthOf's floor is 3, the
  // word-count term adds 0 at two words, and the shared-letter bonus subtracts at most 1, so the
  // derivation bottoms out at 2 and the MIN_DIFFICULTY clamp below it is unreachable. Measured over
  // 63 realistic compact phrases: 0 derived to 1, 7 derived to 2. A declared band 1 would have been
  // fillable only through DIFFICULTY_TOLERANCE from that same derived-2 cell -- which is to say band
  // 1 and band 2 would have been THE SAME PUZZLE drawn from the same seven-in-sixty-three supply,
  // one of them mislabelled.
  //
  // So the band moved to the bottom of the range that exists rather than the bottom of Difficulty.
  // Band 2 lands on a real cell, and it does not collide with 3 or 5.
  //
  // BAND 2 SHIPS A CATEGORY, and that is a reversal worth naming: the comment in generate() said
  // "THIS TYPE SHIPS NO CATEGORY EVER" and was true only because [3, 5] happened to be exactly the
  // two bands CATEGORY_HIDDEN_BY_DIFFICULTY hides at. Nothing about this type asked for that; it
  // fell out of the band choice, and the band choice has changed.
  //
  // DIFFICULTY 5 IS BINDING ON EVERY OTHER TYPE'S BAND CHOICE -- nobody else may plan around band 5
  // being free -- and is withdrawable only through the published tripwire: if the batch produces no
  // phrase deriving EXACTLY to 5 on more than half the nights of a 14-day window, this drops to
  // [2, 3, 4] and both cross-type comments, the count table and the endpoints.rest note move with it.
  // A promise between types is only worth making if there is a stated condition under which it is
  // withdrawn.
  difficulties: [2, 3, 5],
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
