import {
  MAX_LENGTH,
  MIN_ENTRIES,
  MIN_LENGTH,
  assertEntryFloor,
  deriveWords,
  readPinnedDigest,
  readSource,
  renderModule,
} from '../../../scripts/build-cryptic-words'
import { chargedTerms } from '@utils/charged-terms'

// The script is exported as pure functions and a guarded main(), so this suite never reads the
// 172,823-line corpus except in the two rows that are ABOUT reading it. `scripts/` is outside the
// coverage floors and is tested anyway, for the reason audit-hints.ts gives about its own: an
// instrument whose failure mode is a false all-clear is worse than no instrument, and this one's
// false all-clear is a committed word list that silently lost its blocklist filter.
describe('build-cryptic-words', () => {
  describe('deriveWords', () => {
    it.each([
      ['a one-letter entry', 'a'],
      ['a thirteen-letter entry', 'abcdefghijklm'],
      ['an entry with an apostrophe', "isn't"],
      ['an entry with an accent', 'cafés'],
      ['an entry with a hyphen', 'twenty-one'],
      ['an entry with a capital', 'Angora'],
    ])('drops %s', (_description, entry) => {
      expect(deriveWords([entry, 'angora'])).toStrictEqual(['angora'])
    })

    it.each([...chargedTerms].slice(0, 5))('drops the charged term %s', (term) => {
      expect(deriveWords([term.toLowerCase(), 'angora'])).toStrictEqual(['angora'])
    })

    // Whole-token, never substring: the blocklist rule this repo has always used, so a word that
    // merely CONTAINS a charged term survives.
    it('keeps a word that merely contains a charged term', () => {
      expect(deriveWords(['scunthorpe', 'angora'])).toStrictEqual(['angora', 'scunthorpe'])
    })

    // chargedTerms rather than chargedWords alone, pinned by an INFLECTION rather than by a
    // base form. Narrow the filter back to blocklist.ts's 21 singulars and this row goes red while
    // every other row in this file stays green.
    it('drops an inflection blocklist.ts does not carry', () => {
      expect(deriveWords(['bastards', 'angora'])).toStrictEqual(['angora'])
    })

    it('sorts and dedupes, so a regeneration is a reviewable diff rather than a reshuffle', () => {
      expect(deriveWords(['instant', 'angora', 'instant'])).toStrictEqual(['angora', 'instant'])
    })

    it.each([MIN_LENGTH, MAX_LENGTH])('keeps an entry of exactly %i letters', (length) => {
      expect(deriveWords(['a'.repeat(length)])).toStrictEqual(['a'.repeat(length)])
    })
  })

  describe('assertEntryFloor', () => {
    it('throws on a list too small to be an oracle', () => {
      expect(() => assertEntryFloor(['angora'])).toThrow(`below the ${MIN_ENTRIES} floor`)
    })

    it('passes a list at the floor', () => {
      expect(() => assertEntryFloor(new Array(MIN_ENTRIES).fill('angora'))).not.toThrow()
    })
  })

  describe('readSource', () => {
    // THE PIN, and it is the whole reason the derivation's claims are falsifiable: everything
    // downstream is a claim about a specific corpus, and against a different one the claims are
    // unfalsifiable rather than merely wrong, while the output still looks like a word list.
    it('reads the committed corpus when its digest matches the committed pin', () => {
      expect(readSource().length).toBeGreaterThan(MIN_ENTRIES)
    })

    it('throws when the corpus does not match its pin', () => {
      expect(() => readSource(__filename)).toThrow('does not match its pin')
    })

    it('reads the pin from its own file rather than from a literal in either script', () => {
      expect(readPinnedDigest()).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('renderModule', () => {
    it('names its producer, its source, its license and its pin', () => {
      const rendered = renderModule(['angora'])

      expect(rendered).toContain('scripts/build-cryptic-words.ts')
      expect(rendered).toContain('scripts/data/enable.txt')
      expect(rendered).toContain('scripts/data/LICENSE-enable')
      expect(rendered).toContain('scripts/data/enable.sha256')
      expect(rendered).toContain("export const knownWords: string[] = [\n  'angora',\n]")
    })
  })
})
