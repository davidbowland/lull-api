import { randomBytes } from 'node:crypto'

import { CryptogramData, Difficulty, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { toHintLadder } from '../../utils/hints'
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
      // Wrapped HERE, at construction, and nowhere earlier. A Phrase is three bare strings all
      // the way through the model parse, the prose gates and the dedupe, because those all read
      // words; the wire is three { text } rungs, matching goFigure, so one renderer reads both.
      hints: toHintLadder(phrase.hints),
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
  availableFrom: '2026-08-01',
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
  // One target per puzzle, from the pack-wide count table. Band 4 is Cryptogram's alone and band 5
  // is left to Phrazle, whose spec makes difficulty 5 binding on every other type's band choice. A
  // cryptogram with nothing pre-filled has a floor of effort a band-1 or band-2 rating would
  // misdescribe.
  //
  // Band 3 is also the only hidden category left in the pack: CATEGORY_HIDDEN_BY_DIFFICULTY hides
  // at 3 and 5, and Missing Vowels no longer ships either.
  difficulties: [3, 4],
  generate,
  isUsablePhrase,
  // No budgetMsPerPuzzle: that field is on Generator, and a PhraseGenerator never runs on the
  // request path -- its input comes from a model call, which only happens in the async builder.
  secondsPerDifficulty: 30,
  type: PUZZLE_TYPE,
}
