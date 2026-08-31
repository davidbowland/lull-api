import { randomBytes } from 'node:crypto'

import { CryptogramData, Difficulty, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { derange } from './cipher'
import { derivedDifficulty, meetsStructuralFloor } from './difficulty'

const PUZZLE_TYPE = 'cryptogram'

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
      // NO `hints`, AND `phrase.hints` IS DROPPED ON THE FLOOR HERE. The phrase still carries three
      // prose rungs -- passesProseGates refuses a phrase without them, so the corpus cannot supply
      // one -- and this type stopped shipping them. They are SEMANTIC by instruction
      // (prompts/create-phrases.txt: "never about how it is written"), which is a hint for
      // recognizing a phrase and not for breaking a substitution cipher.
      //
      // Nothing replaces them in this file, and that is the design rather than an omission. A
      // cryptogram hint worth spending names a letter the player has not yet got right, which is a
      // fact about a board that does not exist until they play; the builder runs on the device
      // against that board and lives at src/rules/hint-cryptogram.ts, vendored into lull-ui. Nothing
      // in src/ imports it -- this repo executes it only in __tests__/unit/rules/, which is what
      // keeps a broken rule from reaching lull-ui unnoticed. This generator has nothing to compute
      // and no gate to fail: discarding a valid puzzle because a hint builder was unhappy would cost
      // a player a puzzle to protect a sentence nobody receives.
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
    },
    difficulty,
    estimatedSeconds: cryptogramGenerator.baseSeconds + cryptogramGenerator.secondsPerDifficulty * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

// `generate` above reads baseSeconds and secondsPerDifficulty off this binding. Order is a non-issue
// -- `generate` is a const arrow declared before this literal but only reads it at CALL time, and
// nothing under src/generators imports back into the registry index, so there is no cycle for a dead
// zone to open in. The fact that DID change is writability: a module `const` was unreachable from
// outside, while these are own properties of an exported object and `const` protects the binding
// rather than the fields. See the longer note on goFigureGenerator, where it is measured.
export const cryptogramGenerator: PhraseGenerator<CryptogramData> = {
  // 2026-08-01, a LITERAL matching PACK_START_DATE and never read from config.ts. It is the date
  // this TYPE shipped, not the date the stack's floor happens to sit at, and wiring it to an env var
  // would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog rates Cryptogram at 3-5 minutes; BASE is the low end and PER is (high - low) / 4, so
  // difficulty 5 would land exactly on 300 and the generated 3/4 sit at 240/270. This no
  // longer determines shelf position: lull-ui orders difficulty, then bench, then id, and only
  // PRINTS the number on the row. The two constants live on the literal rather than at module scope
  // because a pack-duration ceiling would sum them, and a test over the registry can reach them by
  // no other route.
  baseSeconds: 180,
  // Two a day, from the pack-wide count table. The corpus is shared and Cryptogram's filter is far
  // stricter than Missing Vowels', so asking for more would starve the type that can use anything.
  countPerDay: 2,
  // One target per puzzle, from the pack-wide count table.
  //
  // BAND 2 IS DECLARED OVER THIS FILE'S OWN OBJECTION, recorded rather than quietly dropped: the
  // previous comment argued that "a cryptogram with nothing pre-filled has a floor of effort a
  // band-1 or band-2 rating would misdescribe", and that argument is unchanged by the band moving.
  // A band-2 cryptogram is a promise about elapsed time -- estimatedSeconds prints 210 for it -- that
  // a full substitution cipher may not keep for a slower solver. It is a CONTENT call, made
  // deliberately at the pack level where the difficulty histogram is actually visible, and this note
  // is what stops it being rediscovered as a bug.
  //
  // SUPPLY GETS STRICTLY EASIER, which is the half that is measurable. derivedDifficulty is
  // 6 - familiarity either side of two ratio nudges that cannot both fire, so band 2 draws on
  // familiarity 4 and band 3 on familiarity 3 -- and the generation prompt asks for phrases an
  // ordinary adult can place, which is exactly where familiarity 4 lives. [3, 4] leaned on the
  // scarce end and difficulty.ts is a written post-mortem of a band that was empty by construction;
  // [2, 3] leans on the modal end.
  //
  // Band 3 is still the pack's hidden category on this type -- CATEGORY_HIDDEN_BY_DIFFICULTY hides
  // at 3 and 5 -- so the two cryptograms now differ in whether the category ships as well as in
  // derived difficulty. Band 2 shows it.
  difficulties: [2, 3],
  generate,
  isUsablePhrase,
  // No budgetMsPerPuzzle: that field is on Generator, and a PhraseGenerator never runs on the
  // request path -- its input comes from a model call, which only happens in the async builder.
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
