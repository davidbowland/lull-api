import { themedAnagramsGenerator } from '@generators/themedanagrams/generator'
import { fetchAnagramSets } from '@services/anagram-sets'
import { Difficulty, Pack, ThemedAnagramsData } from '@types'
import { log } from '@utils/logging'

jest.mock('@services/anagram-sets')
jest.mock('@utils/logging')

describe('themedAnagramsGenerator', () => {
  const WORDS = ['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN', 'RAMEKIN', 'TEAPOT']

  const batch = (sets: { theme: string; words: string[] }[]) => ({
    droppedByGate: {
      blocklist: 0,
      charset: 0,
      duplicateInBatch: 0,
      length: 0,
      multiplicity: 0,
      notUnique: 2,
      permutations: 0,
      recentlyUsed: 0,
      tokens: 0,
    },
    sets,
    setsDiscardedByReason: { belowWordFloor: 1, shape: 0, themeGate: 0, themeLeak: 0 },
    setsReturned: sets.length + 1,
  })

  // No live randomness anywhere: a fixed sequence, so every scramble in this file is reproducible.
  const seededRandom = (seed: number): (() => number) => {
    let state = seed
    return () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const emptyPacks: Pack[] = []

  beforeAll(() => {
    jest.mocked(fetchAnagramSets).mockResolvedValue(batch([{ theme: 'Kitchen tools', words: WORDS }]) as never)
  })

  describe('the contribution it ships', () => {
    it('declares three puzzles at bands 2, 3 and 4 with no best-effort claim', () => {
      expect(themedAnagramsGenerator.countPerDay).toEqual(3)
      expect(themedAnagramsGenerator.difficulties).toStrictEqual([1, 3, 4])
      expect(themedAnagramsGenerator.bestEffort).toBeUndefined()
      expect(themedAnagramsGenerator.type).toEqual('themedanagrams')
    })
  })

  describe('fetchCandidates', () => {
    it('reads both repeat units off the recent packs and passes them separately', async () => {
      const recent: Pack[] = [
        {
          complete: true,
          date: '2026-09-02',
          puzzles: [
            {
              data: {
                entries: [
                  { answer: 'BLIZZARD', scrambles: ['ZDIBRZAL'] },
                  { answer: 'THUNDER', scrambles: ['RUTNEDH'] },
                  { answer: 'DRIZZLE', scrambles: ['ZELIRDZ'] },
                  { answer: 'CYCLONE', scrambles: ['NEOLCCY'] },
                ],
                theme: 'Weather',
              },
              difficulty: 3,
              estimatedSeconds: 90,
              id: '2026-09-02:themedanagrams:abcd1234',
              type: 'themedanagrams',
            },
          ],
        },
      ]

      await themedAnagramsGenerator.fetchCandidates(3, recent)

      expect(jest.mocked(fetchAnagramSets)).toHaveBeenCalledWith(
        3,
        ['Weather'],
        ['BLIZZARD', 'THUNDER', 'DRIZZLE', 'CYCLONE'],
        expect.any(Function),
      )
    })

    it('lists every declared difficulty the set can carry', async () => {
      const [candidate] = await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))

      expect(candidate.usableAt).toStrictEqual([1, 3, 4])
    })

    // A candidate usable at nothing is dropped at the gate rather than carried, so the selection loop
    // never sees a draft it cannot build.
    it('drops a set that can carry no declared difficulty', async () => {
      // One word, so no band can reach four entries. A set short at only SOME bands would still be a
      // candidate -- the missing band is simply absent from usableAt -- so this row uses one that
      // fails everywhere, which is the only case that produces no candidate at all.
      jest.mocked(fetchAnagramSets).mockResolvedValueOnce(batch([{ theme: 'Odds', words: ['ROBOT'] }]) as never)

      expect(await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))).toStrictEqual([])
    })

    it('logs one line naming every gate, every set reason and the usable count per band', async () => {
      await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))

      expect(jest.mocked(log)).toHaveBeenCalledWith('Anagram set pool spent', {
        droppedByGate: expect.objectContaining({ notUnique: 2 }),
        scrambleExhausted: 0,
        scramblesPerEntry: expect.any(Object),
        setsDiscarded: 1,
        setsDiscardedByReason: expect.objectContaining({ belowWordFloor: 1 }),
        setsReturned: 2,
        setsUsable: 1,
        usableByDifficulty: { 1: 1, 3: 1, 4: 1 },
      })
    })

    /**
     * THE READING THAT TELLS US WHETHER THE RESHUFFLE BUTTON IS WORTH HAVING, and it is a
     * distribution rather than a mean for the same reason usableByDifficulty is a breakdown rather
     * than a count: a mean of 3.5 reads identically for a pack where every entry got 3 or 4 and one
     * where a quarter of them got 1 and the rest got 4. Those want opposite fixes -- the first is
     * fine, the second is a separation ceiling set too tight.
     *
     * EVERY KEY IS ALWAYS PRESENT, including the zeroes. A histogram that omits its empty buckets
     * reads as "no entry got 1" and as "nobody looked" in exactly the same way, and the day the 1
     * bucket starts filling is the day this number has to be legible without anyone re-deriving what
     * a missing key meant.
     *
     * Pinned against a seeded run: one set, three bands, four entries, so the buckets sum to twelve.
     */
    it('logs how many scrambles each entry got, with every bucket present', async () => {
      await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))

      const { scramblesPerEntry } = jest
        .mocked(log)
        .mock.calls.find(([message]) => message === 'Anagram set pool spent')?.[1] as {
        scramblesPerEntry: Record<string, number>
      }

      expect(Object.keys(scramblesPerEntry)).toStrictEqual(['1', '2', '3', '4'])
      expect(Object.values(scramblesPerEntry).reduce((total, count) => total + count, 0)).toEqual(12)
    })
  })

  describe('build', () => {
    const buildAt = async (difficulty: Difficulty) => {
      const [candidate] = await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))
      return candidate.build('2026-09-02', difficulty, () => 'abcd1234')
    }

    it('ships exactly four entries and the theme', async () => {
      const puzzle = await buildAt(3)
      const data = puzzle.data as ThemedAnagramsData

      expect(data.entries).toHaveLength(4)
      expect(data.theme).toEqual('Kitchen tools')
    })

    // TWO FIELDS, and the key list is the assertion rather than three separate absences. The ladder
    // that used to make it three picked its target entries by ANSWER LENGTH, ranked once here, so a
    // player who had already solved the longest entry still had the whole-answer reveal spent on it.
    // Which entries are still unsolved is a fact about a board this function runs before, so the
    // rungs are chosen on the device, by the builder at src/rules/hint-themed-anagrams.ts -- which
    // this suite covers in __tests__/unit/rules/, never through a generator.
    it('ships no answer, no category and no ladder, none of which this type has', async () => {
      const data = (await buildAt(3)).data as ThemedAnagramsData & { answer?: string; category?: string }

      expect(data.answer).toBeUndefined()
      expect(data.category).toBeUndefined()
      expect(Object.keys(data).sort()).toStrictEqual(['entries', 'theme'])
    })

    it('makes every scramble a permutation of its own answer', async () => {
      const data = (await buildAt(4)).data as ThemedAnagramsData

      for (const entry of data.entries) {
        for (const scramble of entry.scrambles) {
          expect([...scramble].sort().join('')).toEqual([...entry.answer].sort().join(''))
          expect(scramble).not.toEqual(entry.answer)
        }
      }
    })

    // ONE TO FOUR, and the lower bound is the load-bearing half: an entry the board cannot render is
    // worse than one that cannot reshuffle. The non-empty tuple type says this too, but a type says
    // it to the compiler and this says it about the strings the scrambler actually produced.
    it('gives every entry between one and four scrambles', async () => {
      const data = (await buildAt(4)).data as ThemedAnagramsData

      for (const entry of data.entries) {
        expect(entry.scrambles.length).toBeGreaterThanOrEqual(1)
        expect(entry.scrambles.length).toBeLessThanOrEqual(4)
      }
    })

    // baseSeconds 60 plus secondsPerDifficulty 15 per band above the first, over the three DECLARED
    // bands. Band 1 lands on the base itself, which is the reading that moved when this type traded
    // band 2 for band 1.
    it.each([
      [1, 60],
      [3, 90],
      [4, 105],
    ])('estimates band %i at %i seconds', async (difficulty, seconds) => {
      expect((await buildAt(difficulty as Difficulty)).estimatedSeconds).toEqual(seconds)
    })

    it('addresses the puzzle by date, type and a generated short id', async () => {
      expect((await buildAt(1)).id).toEqual('2026-09-02:themedanagrams:abcd1234')
    })

    // THE ONE THROW. It is an assertion rather than a gate: a scramble whose letters do not match its
    // answer means the redraw loop is broken, not that the model's input was bad, and a gate would
    // quietly drop the evidence -- shipping an unsolvable board to a device that adjudicates offline.
    //
    // Doctored through the FIRST build's own data, which is the candidate's cached entry array rather
    // than a copy -- so the second build reads the corruption and the assertion is the thing that
    // catches it, rather than a hand-built fixture that never went through the scrambler.
    it('throws when an entry is doctored so its scramble is not a permutation', async () => {
      const [candidate] = await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))
      const puzzle = await candidate.build('2026-09-02', 3)
      const data = puzzle.data as ThemedAnagramsData
      data.entries[0].scrambles[0] = 'XXXXXX'

      await expect(candidate.build('2026-09-02', 3)).rejects.toThrow('Scramble is not a permutation of')
    })

    // WATCHED RED against an assertion that checks scrambles[0] and stops. Every member of the list
    // is a board the player can reach, so an assertion that only guards the one they see first is an
    // assertion the reshuffle button walks past -- and the failure it exists to catch, an unsolvable
    // board on a device that adjudicates offline, is irrecoverable without a delete-and-rebuild.
    //
    // The length precondition is what stops this passing vacuously: doctoring the LAST member proves
    // nothing if the last member is also the first.
    it('throws when a doctored scramble is not the first one in its entry', async () => {
      const [candidate] = await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))
      const puzzle = await candidate.build('2026-09-02', 3)
      const data = puzzle.data as ThemedAnagramsData
      const { scrambles } = data.entries[0]
      expect(scrambles.length).toBeGreaterThan(1)
      scrambles[scrambles.length - 1] = 'XXXXXX'

      await expect(candidate.build('2026-09-02', 3)).rejects.toThrow('Scramble is not a permutation of')
    })
  })
})
