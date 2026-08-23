import { WordContext, wordGateFailure } from '@generators/themedanagrams/words'

// A fresh context per call, written as a named helper rather than a beforeEach: shared mutable state
// between rows is how a batch-dedupe test starts passing for the wrong reason.
const context = (overrides: Partial<WordContext> = {}): WordContext => ({
  seen: new Set<string>(),
  used: new Set<string>(),
  ...overrides,
})

describe('wordGateFailure', () => {
  // The catalog's own worked set, minus the two words ENABLE disqualifies -- TOASTER anagrams to
  // ROTATES and COLANDER to CONELRAD, so neither can ship whatever the design's illustrations say.
  // Naming the substitutes here rather than quietly swapping them is the point: the gate that
  // removed them is the one doing the most work in this type.
  it.each(['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN', 'RAMEKIN', 'TEAPOT', 'PITCHER'])(
    'admits %s, which clears every gate',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  it('admits a lowercase word, since every gate runs on the uppercase form', () => {
    expect(wordGateFailure('kettle', context())).toBeUndefined()
  })

  // THE TOKEN GATE RUNS FIRST, and that is why it can fire at all. `/^[A-Z]+$/` already rejects a
  // space, so a charset check placed ahead of it would make this counter read zero forever -- a
  // counter that cannot move rather than a gate that never fires.
  it.each([
    ['a space', 'ICE CREAM'],
    ['a hyphen', 'DEEP-DISH'],
    ['an apostrophe', "CHEF'S"],
  ])('rejects %s at the token gate', (_name, word) => {
    expect(wordGateFailure(word, context())).toEqual('tokens')
  })

  // ACCENTS ARE REJECTED, NEVER FOLDED: a scramble of CAFE is not a scramble of the CAFÉ a player
  // would have to type. The identity against normalizeAnswer is what makes that checkable.
  it.each([
    ['an accented letter', 'cafés'],
    ['a slashed O', 'FJORDØ'],
    ['a ligature', 'ÆTHERS'],
    ['a digit', 'CATCH22'],
    ['an empty string', ''],
  ])('rejects %s at the charset gate', (_name, word) => {
    expect(wordGateFailure(word, context())).toEqual('charset')
  })

  // The one case the identity does NOT catch, pinned so nobody reads the promise as total: sharp-s
  // uppercases to SS and normalizes to SS, so the identity holds and the word is admitted -- at
  // length 7 rather than 6, because the fold changes the length the later gates measure. Harmless:
  // the answer ships as STRASSE and the player types STRASSE.
  it('admits a sharp-s word, which the charset identity cannot reject', () => {
    expect('straße'.toUpperCase()).toEqual('STRASSE')
    expect(wordGateFailure('straße', context())).not.toEqual('charset')
  })

  it.each([
    ['too short', 'CUPS'],
    ['too long', 'CORKSCREWS'],
  ])('rejects a word that is %s', (_name, word) => {
    expect(wordGateFailure(word, context())).toEqual('length')
  })

  // Three of one letter leaves a scramble space dominated by arrangements a reader cannot tell
  // apart. KETTLE survives with two Ts and two Es; BANANA does not.
  it('rejects a word with three of one letter', () => {
    expect(wordGateFailure('BANANA', context())).toEqual('multiplicity')
  })

  // The sparseness floor, and it binds only at length 5: two repeated pairs leaves 30 distinct
  // strings, which is exactly the shape whose hardest-band acceptable set is routinely empty.
  it('rejects a five-letter word with two repeated pairs', () => {
    expect(wordGateFailure('LEVEL', context())).toEqual('permutations')
  })

  // Whole-token and over the ANSWER. The scramble is gated twice elsewhere: at build time by
  // sorted-letter key, and at generate time on the composed string in scramble.ts.
  it('rejects a charged word', () => {
    expect(wordGateFailure('BOLLOCKS', context())).toEqual('blocklist')
  })

  // W6 READS utils/charged-terms.ts, NOT the 21 vendored base forms, and these are the rows that say
  // so. Every one of them is an inflection whose singular is vendored, reaches this gate as a whole
  // token, and was ADMITTED AS AN ANSWER on the narrower list -- the gate has no stemming and is
  // never getting any, so the list has to carry the forms.
  it.each(['FAGGOTS', 'BASTARDS', 'BITCHES', 'CUNTS', 'FUCKED', 'SPICS', 'WANKERS', 'TRANNIES'])(
    'rejects %s, an inflection of a vendored base form',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // The two categories the vendored list never had a row for. CHINKS and GOOKS are five letters with
  // no repeat, so they clear length, multiplicity and the permutation floor and land squarely on this
  // gate; on the old list they landed on nothing.
  // MONGOLOID is deliberately not in this table: three Os, so it fails the multiplicity gate two
  // rows earlier and would assert nothing about the blocklist. Rows here must be words that REACH W6.
  it.each(['CHINKS', 'GOOKS', 'WETBACK', 'SQUAWS', 'CRETINS', 'SPASTIC'])(
    'rejects %s, a slur the vendored list has no row for',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // The gate that does the most work. Every one of these is a real, ordinary English word; each has
  // an anagram in ENABLE, so a scramble of it could be another word and the type cannot use it.
  it.each(['TOASTER', 'COLANDER', 'GRATER', 'BLENDER'])('rejects %s, whose letters spell another word', (word) => {
    expect(wordGateFailure(word, context())).toEqual('notUnique')
  })

  /**
   * THE SEVEN WORDS THE INCIDENT WAS FOUND THROUGH, and the gate each now fails.
   *
   * `notUnique` rather than `blocklist`, and the distinction is the whole diagnosis: not one of these
   * is a charged word, so W6 never had anything to say about them. What they have in common is that
   * their LETTERS spell an inflected charged term -- AGING/NIGGA, ENTRAIN/TRANNIE, SWANKER/WANKERS,
   * SRADHAS/HARDASS -- so widening charged-terms.ts widened the build script's key filter, which
   * dropped each of their anagram classes from the committed lexicon, which is what hasUniqueAnagram
   * now reads. AGING was the live one: it cleared all nine gates and its only band-4 acceptable
   * scramble was a slur, 200 runs out of 200.
   */
  it.each(['AGING', 'AGINGS', 'GAZING', 'ENTRAIN', 'ENTRAINS', 'SWANKER', 'SRADHAS'])(
    'rejects %s, whose letters spell an inflected charged term',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('notUnique')
    },
  )

  it('rejects a word a recent pack already used, keyed on the normalized form', () => {
    expect(wordGateFailure('kettle', context({ used: new Set(['KETTLE']) }))).toEqual('recentlyUsed')
  })

  // W9. A model repeating one word across all twelve sets is a distinctive failure that would
  // otherwise read as a thin batch, which is why it gets its own counter rather than sharing one.
  it('rejects a word already admitted elsewhere in the batch', () => {
    expect(wordGateFailure('KETTLE', context({ seen: new Set(['KETTLE']) }))).toEqual('duplicateInBatch')
  })
})
