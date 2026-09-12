import { uniqueAnagramWords } from '@generators/themedanagrams/data/anagram-words'
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

  // W6 READS utils/charged-terms.ts, NOT blocklist.ts's 21 base forms, and these are the rows that say
  // so. Every one of them is an inflection whose singular is in blocklist.ts, reaches this gate as a whole
  // token, and was ADMITTED AS AN ANSWER on the narrower list -- the gate has no stemming and is
  // never getting any, so the list has to carry the forms.
  //
  // CUNTS and SPICS LEFT THIS TABLE when MIN_WORD_LENGTH went to 6. They are five letters, so they
  // now stop at the length gate two rows earlier and would assert nothing about the blocklist --
  // the same rule this file already applies to MONGOLOID below. They did not stop mattering: the
  // blocklist is asserted to know them directly, in the block under this one.
  it.each(['FAGGOTS', 'BASTARDS', 'BITCHES', 'FUCKED', 'WANKERS', 'TRANNIES'])(
    'rejects %s, an inflection of a blocklist base form',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // The two categories blocklist.ts never had a row for. CHINKS is six letters with no repeat,
  // so it clears length and multiplicity and lands squarely on this gate; on the old list it landed
  // on nothing.
  // MONGOLOID is deliberately not in this table: three Os, so it fails the multiplicity gate two
  // rows earlier and would assert nothing about the blocklist. Rows here must be words that REACH W6.
  // GOOKS left for the same reason CUNTS and SPICS did -- five letters, stopped by the length floor
  // -- and is asserted against the blocklist directly below.
  it.each(['CHINKS', 'WETBACK', 'SQUAWS', 'CRETINS', 'SPASTIC'])(
    'rejects %s, a slur blocklist.ts has no row for',
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

  /*
   * THE COMPLAINT WAS NEVER "PLURALS". It was a plural where a singular would have done, and these
   * two tables are the same rule read from both sides: reject W only when a base form of W could
   * ITSELF have shipped.
   *
   * BLEACH, KETTLE, SPATULA and CABBAGE all clear every gate, so their S-forms are standing in a
   * place a citation form was available for.
   */
  it.each(['BLEACHES', 'KETTLES', 'SPATULAS', 'CABBAGES'])(
    'rejects %s, an S-inflection whose base form could have shipped instead',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('displacedForm')
    },
  )

  // The other side, and the reason the rule is not "no plurals". SPONGE anagrams to PONGES, SHOVEL
  // to HOVELS, CASTLE to CLEATS and DENTIST to STINTED -- not one of these singulars can ship, so
  // rejecting the plural would take the CONCEPT out of the game rather than improve the word.
  it.each(['SPONGES', 'SHOVELS', 'CASTLES', 'DENTISTS'])(
    'admits %s, whose base form collides and could never have shipped',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  // The bases themselves, which is what the gate is holding the place open for.
  it.each(['BLEACH', 'KETTLE', 'SPATULA', 'CABBAGE'])('admits %s, the base form itself', (word) => {
    expect(wordGateFailure(word, context())).toBeUndefined()
  })

  // Latin-type singulars that simply end in S. None has an ENABLE base at all -- STATU, SURPLU,
  // CHORU, CANVA and CAMPU are not words -- so the gate never had a candidate to find, and the
  // -SS exclusion is not what saves them.
  it.each(['SURPLUS', 'CHORUS', 'CANVAS', 'CAMPUS'])(
    'admits %s, an S-final singular with no base form beneath it',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  /*
   * THE -SS EXCLUSION, WHICH NOTHING ASSERTED UNTIL THIS ROW. The comment above says it is not what
   * saves the Latin singulars, which reads as though something else covers it. Nothing did: delete
   * `|| word.endsWith('SS')` from candidateBases and the whole suite stays green, because it changes
   * only ten words in the entire corpus and none of them was named anywhere.
   *
   * CUTLASS is the one to hold. Strip its S and CUTLAS is a real ENABLE word that clears every gate,
   * so without the guard a Latin-shaped singular gets rejected as the plural of a word it has no
   * relationship to. That is the same error as THIEVES, reached by a different road, and unlike
   * THIEVES it is cheap to prevent -- a doubled S is never an English plural ending.
   */
  it('admits CUTLASS, which a missing -SS guard would reject as a plural of CUTLAS', () => {
    expect(hasUniqueAnagram('CUTLAS')).toBe(true)
    expect(wordGateFailure('CUTLASS', context())).toBeUndefined()
  })

  // STATUS belongs to the table above and cannot be asserted through it: its letters spell another
  // ENABLE word, so notUnique takes it one gate earlier and `toBeUndefined` would be a claim about
  // the wrong gate. Pinned as "not this gate" instead, which is the part the Latin-singular class is
  // being checked for -- STATU is not a word, so there was never a candidate base to find.
  it('does not reject STATUS as a displaced form, whatever the earlier gates do with it', () => {
    expect(hasUniqueAnagram('STATU')).toBe(false)
    expect(wordGateFailure('STATUS', context())).not.toEqual('displacedForm')
  })

  /*
   * EVERY CANDIDATE BASE IS TESTED, NOT THE FIRST ONE FOUND, and BLEACHES is the row that proves it.
   *
   * Its candidates come out in order BLEACHE (the -S rule) and then BLEACH (the -ES rule). BLEACHE
   * is not a word, so a predicate that looked up the first candidate and returned its answer would
   * admit BLEACHES -- the exact word the whole rule was written for.
   */
  it('rejects BLEACHES, whose shippable base is not its first candidate', () => {
    expect(hasUniqueAnagram('BLEACHE')).toBe(false)
    expect(hasUniqueAnagram('BLEACH')).toBe(true)
    expect(wordGateFailure('BLEACHES', context())).toEqual('displacedForm')
  })

  // The F/FE class, which pluralizes through a letter change the -S and -ES rules cannot see.
  // MIDWIFE, PENKNIFE and OURSELF all ship, so their VES forms are displacing a citation form.
  it.each(['MIDWIVES', 'PENKNIVES', 'OURSELVES'])('rejects %s, whose F or FE singular ships', (word) => {
    expect(wordGateFailure(word, context())).toEqual('displacedForm')
  })

  // The short-singular half of the same class, unaffected for a reason owned by a different
  // constant: WOLF and SHELF are four and five letters, below MIN_WORD_LENGTH, so they were never
  // shippable and the plural is the only form this type could ever have used. The -VE candidate has
  // to miss as well, and here it does -- SHELVE collides with HELVES. Where that form ships instead,
  // the plural goes, which is the THIEVES case recorded below.
  it('admits SHELVES, whose singular is below the length floor', () => {
    expect(wordGateFailure('SHELVES', context())).toBeUndefined()
  })

  // WOLVES is the same case and stops at a different gate: it anagrams to VOWELS, so notUnique has
  // it before this one ever runs. Asserted as "not this gate" rather than as an admission, so the
  // row says something true about the VES rule instead of something false about the word.
  it('does not reject WOLVES as a displaced form, since WOLF could never have shipped', () => {
    expect(hasUniqueAnagram('WOLF')).toBe(false)
    expect(wordGateFailure('WOLVES', context())).not.toEqual('displacedForm')
  })

  /*
   * A KNOWN LIMITATION, PINNED AS A ROW SO IT IS A DECISION RATHER THAN A SURPRISE.
   *
   * THIEVES and WHARVES are rejected, and their true singulars are not why. THIEF and WHARF are five
   * letters and cannot ship, so no citation form was ever available -- but THIEVE and WHARVE are
   * themselves ENABLE words that clear every gate, and the -S rule finds them. The gate cannot tell
   * "plural of THIEF" from "third person of THIEVE" without part-of-speech data this repo does not
   * have and deliberately declined to add.
   *
   * THE CLASS IS BIGGER THAN THESE TWO, AND AN EARLIER DRAFT OF THIS COMMENT SAID OTHERWISE. It put
   * the count at "two words out of 14,557 rejections", which was measured only over the -VES words
   * whose true singular ends in F or FE. The rule is the same wherever a shippable base happens to
   * be a verb or a rare form rather than the word's own singular, and the same reasoning that traps
   * THIEVES traps every lexical plural with no singular at all: CLOTHES (base CLOTHE), MEASLES
   * (MEASLE), SHAMBLES (SHAMBLE), BELLOWS (BELLOW). Those concepts leave the game entirely rather
   * than appearing in their singular, which is the outcome the rule's relaxed form was written to
   * prevent -- so this is a real and unclosed gap, not a rounding error.
   *
   * ITS SIZE IS MEASURED, NOT GUESSED. Of the 14,557 words this gate rejects, 52 are themselves
   * noun lemmas in scripts/data/concreteness-brysbaert-2014.txt whose shippable base is NOT a noun
   * there -- the signature of a lexical plural. That set is the candidate rescue list and it is not
   * clean: it holds SCRATCHES and CYMBALS, whose bases sit in that corpus tagged Verb and Adjective
   * rather than Noun, so a non-noun tag reads as a lexical plural and rescues them wrongly.
   *
   * Accepted for now because the fix is a design decision rather than a correction: it needs
   * part-of-speech data at runtime, which means a generated module, a pin and a CI re-derivation --
   * exactly the branch ADR-1 withdrew. Recorded here so the next reader inherits the measurement
   * rather than the earlier claim.
   */
  it.each(['THIEVES', 'WHARVES', 'CLOTHES', 'MEASLES'])(
    'rejects %s, a known limitation: its shippable base is a verb form rather than its singular',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('displacedForm')
    },
  )

  /*
   * NO NOT-IN-CORPUS BRANCH, BECAUSE THE SIGNAL IS TOTAL -- and that is what this row asserts.
   *
   * A word only reaches this gate by clearing notUnique, so it is in the index by construction, and
   * the index is derived from the same ENABLE the base lookup reads. Every candidate base therefore
   * gets a real yes or no from the same oracle: CANVA is answered "no" as flatly as BLEACH is
   * answered "yes". There is no third outcome to default, permissively or otherwise, which is the
   * difference between this gate and a familiarity signal that has to guess about words it has never
   * heard of.
   */
  it('reaches a verdict from a total oracle, with no not-in-corpus case left to default', () => {
    expect(hasUniqueAnagram('CANVA')).toBe(false)
    expect(hasUniqueAnagram('BLEACH')).toBe(true)
    expect(wordGateFailure('CANVAS', context())).toBeUndefined()
    expect(wordGateFailure('BLEACHES', context())).toEqual('displacedForm')
  })

  /*
   * THE CORPUS-LEVEL BOUND, committed as a number so a future widening of the predicate fails HERE
   * rather than in a thin pack three weeks later.
   *
   * Measured today against the real index: 14,557 rejected out of the 64,135 words that clear every
   * other gate -- 22.70%, leaving 49,578 admissible. The bound is set just above it. A change that
   * quietly doubles the rejection is a supply decision that has to be argued for, and this row is
   * where the argument starts.
   *
   * BOUNDED ON BOTH SIDES, because a ceiling alone is not a bound. Delete the displacedForm branch
   * from wordGateFailure and the rejected share becomes zero, which passes a lone toBeLessThan and
   * reports a gate that no longer exists as healthy. The floor is what makes this row fail when the
   * gate stops firing, and it is set well below the measurement for the same reason the ceiling sits
   * above it -- to catch a collapse, not to pin the exact number.
   */
  it('rejects under a quarter of the words that clear every other gate, and is not silently inert', () => {
    const verdicts = uniqueAnagramWords.map((word) => wordGateFailure(word, context()))
    const admitted = verdicts.filter((gate) => gate === undefined).length
    const displaced = verdicts.filter((gate) => gate === 'displacedForm').length

    expect(displaced / (admitted + displaced)).toBeLessThan(0.25)
    expect(displaced / (admitted + displaced)).toBeGreaterThan(0.15)
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
