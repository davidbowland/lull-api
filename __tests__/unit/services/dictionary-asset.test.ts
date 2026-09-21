import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DICTIONARY_MAX_WORD_LETTERS, DICTIONARY_MIN_WORD_LETTERS } from '../../../scripts/build-dictionary'
import { MAX_WORD_LETTERS, MIN_WORD_LETTERS } from '@generators/phrazle/difficulty'

// The committed asset, proved by its CONTENTS. scripts/ and layers/ are outside
// collectCoverageFrom, so this suite stands in for coverage of the derivation. CI's
// `npm run build-dictionary -- --check` proves RECALL, which no intra-list assertion can.
const ASSET_PATH = join(__dirname, '..', '..', '..', 'layers', 'dictionary', 'dictionary', 'v1.txt')

// Measured against the real scripts/data/enable.txt: 172,823 entries in, 141,047 out, 358,218 B
// gzipped over the wire. The file is frozen, served and cached on devices, so it is not rebuilt
// when the structural floor narrows. The bounds it IS derived from live in build-dictionary.ts.
const EXPECTED_WORDS = 141_047
const EXPECTED_BYTES = 1_280_883
const EXPECTED_DIGEST = 'e32022b9711b3c78ed7994c10c23c879e3fab14c0d33dbd911560bd222d1117b'

const contents = readFileSync(ASSET_PATH, 'utf8')
const words = contents.split('\n').filter(Boolean)

describe('the committed guess dictionary', () => {
  // First, deliberately: a hand-edited line fails here before any content assertion runs.
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

  // everyWordInDictionary is case-sensitive, so a lowercase entry is a word the board rejects.
  it('holds nothing but uppercase A-Z', () => {
    expect(words.filter((word) => !/^[A-Z]+$/.test(word))).toStrictEqual([])
  })

  // The slice's own bounds, which is what the committed file is derived from.
  it('holds nothing outside the bounds it is derived from', () => {
    expect(
      words.filter((word) => word.length < DICTIONARY_MIN_WORD_LETTERS || word.length > DICTIONARY_MAX_WORD_LETTERS),
    ).toStrictEqual([])
  })

  // A containment, not an equality: a slice wider than the floor rejects nothing a player can
  // type, so equality would mean rewriting a cache-warm asset whenever the floor narrows. The
  // direction that IS a defect is a floor outside the list, which puts a word on the board the
  // device's dictionary refuses -- unrecoverable, since there is no server to patch it from.
  it('contains every word length the floor can produce', () => {
    expect(MIN_WORD_LETTERS).toBeGreaterThanOrEqual(DICTIONARY_MIN_WORD_LETTERS)
    expect(MAX_WORD_LETTERS).toBeLessThanOrEqual(DICTIONARY_MAX_WORD_LETTERS)
  })

  it('is sorted and unique', () => {
    expect(words).toStrictEqual([...new Set(words)].sort())
  })

  // The words every Phrazle fixture in this repo depends on, named here rather than discovered
  // by a message-less failure elsewhere: the generator's own self-check throws on a missing word.
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
    'WEATHER',
    'RADAR',
    'BITE',
    'BULLET',
    'SNAKE',
    'EYES',
    'KNOCK',
    'YOUR',
    'SOCKS',
    'OFF',
  ])('holds %s, which a committed fixture phrase needs', (word) => {
    expect(words).toContain(word)
  })

  // ENABLE holds no proper nouns, which narrows what "compact supply" means: any phrase carrying
  // a name, a place or a brand is invisible to Phrazle, and titles most often do.
  it('holds no proper noun, so a title carrying one is invisible to this type', () => {
    expect(words).not.toContain('GATSBY')
  })
})
