import { randomBytes } from 'node:crypto'

import { Difficulty, MissingVowelsData, PackDate, Phrase, PhraseGenerator, Puzzle } from '../../types'
import { toHintLadder } from '../../utils/hints'
import { log } from '../../utils/logging'
import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '../category-visibility'
import { Aggression, respace, stripVowels } from './respace'

const PUZZLE_TYPE = 'missingvowels'

// The two dials the catalog names, made concrete. Respacing aggression is this type's own; category
// visibility is shared by every phrase type and lives in ../category-visibility.
//
//   1 -- boundaries may coincide by chance, category shown
//   2 -- boundaries never coincide,          category shown
//   3 -- boundaries never coincide,          category hidden
//   4 -- chunk count also lies,              category shown
//   5 -- chunk count also lies,              category hidden
//
// Only rows 1, 2 and 4 ship, and the category hides at 3 and 5 only, so this type never hides it.
const AGGRESSION_BY_DIFFICULTY: Record<Difficulty, Aggression> = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2 }

// Below this the consonant run cannot be regrouped into anything misleading.
const MIN_CONSONANTS = 6

export const isUsablePhrase = (phrase: Phrase): boolean => stripVowels(phrase.text).consonants.length >= MIN_CONSONANTS

const defaultShortId = (): string => randomBytes(4).toString('hex')

// The phrase and the difficulty are inputs, handed in by the async builder. This generator does no
// I/O: it reads nothing, writes nothing, and cannot fail for want of a stored corpus.
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
      // undefined, not a placeholder: the pack is stored as JSON.stringify, so the key disappears.
      category: CATEGORY_HIDDEN_BY_DIFFICULTY[difficulty] ? undefined : phrase.category,
      displayed,
      // Wrapped here at construction, not earlier: a Phrase stays three bare strings through the
      // model parse, the prose gates and the dedupe, and the wire is three { text } rungs.
      hints: toHintLadder(phrase.hints),
    },
    difficulty,
    estimatedSeconds:
      missingVowelsGenerator.baseSeconds + missingVowelsGenerator.secondsPerDifficulty * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

// `generate` above reads baseSeconds and secondsPerDifficulty off this binding at call time. These
// are own properties of an exported object, so `const` protects the binding and not the fields.
export const missingVowelsGenerator: PhraseGenerator<MissingVowelsData> = {
  // A literal matching PACK_START_DATE and never read from config.ts: this is the date the type
  // shipped, and wiring it to an env var would make a code fact into a deploy fact.
  availableFrom: '2026-01-01',
  // The catalog gives Missing Vowels a 1-2 minute range; base is the low end and secondsPerDifficulty
  // is (high - low) / 4, so difficulty 5 would land exactly on 120.
  baseSeconds: 60,
  // From the pack-wide count table, and it moves with `difficulties` rather than after it. This type
  // is the cheapest corpus consumer, so a band added here costs one phrase and no supply risk.
  countPerDay: 3,
  // Also from the count table. Band 4 is the only aggression-2 row that ships. No inRequest grade --
  // a phrase generator's input comes from a model call, which only happens in the async builder.
  difficulties: [1, 2, 4],
  generate,
  // Ignores the difficulty: a phrase Missing Vowels can use at all it can use at every band.
  isUsablePhrase,
  // No budgetMsPerPuzzle: that field is on Generator, and a PhraseGenerator never runs in-request.
  secondsPerDifficulty: 15,
  type: PUZZLE_TYPE,
}
