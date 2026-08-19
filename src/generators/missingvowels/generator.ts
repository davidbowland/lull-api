import { randomBytes } from 'node:crypto'

import { getLatestCorpus, markCorpusEntriesUsed } from '../../services/dynamodb'
import { CorpusEntry, Difficulty, Generator, MissingVowelsData, PackDate, Puzzle } from '../../types'
import { log } from '../../utils/logging'
import { Aggression, respace, stripVowels } from './respace'

const PUZZLE_TYPE = 'missingvowels'

// The catalog gives Missing Vowels a 1-2 minute range, so difficulty 1 sits at the bottom and
// difficulty 5 at the top. The shelf sorts on this number.
const BASE_SECONDS = 60
const SECONDS_PER_DIFFICULTY = 15

// Below this the consonant run cannot be regrouped into anything that misleads -- two chunks of
// two letters gives the player almost nothing to be misled by.
const MIN_CONSONANTS = 6

// The two dials the catalog names, made concrete. Respacing aggression is the primary one;
// category specificity is the secondary, and it moves on the odd steps so the two do not both
// jump at once.
//
//   1 -- boundaries may coincide by chance, generous category
//   2 -- boundaries never coincide, generous category
//   3 -- boundaries never coincide, weak category
//   4 -- chunk count also lies, generous category
//   5 -- chunk count also lies, weak category
const AGGRESSION_BY_DIFFICULTY: Record<Difficulty, Aggression> = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2 }
const BROAD_CATEGORY_BY_DIFFICULTY: Record<Difficulty, boolean> = {
  1: false,
  2: false,
  3: true,
  4: false,
  5: true,
}

const defaultShortId = (): string => randomBytes(4).toString('hex')

// Prefers `title`, which the catalog calls this type's natural shape, but never requires it. A
// night that came back light on titles must still produce four puzzles rather than none, which is
// the same reasoning that keeps the shape tag a preference everywhere else.
const selectEntry = (available: CorpusEntry[], random: () => number): CorpusEntry => {
  const titles = available.filter((entry) => entry.shape === 'title')
  const pool = titles.length > 0 ? titles : available
  return pool[Math.floor(random() * pool.length)]
}

const isUsable = (entry: CorpusEntry): boolean => stripVowels(entry.text).consonants.length >= MIN_CONSONANTS

// The difficulty is an INPUT, never derived from a slot or an index, and the id carries no
// position -- identity is an opaque address generated once.
const generate = async (
  date: PackDate,
  difficulty: Difficulty,
  random: () => number = Math.random,
  createShortId: () => string = defaultShortId,
): Promise<Puzzle<MissingVowelsData>> => {
  // Read on every call, because the Generator contract passes only a date and a difficulty. One
  // Query per puzzle is the price of leaving that contract untouched for every other type, and it
  // is what the system design means by "a generator reading a stored corpus is doing I/O and is
  // still fast".
  const corpus = await getLatestCorpus()
  if (!corpus) {
    // Costs one puzzle through createPack's per-generate catch, never the pack. On a stack with no
    // corpus yet, goFigure still fills the day.
    throw new Error(`Cannot generate ${PUZZLE_TYPE}: no corpus is stored`)
  }

  const used = new Set(corpus.usedIds)
  const available = corpus.entries.filter((entry) => !used.has(entry.id) && isUsable(entry))
  if (available.length === 0) {
    throw new Error(`Cannot generate ${PUZZLE_TYPE}: no unused corpus entries remain in ${corpus.date}`)
  }

  const entry = selectEntry(available, random)
  const { consonants, wordSizes } = stripVowels(entry.text)
  const displayed = respace(consonants, wordSizes, AGGRESSION_BY_DIFFICULTY[difficulty], random)

  // Marked before the pack is written, so a pack that loses its conditional put burns these
  // entries. That is accepted: the corpus carries deliberate headroom, and the alternative is
  // threading consumed ids back through a Generator contract every other type would then carry.
  await markCorpusEntriesUsed(corpus.date, [entry.id])

  log('Generated missing vowels puzzle', { corpusDate: corpus.date, date, difficulty, entryId: entry.id })

  return {
    data: {
      answer: entry.text,
      category: BROAD_CATEGORY_BY_DIFFICULTY[difficulty] ? entry.categoryBroad : entry.categorySpecific,
      displayed,
    },
    difficulty,
    estimatedSeconds: BASE_SECONDS + SECONDS_PER_DIFFICULTY * (difficulty - 1),
    id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
    type: PUZZLE_TYPE,
  }
}

export const missingVowelsGenerator: Generator<MissingVowelsData> = {
  // Four a day, per the system design's launch distribution: corpus-bounded, and the cheapest of
  // the three corpus consumers.
  countPerDay: 4,
  // One target per puzzle. The hardest band is left to Cryptogram and Phrazle, which the catalog
  // rates at 3-5 minutes each -- making the lightest type in the pack also carry its hardest
  // puzzle would invert the shelf's sort.
  difficulties: [1, 2, 3, 4],
  generate,
  // Graded, not inherited from the tier, and graded on numbers rather than on the assumption that
  // string manipulation is cheap.
  //
  // No model call is the necessary half: the one Bedrock call feeding this type runs nightly in
  // CreateCorpusFunction, and this generator only reads what that stored.
  //
  // The sufficient half is wall clock. Measured over 200 trials with the storage layer stubbed, a
  // full four-puzzle pack costs 0.17ms at p50 and 0.33ms at p95 of CPU -- the respacing search is
  // nothing. The real cost is I/O: four Query calls and four UpdateItem calls, so roughly 80ms at
  // a pessimistic 10ms per in-region round trip. Against goFigure's 9.7ms worst case, a full pack
  // fill lands near 100ms -- two orders of magnitude inside the 10-second fill budget, and inside
  // the eight-sequential-request prefetch that multiplies it.
  inRequest: true,
  type: PUZZLE_TYPE,
}
