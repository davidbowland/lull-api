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

// A fresh context per call rather than a beforeEach: shared mutable state between rows is how a
// batch-dedupe row starts passing for the wrong reason.
const context = (overrides: Partial<WordContext> = {}): WordContext => ({
  seen: new Set<string>(),
  used: new Set<string>(),
  ...overrides,
})

describe('wordGateFailure', () => {
  // The catalog's worked set, minus the two words ENABLE disqualifies: TOASTER anagrams to ROTATES
  // and COLANDER to CONELRAD, so neither can ship.
  it.each(['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN', 'RAMEKIN', 'TEAPOT', 'PITCHER'])(
    'admits %s, which clears every gate',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  it('admits a lowercase word, since every gate runs on the uppercase form', () => {
    expect(wordGateFailure('kettle', context())).toBeUndefined()
  })

  // The token gate runs first, which is why it can fire: `/^[A-Z]+$/` already rejects a space, so a
  // charset check placed ahead of it would make this counter read zero forever.
  it.each([
    ['a space', 'ICE CREAM'],
    ['a hyphen', 'DEEP-DISH'],
    ['an apostrophe', "CHEF'S"],
  ])('rejects %s at the token gate', (_name, word) => {
    expect(wordGateFailure(word, context())).toEqual('tokens')
  })

  // Accents are rejected, never folded: a scramble of CAFE is not a scramble of the CAFÉ a player types.
  it.each([
    ['an accented letter', 'cafés'],
    ['a slashed O', 'FJORDØ'],
    ['a ligature', 'ÆTHERS'],
    ['a digit', 'CATCH22'],
    ['an empty string', ''],
  ])('rejects %s at the charset gate', (_name, word) => {
    expect(wordGateFailure(word, context())).toEqual('charset')
  })

  // The one case the charset identity does not catch: sharp-s uppercases to SS, so the identity holds
  // and the word is admitted at length 7. Harmless -- the answer ships as STRASSE and is typed so.
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

  // Three of one letter leaves a space dominated by arrangements a reader cannot tell apart. KETTLE
  // survives with two Ts and two Es; BANANA does not.
  it('rejects a word with three of one letter', () => {
    expect(wordGateFailure('BANANA', context())).toEqual('multiplicity')
  })

  // The sparseness floor is unreachable at MIN_WORD_LENGTH 6: the worst admissible six-letter shape
  // is three pairs at 6!/(2!2!2!) = 90, over the floor. This row goes red if the floor drops to 5.
  it('cannot be reached at the committed minimum word length', () => {
    const worstSixLetterShape = distinctPermutations('LEVELS'.split('').sort().join(''))

    expect(MIN_WORD_LENGTH).toBeGreaterThan(5)
    expect(worstSixLetterShape).toBeGreaterThanOrEqual(MIN_DISTINCT_PERMUTATIONS)
  })

  // Whole-token, over the answer. The scramble itself is gated separately, in scramble.ts.
  it('rejects a charged word', () => {
    expect(wordGateFailure('BOLLOCKS', context())).toEqual('blocklist')
  })

  // The wiring, not the list -- model-output-checks.test.ts pins which words count. Every word here
  // is in ENABLE and anagram-unique, so it clears `notUnique` and would otherwise have shipped.
  it.each(['COLOUR', 'HONOUR', 'ORGANISE', 'MOUSTACHE', 'LADYBIRD', 'MOTORWAY', 'SPLENDOUR', 'ANALYSE'])(
    'rejects the British spelling %s',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('britishSpelling')
    },
  )

  // The American forms, so a regression that inverts the check fails here rather than emptying the corpus.
  it.each(['ORGANIZE', 'MUSTACHE', 'ANALYZE', 'SPLENDOR', 'NEIGHBOR', 'BEHAVIOR', 'HARBOR', 'FLAVOR'])(
    'admits the American %s',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  // COLOR and HONOR are five letters and stop at the length gate, so the British form was the only
  // one this type could ever have shipped -- and it is a board whose answer the player cannot type.
  it.each(['COLOR', 'HONOR', 'LABOR'])('cannot ship the American %s either, for length', (word) => {
    expect(wordGateFailure(word, context())).toEqual('length')
  })

  // Checks containsChargedWord rather than the gate: at five letters these stop at the length gate,
  // so a gate assertion would pass on a blocklist that had never heard of them.
  it.each(['CUNTS', 'SPICS', 'GOOKS'])('keeps %s on the blocklist even though the length gate now hides it', (word) => {
    expect(containsChargedWord(word)).toBe(true)
  })

  // W6 reads utils/charged-terms.ts, not blocklist.ts's base forms. Each of these is an inflection
  // whose singular is listed; the gate has no stemming, so the list has to carry the forms.
  it.each(['FAGGOTS', 'BASTARDS', 'BITCHES', 'FUCKED', 'WANKERS', 'TRANNIES'])(
    'rejects %s, an inflection of a blocklist base form',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // Two categories blocklist.ts has no row for. Rows here must REACH W6: MONGOLOID is excluded
  // because three Os fail multiplicity first, GOOKS because five letters stop at the length gate.
  it.each(['CHINKS', 'WETBACK', 'SQUAWS', 'CRETINS', 'SPASTIC'])(
    'rejects %s, a slur blocklist.ts has no row for',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('blocklist')
    },
  )

  // Each is an ordinary English word with an anagram in ENABLE, so a scramble of it could be another word.
  it.each(['TOASTER', 'COLANDER', 'GRATER', 'BLENDER'])('rejects %s, whose letters spell another word', (word) => {
    expect(wordGateFailure(word, context())).toEqual('notUnique')
  })

  // `notUnique` rather than `blocklist`: none of these is a charged word, but their letters spell an
  // inflected one -- AGING/NIGGA, ENTRAIN/TRANNIE, SWANKER/WANKERS, SRADHAS/HARDASS -- so widening
  // charged-terms.ts dropped their anagram classes from the lexicon hasUniqueAnagram reads.
  it.each(['AGINGS', 'GAZING', 'ENTRAIN', 'ENTRAINS', 'SWANKER', 'SRADHAS'])(
    'rejects %s, whose letters spell an inflected charged term',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('notUnique')
    },
  )

  // AGING is five letters, so the length gate stops it before W9 and the row above would keep passing
  // against a lexicon that had let its class back in. 200 of 200 band-4 runs produced a slur.
  it('keeps AGING out of the committed lexicon even though the length gate now hides it', () => {
    expect(hasUniqueAnagram('AGING')).toBe(false)
  })

  // Reject W only when a base form of W could itself have shipped. BLEACH, KETTLE, SPATULA and
  // CABBAGE all clear every gate, so their S-forms stand where a citation form was available.
  it.each(['BLEACHES', 'KETTLES', 'SPATULAS', 'CABBAGES'])(
    'rejects %s, an S-inflection whose base form could have shipped instead',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('displacedForm')
    },
  )

  // The other side, and why the rule is not "no plurals". SPONGE anagrams to PONGES, SHOVEL to
  // HOVELS, CASTLE to CLEATS, DENTIST to STINTED -- rejecting the plural takes the concept out.
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

  // Latin-type singulars that simply end in S. None has an ENABLE base -- STATU, SURPLU, CHORU,
  // CANVA and CAMPU are not words -- so the gate never had a candidate to find.
  it.each(['SURPLUS', 'CHORUS', 'CANVAS', 'CAMPUS'])(
    'admits %s, an S-final singular with no base form beneath it',
    (word) => {
      expect(wordGateFailure(word, context())).toBeUndefined()
    },
  )

  // The -SS exclusion, which nothing else asserts: delete `|| word.endsWith('SS')` from candidateBases
  // and CUTLASS is rejected as a plural of CUTLAS, a real ENABLE word it is unrelated to.
  it('admits CUTLASS, which a missing -SS guard would reject as a plural of CUTLAS', () => {
    expect(hasUniqueAnagram('CUTLAS')).toBe(true)
    expect(wordGateFailure('CUTLASS', context())).toBeUndefined()
  })

  // STATUS belongs to the table above but notUnique takes it one gate earlier, so `toBeUndefined`
  // would be a claim about the wrong gate. Pinned as "not this gate" instead.
  it('does not reject STATUS as a displaced form, whatever the earlier gates do with it', () => {
    expect(hasUniqueAnagram('STATU')).toBe(false)
    expect(wordGateFailure('STATUS', context())).not.toEqual('displacedForm')
  })

  // Candidates come out BLEACHE (the -S rule) then BLEACH (the -ES rule). BLEACHE is not a word, so
  // a predicate that returned the first candidate's answer would admit BLEACHES.
  it('rejects BLEACHES, whose shippable base is not its first candidate', () => {
    expect(hasUniqueAnagram('BLEACHE')).toBe(false)
    expect(hasUniqueAnagram('BLEACH')).toBe(true)
    expect(wordGateFailure('BLEACHES', context())).toEqual('displacedForm')
  })

  // The F/FE class, which pluralizes through a letter change the -S and -ES rules cannot see.
  it.each(['MIDWIVES', 'PENKNIVES', 'OURSELVES'])('rejects %s, whose F or FE singular ships', (word) => {
    expect(wordGateFailure(word, context())).toEqual('displacedForm')
  })

  // SHELF is below MIN_WORD_LENGTH, so the plural is the only form this type could use. The -VE
  // candidate has to miss too, and here it does -- SHELVE collides with HELVES.
  it('admits SHELVES, whose singular is below the length floor', () => {
    expect(wordGateFailure('SHELVES', context())).toBeUndefined()
  })

  // WOLVES anagrams to VOWELS, so notUnique has it before this gate. Asserted as "not this gate" so
  // the row says something true about the VES rule rather than something false about the word.
  it('does not reject WOLVES as a displaced form, since WOLF could never have shipped', () => {
    expect(hasUniqueAnagram('WOLF')).toBe(false)
    expect(wordGateFailure('WOLVES', context())).not.toEqual('displacedForm')
  })

  // A known limitation. THIEF and WHARF cannot ship at five letters, but THIEVE and WHARVE are ENABLE
  // words the -S rule finds; the gate cannot tell "plural of THIEF" from "third person of THIEVE"
  // without part-of-speech data. The same trap catches CLOTHES, MEASLES, SHAMBLES and BELLOWS.
  it.each(['THIEVES', 'WHARVES', 'CLOTHES', 'MEASLES'])(
    'rejects %s, a known limitation: its shippable base is a verb form rather than its singular',
    (word) => {
      expect(wordGateFailure(word, context())).toEqual('displacedForm')
    },
  )

  // A word reaches this gate only by clearing notUnique, so it is in the index by construction and
  // every candidate base gets a real yes or no from the same ENABLE -- no not-in-corpus default.
  it('reaches a verdict from a total oracle, with no not-in-corpus case left to default', () => {
    expect(hasUniqueAnagram('CANVA')).toBe(false)
    expect(hasUniqueAnagram('BLEACH')).toBe(true)
    expect(wordGateFailure('CANVAS', context())).toBeUndefined()
    expect(wordGateFailure('BLEACHES', context())).toEqual('displacedForm')
  })

  // Measured against the real index: 14,557 rejected of the 64,135 words that clear every other
  // gate, 22.70%. Bounded below as well, because deleting the displacedForm branch takes the share
  // to zero and a lone ceiling would report a gate that no longer exists as healthy.
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

  // A model repeating one word across all twelve sets would otherwise read as a thin batch, so it
  // gets its own counter.
  it('rejects a word already admitted elsewhere in the batch', () => {
    expect(wordGateFailure('KETTLE', context({ seen: new Set(['KETTLE']) }))).toEqual('duplicateInBatch')
  })
})
