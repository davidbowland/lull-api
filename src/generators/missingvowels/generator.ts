import { randomBytes } from 'node:crypto'

import { Difficulty, MissingVowelsData, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { Aggression, respace, stripVowels } from './respace'

const PUZZLE_TYPE = 'missingvowels'

// The catalog gives Missing Vowels a 1-2 minute range, so difficulty 1 sits at the bottom and
// difficulty 5 at the top. The shelf PRINTS this number on every row; it no longer sorts on it.
const BASE_SECONDS = 60
const SECONDS_PER_DIFFICULTY = 15

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
// Difficulty 5 is never generated: `difficulties` is [1, 2, 3, 4] against countPerDay 4, so each
// difficulty appears once a day and the hidden category fires on exactly one of the four. Row 5 is
// defined for completeness and is dead today.
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
      hints: phrase.hints,
    },
    difficulty,
    estimatedSeconds: BASE_SECONDS + SECONDS_PER_DIFFICULTY * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

export const missingVowelsGenerator: PhraseGenerator<MissingVowelsData> = {
  // Four a day, per the system design's launch distribution: corpus-bounded, and the cheapest of
  // the three corpus consumers.
  countPerDay: 4,
  // One target per puzzle. The hardest band is left to Cryptogram and Phrazle, which the catalog
  // rates at 3-5 minutes each -- making the lightest type in the pack also carry its hardest
  // puzzle would invert the shelf's sort.
  //
  // There is no inRequest grade here. A phrase generator never runs inside a request by
  // construction: its input comes from a model call, and that only happens in the async builder.
  difficulties: [1, 2, 3, 4],
  generate,
  // Declared since this generator shipped and called from nowhere until now, so MIN_CONSONANTS was
  // unenforced in production: a four-consonant phrase reached respace and produced a puzzle with
  // almost nothing in it to be misled by. Ignores the difficulty -- a phrase Missing Vowels can use
  // at all it can use at every band.
  isUsablePhrase,
  type: PUZZLE_TYPE,
}
