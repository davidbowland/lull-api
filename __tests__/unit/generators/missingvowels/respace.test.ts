import { attemptsFor, boundariesOf, respace, stripVowels } from '@generators/missingvowels/respace'

describe('respace', () => {
  // A seeded generator, so "run it 200 times and assert the invariant held" is a deterministic
  // test rather than a flaky one.
  const seeded = (seed: number): (() => number) => {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  describe('stripVowels', () => {
    it('strips the vowels and records the real word sizes', () => {
      expect(stripVowels('The Empire Strikes Back')).toEqual({
        consonants: 'THMPRSTRKSBCK',
        wordSizes: [2, 3, 5, 3],
      })
    })

    it('keeps Y, which is a consonant for this puzzle', () => {
      expect(stripVowels('Yellow Submarine').consonants).toEqual('YLLWSBMRN')
    })

    it('keeps digits', () => {
      expect(stripVowels('Ocean 11').consonants).toEqual('CN11')
    })

    it('records a zero for a word that is all vowels', () => {
      expect(stripVowels('A Team').wordSizes).toEqual([0, 2])
    })
  })

  describe('boundariesOf', () => {
    it('returns the internal cumulative positions', () => {
      expect(boundariesOf([2, 3, 5, 3])).toEqual([2, 5, 10])
    })

    // A word contributing no consonants creates no visible boundary of its own, and letting it
    // through would make a duplicate position look like a distinct one to the coincidence check.
    it('collapses a word that contributed no consonants', () => {
      expect(boundariesOf([0, 3, 2])).toEqual([3])
    })
  })

  describe('attemptsFor', () => {
    // A count whose chunks are ALL at the two-letter minimum admits exactly one split, because
    // drawChunkSizes only moves a letter off a chunk that is above the minimum. Twenty redraws
    // there are twenty identical draws, not twenty more chances.
    it('spends one attempt on a count with only one possible split', () => {
      expect(attemptsFor(6, 3)).toEqual(1)
    })

    it.each([
      [6, 2],
      [13, 4],
      [7, 3],
    ])('spends the full budget on a count with room to move at length %s and count %s', (length, count) => {
      expect(attemptsFor(length, count)).toBeGreaterThan(1)
    })
  })

  describe('respace', () => {
    const { consonants, wordSizes } = stripVowels('The Empire Strikes Back')

    // Nothing may be added, removed, or reordered -- the displayed string is the same letters the
    // player has to recognize, only grouped differently.
    it.each([0, 1, 2] as const)('preserves the consonant sequence at aggression %s', (aggression) => {
      const random = seeded(7)

      for (let trial = 0; trial < 200; trial++) {
        expect(respace(consonants, wordSizes, aggression, random).replace(/ /g, '')).toEqual(consonants)
      }
    })

    it('produces the same chunk count as the phrase has words at low aggression', () => {
      const random = seeded(11)

      for (let trial = 0; trial < 200; trial++) {
        expect(respace(consonants, wordSizes, 1, random).split(' ')).toHaveLength(wordSizes.length)
      }
    })

    // The whole point of the type: the spacing has to lie. At aggression 0 a chunk boundary may
    // still land on a real one by chance, which is what makes it the easy band.
    it.each([1, 2] as const)('never lands a chunk boundary on a real word boundary at aggression %s', (aggression) => {
      const random = seeded(13)
      const real = new Set(boundariesOf(wordSizes))

      for (let trial = 0; trial < 200; trial++) {
        const chunks = respace(consonants, wordSizes, aggression, random).split(' ')
        for (const boundary of boundariesOf(chunks.map((chunk) => chunk.length))) {
          expect(real.has(boundary)).toBe(false)
        }
      }
    })

    it('changes the number of chunks at the highest aggression', () => {
      const random = seeded(17)

      for (let trial = 0; trial < 200; trial++) {
        expect(respace(consonants, wordSizes, 2, random).split(' ')).not.toHaveLength(wordSizes.length)
      }
    })

    it('never emits an empty chunk', () => {
      const random = seeded(19)

      for (let trial = 0; trial < 200; trial++) {
        for (const aggression of [0, 1, 2] as const) {
          expect(respace(consonants, wordSizes, aggression, random).split(' ')).not.toContain('')
        }
      }
    })

    // A two-word phrase whose consonants barely divide is the tight case: the chunk count cannot
    // exceed what a two-letter minimum allows, so aggression 2 has very little room to move.
    it('handles a short phrase', () => {
      const short = stripVowels('Toe hold')
      const random = seeded(23)

      const displayed = respace(short.consonants, short.wordSizes, 2, random)

      expect(displayed.replace(/ /g, '')).toEqual('THLD')
    })

    // REAR WINDOW, which failed nightly generation at difficulty 4 on 2026-08-26. Six consonants
    // splitting 2|4: aggression 2 wants a chunk count that lies, the only other count a two-letter
    // minimum allows is 3, and 3's single possible split (2|2|2) puts a boundary on the real one at
    // 2. Matching the word count is the last resort, not a failure -- the boundaries still lie,
    // which is what keeps the puzzle honest.
    it.each([
      ['RRWNDW', [2, 4]],
      ['RRWNDW', [4, 2]],
    ])('falls back to the real chunk count when no other count can avoid the real boundaries', (short, sizes) => {
      const random = seeded(31)
      const real = new Set(boundariesOf(sizes))

      for (let trial = 0; trial < 200; trial++) {
        const chunks = respace(short, sizes, 2, random).split(' ')

        expect(chunks.join('')).toEqual(short)
        for (const boundary of boundariesOf(chunks.map((chunk) => chunk.length))) {
          expect(real.has(boundary)).toBe(false)
        }
      }
    })

    // LAST resort, not first. The fallback must not quietly demote every aggression-2 puzzle to a
    // truthful chunk count -- a phrase with a feasible alternative count still lies about it.
    it('prefers a lying chunk count when one is feasible', () => {
      const random = seeded(37)

      for (let trial = 0; trial < 200; trial++) {
        expect(respace(consonants, wordSizes, 2, random).split(' ')).not.toHaveLength(wordSizes.length)
      }
    })

    // Bounded, per the project rule that no retry loop may run unbounded. A phrase with no legal
    // respacing costs one puzzle through the per-generate catch, rather than burning an invocation.
    it('throws rather than retrying forever when no respacing can avoid the real boundaries', () => {
      // Two consonants and two words: the only boundary available is the real one.
      expect(() => respace('TH', [1, 1], 1, seeded(29))).toThrow('Could not respace')
    })
  })
})
