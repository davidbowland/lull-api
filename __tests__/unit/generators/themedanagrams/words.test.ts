import { distinctPermutations } from '@generators/themedanagrams/letters'
import { hasUniqueAnagram } from '@generators/themedanagrams/lexicon'
import {
  MIN_DISTINCT_PERMUTATIONS,
  MIN_WORD_LENGTH,
  WordContext,
  wordGateFailure,
} from '@generators/themedanagrams/words'
import { containsChargedWord } from '@utils/model-output-checks'

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

  /*
   * THE SPARSENESS FLOOR IS UNREACHABLE AT THE COMMITTED BAND, and this row says so on purpose
   * rather than pretending to exercise it.
   *
   * It bound only at length 5 -- LEVEL, two repeated pairs, 30 distinct strings -- and
   * MIN_WORD_LENGTH is 6 now. Under MAX_LETTER_MULTIPLICITY the WORST six-letter shape is three
   * pairs at 6!/(2!2!2!) = 90, comfortably over the floor, so no admissible word can fail this gate.
   *
   * The gate stays because it is correct and costs nothing, and this assertion is what stops it
   * rotting into the unreachable backstop words.ts opens by warning about: lower MIN_WORD_LENGTH
   * back to 5 without thinking and this row goes red, which is the conversation that should happen.
   */
  it('cannot be reached at the committed minimum word length', () => {
    const worstSixLetterShape = distinctPermutations('LEVELS'.split('').sort().join(''))

    expect(MIN_WORD_LENGTH).toBeGreaterThan(5)
    expect(worstSixLetterShape).toBeGreaterThanOrEqual(MIN_DISTINCT_PERMUTATIONS)
  })

  // Whole-token and over the ANSWER. The scramble is gated twice elsewhere: at build time by
  // sorted-letter key, and at generate time on the composed string in scramble.ts.
  it('rejects a charged word', () => {
    expect(wordGateFailure('BOLLOCKS', context())).toEqual('blocklist')
  })

  /*
   * THE BLOCKLIST ITSELF, for the forms MIN_WORD_LENGTH now hides.
   *
   * CUNTS, SPICS and GOOKS used to be asserted through wordGateFailure and cannot be any more: at
   * five letters they stop at the length gate, so that assertion would pass on a blocklist that had
   * never heard of them. The gate ordering changed; what the list must contain did not.
   *
   * This is deliberately a check on containsChargedWord rather than on the gate. The length floor is
   * a supply decision and could move again in either direction; whether utils/charged-terms.ts knows
   * these words must not depend on it, and a reader who lowers the floor gets the gate rows back
   * without ever having lost the coverage.
   */
  it.each(['CUNTS', 'SPICS', 'GOOKS'])('keeps %s on the blocklist even though the length gate now hides it', (word) => {
    expect(containsChargedWord(word)).toBe(true)
  })

  // W6 READS utils/charged-terms.ts, NOT the 21 vendored base forms, and these are the rows that say
  // so. Every one of them is an inflection whose singular is vendored, reaches this gate as a whole
  // token, and was ADMITTED AS AN ANSWER on the narrower list -- the gate has no stemming and is
  // never getting any, so the list has to carry the forms.
  //
  // CUNTS and SPICS LEFT THIS TABLE when MIN_WORD_LENGTH went to 6. They are five letters, so they
  // now stop at the length gate two rows earlier and would assert nothing about the blocklist --
  // the same rule this file already applies to MONGOLOID below. They did not stop mattering: the
  // blocklist is asserted to know them directly, in the block under this one.
  it.each(['FAGGOTS', 'BASTARDS', 'BITCHES', 'FUCKED', 'WANKERS', 'TRANNIES'])(
    'rejects %s, an inflection of a vendored base form',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // The two categories the vendored list never had a row for. CHINKS is six letters with no repeat,
  // so it clears length and multiplicity and lands squarely on this gate; on the old list it landed
  // on nothing.
  // MONGOLOID is deliberately not in this table: three Os, so it fails the multiplicity gate two
  // rows earlier and would assert nothing about the blocklist. Rows here must be words that REACH W6.
  // GOOKS left for the same reason CUNTS and SPICS did -- five letters, stopped by the length floor
  // -- and is asserted against the blocklist directly below.
  it.each(['CHINKS', 'WETBACK', 'SQUAWS', 'CRETINS', 'SPASTIC'])(
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
  it.each(['AGINGS', 'GAZING', 'ENTRAIN', 'ENTRAINS', 'SWANKER', 'SRADHAS'])(
    'rejects %s, whose letters spell an inflected charged term',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('notUnique')
    },
  )

  /*
   * AGING, THE LIVE ONE, ASSERTED BELOW THE GATE THAT NOW HIDES IT.
   *
   * It is five letters, so MIN_WORD_LENGTH 6 stops it before W9 and the row above would have gone on
   * passing against a lexicon that had let its class back in -- the failure mode this whole block
   * exists to prevent, reintroduced by a supply change made for unrelated reasons.
   *
   * The length floor is a supply decision. Whether the committed lexicon still excludes AGING's
   * anagram class is a SAFETY property, it was found the hard way -- 200 runs out of 200 produced a
   * slur as its only band-4 acceptable scramble -- and it must not be contingent on a number tuned
   * for how many sets survive a batch.
   */
  it('keeps AGING out of the committed lexicon even though the length gate now hides it', () => {
    expect(hasUniqueAnagram('AGING')).toBe(false)
  })

  it('rejects a word a recent pack already used, keyed on the normalized form', () => {
    expect(wordGateFailure('kettle', context({ used: new Set(['KETTLE']) }))).toEqual('recentlyUsed')
  })

  // W9. A model repeating one word across all twelve sets is a distinctive failure that would
  // otherwise read as a thin batch, which is why it gets its own counter rather than sharing one.
  it('rejects a word already admitted elsewhere in the batch', () => {
    expect(wordGateFailure('KETTLE', context({ seen: new Set(['KETTLE']) }))).toEqual('duplicateInBatch')
  })
})
