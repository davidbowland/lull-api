import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MIN_WORDS_PER_BAND,
  assertBandFloor,
  countByBand,
  deriveWords,
  readPinnedDigest,
  readSource,
  renderModule,
} from '../../../scripts/build-anagram-index'

// A scratch directory outside the repo, for the digest rows. Created once and removed once; nothing
// here is written inside the working tree.
const scratch = mkdtempSync(join(tmpdir(), 'anagram-index-'))
const sourcePath = join(scratch, 'enable.txt')
const digestPath = join(scratch, 'enable.sha256')

// 'abc\n' -- one entry, so the digest below is a fixed, independently checkable value rather than
// something this suite computes with the code under test.
const SCRATCH_SOURCE = 'abc\n'
const SCRATCH_DIGEST = 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb'

describe('build-anagram-index', () => {
  beforeAll(() => {
    writeFileSync(sourcePath, SCRATCH_SOURCE, 'utf8')
    writeFileSync(digestPath, `${SCRATCH_DIGEST}  enable.txt\n`, 'utf8')
  })

  afterAll(() => {
    rmSync(scratch, { force: true, recursive: true })
  })

  describe('deriveWords', () => {
    it('keeps an entry whose letters no other entry shares', () => {
      expect(deriveWords(['kettle', 'spatula', 'skillet'])).toStrictEqual(['kettle', 'skillet', 'spatula'])
    })

    it('drops both members of a class of two', () => {
      expect(deriveWords(['kettle', 'toaster', 'rotates'])).toStrictEqual(['kettle'])
    })

    it('drops entries outside the 5-9 band and entries that are not a-z', () => {
      expect(deriveWords(['pot', 'kettle', 'colanderish', 'saute-pan', 'CAFE'])).toStrictEqual(['kettle'])
    })

    it('returns the survivors sorted, so a regeneration is a reviewable diff', () => {
      expect(deriveWords(['spatula', 'kettle', 'ramekin'])).toStrictEqual(['kettle', 'ramekin', 'spatula'])
    })

    // THE SCRAMBLE SAFETY GATE, and the corpus below is deliberately missing NIGGER.
    //
    // Class-size-one proves no OTHER ENABLE ENTRY shares GINGER's letters. It proves nothing about a
    // charged word the corpus does not carry, which is invisible to a filter that only counts
    // entries -- and GINGER has 180 distinct permutations, one of which is a slur, on a type whose
    // output ships to a device that adjudicates offline. So the filter is BY KEY: the whole letter
    // class goes, whatever the corpus happens to contain.
    //
    // WATCHED RED: weakening the step-3 filter to `chargedWords.has(word.toUpperCase())` -- the
    // obvious "drop the charged words" reading -- leaves GINGER in the output and reddens this row
    // alone. The asset test over the real list cannot make this distinction, because every entry the
    // key filter removes from the committed corpus happens also to BE a charged word.
    it('drops a word that anagrams to a charged word absent from the corpus', () => {
      expect(deriveWords(['ginger', 'kettle', 'ramekin'])).toStrictEqual(['kettle', 'ramekin'])
    })

    // THE STEP-ORDER INVARIANT, over a PLANTED class of two -- one charged word, one ordinary word.
    // Neither may survive.
    //
    // Every filter applied BEFORE the grouping must be anagram-invariant, or it can remove one
    // member of a class and leave the other looking unique. Length and charset are; a blocklist read
    // as membership is not. WATCHED RED: moving the blocklist above the grouping in its membership
    // form -- `entries.filter((entry) => !chargedWords.has(entry.toUpperCase()))`, the "cheapest
    // filter first" tidy-up -- drops NIGGER from this class, admits GINGER as unique, and reddens
    // this row. A test over the correct order's output alone cannot tell the two orders apart; a
    // test with a planted collision can.
    it('drops both members of a planted charged and ordinary class', () => {
      expect(deriveWords(['ginger', 'nigger', 'kettle'])).toStrictEqual(['kettle'])
    })

    // The other half of step 3, kept because it is a strictly weaker statement than the key filter
    // and catching only it is what let the hole above exist in the first place.
    it('drops a charged word that no other entry anagrams to', () => {
      expect(deriveWords(['bollocks', 'ramekin'])).toStrictEqual(['ramekin'])
    })
  })

  describe('countByBand', () => {
    it('reports every band in the window, including an empty one', () => {
      expect(countByBand(['kettle', 'teapot', 'spatula'])).toStrictEqual({ 5: 0, 6: 2, 7: 1, 8: 0, 9: 0 })
    })
  })

  describe('assertBandFloor', () => {
    it('accepts counts at the floor', () => {
      expect(() =>
        assertBandFloor({
          5: MIN_WORDS_PER_BAND,
          6: MIN_WORDS_PER_BAND,
          7: MIN_WORDS_PER_BAND,
          8: MIN_WORDS_PER_BAND,
          9: MIN_WORDS_PER_BAND,
        }),
      ).not.toThrow()
    })

    // A floor that is not asserted is a floor nobody checks after the first run.
    it('throws naming the thin band', () => {
      expect(() => assertBandFloor({ 5: 12, 6: MIN_WORDS_PER_BAND, 7: MIN_WORDS_PER_BAND })).toThrow(
        'Band supply below 1000: {"5":12}',
      )
    })
  })

  describe('renderModule', () => {
    it('names its producer, its source and its license in the generated header', () => {
      const rendered = renderModule(['kettle'])

      expect(rendered).toContain('GENERATED by scripts/build-anagram-index.ts from scripts/data/enable.txt')
      expect(rendered).toContain('scripts/data/LICENSE-enable')
      expect(rendered).toContain('scripts/data/enable.sha256')
    })

    it('emits one quoted entry per line and a trailing newline', () => {
      expect(renderModule(['kettle', 'ramekin'])).toContain(
        "export const uniqueAnagramWords: string[] = [\n  'kettle',\n  'ramekin',\n]\n",
      )
    })
  })

  describe('readSource', () => {
    it('reads the pin from its own file rather than a script literal', () => {
      expect(readPinnedDigest(digestPath)).toEqual(SCRATCH_DIGEST)
    })

    it('returns the entries when the digest matches', () => {
      expect(readSource(sourcePath, digestPath)).toStrictEqual(['abc'])
    })

    // THROWS, never warns and never continues. Every claim downstream of this line is a claim about
    // one specific list; against a different list they are unfalsifiable rather than merely wrong,
    // and the output would still look like a word list.
    it('throws when the source does not match its pin', () => {
      const wrongDigestPath = join(scratch, 'wrong.sha256')
      writeFileSync(wrongDigestPath, `${'0'.repeat(64)}  enable.txt\n`, 'utf8')

      expect(() => readSource(sourcePath, wrongDigestPath)).toThrow('does not match its pin')
    })
  })
})
