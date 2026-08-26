import { randomBytes } from 'node:crypto'

import { Difficulty, MissingVowelsData, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { toHintLadder } from '../../utils/hints'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { Aggression, respace, stripVowels } from './respace'

const PUZZLE_TYPE = 'missingvowels'

// The two dials the catalog names, made concrete. Respacing aggression is the primary one and is
// this type's own; whether the category is shown AT ALL is the secondary and is shared by every
// phrase type, so it lives in ../category-visibility. The spacing dial escalates on the EVEN steps,
// and the category dial alternates within each spacing tier.
//
// (An earlier comment claimed the secondary "moves on the odd steps so the two do not both jump at
// once". That is false -- at 3->4 aggression goes 1->2 and the category flips together.)
//
//   1 -- boundaries may coincide by chance, category shown
//   2 -- boundaries never coincide,          category shown
//   3 -- boundaries never coincide,          category hidden
//   4 -- chunk count also lies,              category shown
//   5 -- chunk count also lies,              category hidden
//
// Rows 1, 2 and 4 are generated: `difficulties` is [1, 2, 4] against countPerDay 3. Rows 3 and 5 are
// defined for completeness and are dead today -- which means THIS TYPE STILL NEVER HIDES ITS
// CATEGORY, because CATEGORY_HIDDEN_BY_DIFFICULTY hides only at 3 and 5 and this type declares
// neither. The hidden-category experience belongs to Cryptogram at band 3 and Phrazle at 3 and 5.
//
// Band 4 is the first AGGRESSION 2 puzzle this pack has ever shipped -- the chunk COUNT lies, not
// just the boundaries -- so it is the row where a respacing can claim a four-word phrase is three
// words. That is the intended step up from band 2 and it is the whole of what makes 4 harder here.
const AGGRESSION_BY_DIFFICULTY: Record<Difficulty, Aggression> = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2 }

// Below this the consonant run cannot be regrouped into anything that misleads -- two chunks of
// two letters gives the player almost nothing to be misled by.
const MIN_CONSONANTS = 6

export const isUsablePhrase = (phrase: Phrase): boolean => stripVowels(phrase.text).consonants.length >= MIN_CONSONANTS

const defaultShortId = (): string => randomBytes(4).toString('hex')

// The phrase is an INPUT, handed in by the async builder that generated it. This generator does no
// I/O at all: it reads nothing, writes nothing, and cannot fail for want of a stored corpus. The
// difficulty is likewise an input, and the id carries no position.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  phrase: Phrase,
  createShortId: () => string = defaultShortId,
  random: () => number = Math.random,
): Promise<Puzzle<MissingVowelsData>> => {
  const { consonants, wordSizes } = stripVowels(phrase.text)
  const displayed = respace(consonants, wordSizes, AGGRESSION_BY_DIFFICULTY[difficulty], random)

  log('Generated missing vowels puzzle', { date, difficulty, shape: phrase.shape })

  return {
    data: {
      answer: phrase.text,
      // undefined, not a placeholder. dynamodb.ts stores the pack as JSON.stringify, so an omitted
      // key simply disappears from the payload the UI reads.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      displayed,
      // Wrapped HERE, at construction, and nowhere earlier. A Phrase is three bare strings all
      // the way through the model parse, the prose gates and the dedupe, because those all read
      // words; the wire is three { text } rungs, matching goFigure, so one renderer reads both.
      hints: toHintLadder(phrase.hints),
    },
    difficulty,
    estimatedSeconds:
      missingVowelsGenerator.baseSeconds + missingVowelsGenerator.secondsPerDifficulty * (difficulty - 1),
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
export const missingVowelsGenerator: PhraseGenerator<MissingVowelsData> = {
  // 2026-08-01, a LITERAL matching PACK_START_DATE and never read from config.ts. It is the date
  // this TYPE shipped, not the date the stack's floor happens to sit at, and wiring it to an env var
  // would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog gives Missing Vowels a 1-2 minute range; BASE is the low end and PER is
  // (high - low) / 4, so difficulty 5 would land exactly on 120. The shelf PRINTS estimatedSeconds
  // on every row; it no longer sorts on it. The two constants live on the literal rather than at
  // module scope because a pack-duration ceiling would sum them, and a test over the registry can
  // reach them by no other route.
  baseSeconds: 60,
  // THREE a day, from the pack-wide count table, and it moved with `difficulties` rather than after
  // it -- see the invariant note on phrazle's countPerDay, which is the same one.
  //
  // This type is corpus-bounded and the CHEAPEST of the corpus consumers -- isUsablePhrase is a
  // six-consonant floor and nothing else, with no difficulty term in it at all -- so a band added
  // here costs one phrase and no supply risk. That is the same property that used to make it the one
  // that could shrink; it works in both directions.
  countPerDay: 3,
  // One target per puzzle, and the bands come from the pack-wide count table rather than from this
  // file: a number chosen per generator produces a pack whose difficulty histogram nobody has
  // looked at.
  //
  // BAND 4 WAKES A ROW THAT WAS DEFINED AND DEAD. AGGRESSION_BY_DIFFICULTY has always mapped 4 to
  // aggression 2 -- chunk count also lies, the most misleading respacing this type does -- and the
  // comment above that table said rows 3, 4 and 5 were "defined for completeness and are dead
  // today". They are no longer all dead: this is the first respacing at aggression 2 the pack has
  // ever shipped, so it is the first band of this type whose boundaries AND chunk count both
  // mislead.
  //
  // The category stays visible at all three: CATEGORY_HIDDEN_BY_DIFFICULTY hides only at 3 and 5,
  // and this type declares neither.
  //
  // There is no inRequest grade here. A phrase generator never runs inside a request by
  // construction: its input comes from a model call, and that only happens in the async builder.
  difficulties: [1, 2, 4],
  generate,
  // Declared since this generator shipped and called from nowhere until now, so MIN_CONSONANTS was
  // unenforced in production: a four-consonant phrase reached respace and produced a puzzle with
  // almost nothing in it to be misled by. Ignores the difficulty -- a phrase Missing Vowels can use
  // at all it can use at every band.
  isUsablePhrase,
  // No budgetMsPerPuzzle, for the same reason there is no inRequest grade above: that field is on
  // Generator, and a PhraseGenerator never runs on the request path by construction.
  secondsPerDifficulty: 15,
  type: PUZZLE_TYPE,
}
