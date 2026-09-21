import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DICTIONARY_MAX_WORD_LETTERS, DICTIONARY_MIN_WORD_LETTERS } from '../../../scripts/build-dictionary'
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
// THE SLICE NEARLY TRIPLED, from 51,852 words and 366,715 B, when the structural floor moved from
// 3-7 letters a word to 2-11 -- the board grew to admit KNOCK YOUR SOCKS OFF and PIECE OF THE
// ACTION, and deriveWords imported the floor's two constants, so the list grew with it.
//
// IT DID NOT SHRINK WHEN THE FLOOR CAME BACK DOWN TO 2-9, and that is the reason deriveWords no
// longer reads those constants. Every figure below is unchanged because layers/dictionary/v1.txt is
// unchanged: the file is frozen, served, and already cached on devices, and a slice wider than the
// floor rejects nothing -- a guess is checked against the ANSWER's word lengths as well as against
// the list. The bounds it IS derived from now live in scripts/build-dictionary.ts.
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

  // THE SLICE'S OWN BOUNDS, which is what the committed file is actually derived from.
  it('holds nothing outside the bounds it is derived from', () => {
    expect(
      words.filter((word) => word.length < DICTIONARY_MIN_WORD_LETTERS || word.length > DICTIONARY_MAX_WORD_LETTERS),
    ).toStrictEqual([])
  })

  // THE LOSSLESSNESS CLAIM, AND IT IS A CONTAINMENT RATHER THAN AN EQUALITY. It used to assert the
  // list's bounds equal to the structural floor's, which is stronger than the claim it stands for
  // and fails in the harmless direction: a guess word must match one of the ANSWER's per-word
  // lengths as well as be in the list, so a slice wider than the floor rejects nothing a player can
  // legitimately type. That distinction became load-bearing when MAX_WORD_LETTERS came down from 11
  // to 9 -- an equality would have demanded rewriting a frozen, served, cache-warm asset to delete
  // words no board will ask about.
  //
  // The direction that IS a defect is a floor outside the list, which puts a word on the board that
  // the device's own dictionary will refuse -- unrecoverable, because there is no server to patch it
  // from. scripts/build-dictionary.ts throws on it before writing; this row fails on it too.
  it('contains every word length the floor can produce', () => {
    expect(MIN_WORD_LETTERS).toBeGreaterThanOrEqual(DICTIONARY_MIN_WORD_LETTERS)
    expect(MAX_WORD_LETTERS).toBeLessThanOrEqual(DICTIONARY_MAX_WORD_LETTERS)
  })

  it('is sorted and unique', () => {
    expect(words).toStrictEqual([...new Set(words)].sort())
  })

  // The words every Phrazle fixture in this repo depends on. Named here rather than discovered by a
  // failing assertion elsewhere with no message: a phrase whose word ENABLE lacks is invisible to
  // this type, and the generator's own self-check throws on it.
  // DEEP AND END HAVE LEFT THIS LIST, along with the note that used to explain them. They were
  // added for DEEP END, a seven-tile board that the nine-tile Phrazle floor now rejects outright --
  // so no fixture phrase needs either word, and a row here that no fixture depends on is a claim
  // about the corpus wearing the costume of a dependency.
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

  // ENABLE HOLDS NO PROPER NOUNS, and that narrows what "compact supply" means in practice rather
  // than being a curiosity. The Great Gatsby clears the structural floor (3/5/6, 14 letters) and
  // derives to 1, and is invisible to Phrazle for exactly this reason -- as is any compact whose
  // words include a name, a place or a brand. Titles are the shape most likely to carry one.
  it('holds no proper noun, so a title carrying one is invisible to this type', () => {
    expect(words).not.toContain('GATSBY')
  })
})
