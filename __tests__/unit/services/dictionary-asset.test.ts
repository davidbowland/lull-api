import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_WORD_LETTERS, MIN_WORD_LETTERS } from '@generators/phrazle/difficulty'

// The committed asset, proved by its CONTENTS. scripts/ and layers/ are both outside
// collectCoverageFrom, so scripts/build-dictionary.ts is unmeasured by construction -- this suite is
// what stands in for coverage of the derivation, and CI's `npm run build-dictionary -- --check` is
// what proves RECALL, which no intra-list assertion can: a word wrongly dropped by a build bug is by
// definition not in the list.
//
// Deterministic. It reads one committed file and asserts properties of it; no clock, no RNG, no I/O
// beyond the read.
const ASSET_PATH = join(__dirname, '..', '..', '..', 'layers', 'dictionary', 'dictionary', 'v1.txt')

// Re-measured against the real scripts/data/enable.txt on this checkout -- 172,823 entries in,
// 141,047 out.
//
// THE SLICE NEARLY TRIPLED, from 51,852 words and 366,715 B, because the bounds it is derived from
// moved: MIN_WORD_LETTERS 3 -> 2 and MAX_WORD_LETTERS 7 -> 11. That was not a dictionary decision --
// deriveWords imports both constants from the structural floor, so the list is whatever the board
// can hold, and the board grew to admit KNOCK YOUR SOCKS OFF and PIECE OF THE ACTION.
//
// THE DOWNLOAD IS THE COST AND IT IS MEASURED RATHER THAN ESTIMATED: 358,218 B gzipped, against
// 125,645 B before. That is what the route actually serves -- it gzips at first use and memoizes --
// so the client's one-time fetch goes from ~0.12 MB to ~0.34 MB. It is a cached fetch rather
// than a per-puzzle cost, and the alternative is a board that rejects its own correct answer.
const EXPECTED_WORDS = 141_047
const EXPECTED_BYTES = 1_280_883
const EXPECTED_DIGEST = 'e32022b9711b3c78ed7994c10c23c879e3fab14c0d33dbd911560bd222d1117b'

const contents = readFileSync(ASSET_PATH, 'utf8')
const words = contents.split('\n').filter(Boolean)

describe('the committed guess dictionary', () => {
  // FIRST, and deliberately: a hand-edited line fails here before any content assertion runs, so the
  // message is "the file is not the one that was derived" rather than a property that happens to
  // still hold.
  it('matches its pinned digest', () => {
    expect(createHash('sha256').update(contents).digest('hex')).toEqual(EXPECTED_DIGEST)
  })

  it('holds the measured number of words', () => {
    expect(words).toHaveLength(EXPECTED_WORDS)
  })

  // The number the throttle arithmetic and the layer sizing are both taken against.
  it('is the measured size', () => {
    expect(Buffer.byteLength(contents, 'utf8')).toEqual(EXPECTED_BYTES)
  })

  // UPPERCASE A-Z, because everyWordInDictionary is case-sensitive and expects canonical words. A
  // lowercase entry is a word the board would reject however the player typed it.
  it('holds nothing but uppercase A-Z', () => {
    expect(words.filter((word) => !/^[A-Z]+$/.test(word))).toStrictEqual([])
  })

  // THE LOSSLESSNESS CLAIM, asserted against the predicate's own constants rather than against a
  // literal pair. A guess word must match one of the answer's per-word lengths and no answer word
  // can be outside this range, so nothing outside it can ever appear in a valid guess.
  it('holds nothing outside the word lengths the floor can produce', () => {
    expect(words.filter((word) => word.length < MIN_WORD_LETTERS || word.length > MAX_WORD_LETTERS)).toStrictEqual([])
  })

  it('is sorted and unique', () => {
    expect(words).toStrictEqual([...new Set(words)].sort())
  })

  // The words every Phrazle fixture in this repo depends on. Named here rather than discovered by a
  // failing assertion elsewhere with no message: a phrase whose word ENABLE lacks is invisible to
  // this type, and the generator's own self-check throws on it.
  // DEEP and END are the band-1 pair, added 2026-08-26 with Phrazle's third band. They are the only
  // two here that exist to satisfy a DERIVATION rather than a floor: DEEP END shares D and E across
  // its two words, which is the -1 that takes a 7-letter two-word phrase to derived 2 -- the only
  // cell of the dial that band 1 can be filled from.
  it.each([
    'TOE',
    'HOLD',
    'SPLIT',
    'SECOND',
    'BRAVE',
    'NEW',
    'WORLD',
    'UNDER',
    'THE',
    'RADAR',
    'BITE',
    'BULLET',
    'DEEP',
    'END',
  ])('holds %s, which a committed fixture phrase needs', (word) => {
    expect(words).toContain(word)
  })

  // ENABLE HOLDS NO PROPER NOUNS, and that narrows what "compact supply" means in practice rather
  // than being a curiosity. The Great Gatsby clears the structural floor (3/5/6, 14 letters) and
  // derives to 5, and is invisible to Phrazle for exactly this reason -- as is any compact whose
  // words include a name, a place or a brand. Titles are the shape most likely to carry one.
  it('holds no proper noun, so a title carrying one is invisible to this type', () => {
    expect(words).not.toContain('GATSBY')
  })
})
