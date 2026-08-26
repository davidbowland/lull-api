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
                  { answer: 'BLIZZARD', scramble: 'ZDIBRZAL' },
                  { answer: 'THUNDER', scramble: 'RUTNEDH' },
                  { answer: 'DRIZZLE', scramble: 'ZELIRDZ' },
                  { answer: 'CYCLONE', scramble: 'NEOLCCY' },
                ],
                hints: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
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
        setsDiscarded: 1,
        setsDiscardedByReason: expect.objectContaining({ belowWordFloor: 1 }),
        setsReturned: 2,
        setsUsable: 1,
        usableByDifficulty: { 1: 1, 3: 1, 4: 1 },
      })
    })
  })

  describe('build', () => {
    const buildAt = async (difficulty: Difficulty) => {
      const [candidate] = await themedAnagramsGenerator.fetchCandidates(3, emptyPacks, seededRandom(9))
      return candidate.build('2026-09-02', difficulty, () => 'abcd1234')
    }

    it('ships exactly four entries, the theme and a three-rung ladder', async () => {
      const puzzle = await buildAt(3)
      const data = puzzle.data as ThemedAnagramsData

      expect(data.entries).toHaveLength(4)
      expect(data.theme).toEqual('Kitchen tools')
      expect(data.hints).toHaveLength(3)
    })

    it('ships no answer and no category, which this type does not have', async () => {
      const data = (await buildAt(3)).data as ThemedAnagramsData & { answer?: string; category?: string }

      expect(data.answer).toBeUndefined()
      expect(data.category).toBeUndefined()
      expect(Object.keys(data).sort()).toStrictEqual(['entries', 'hints', 'theme'])
    })

    it('makes every scramble a permutation of its own answer', async () => {
      const data = (await buildAt(4)).data as ThemedAnagramsData

      for (const entry of data.entries) {
        expect([...entry.scramble].sort().join('')).toEqual([...entry.answer].sort().join(''))
        expect(entry.scramble).not.toEqual(entry.answer)
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
      data.entries[0].scramble = 'XXXXXX'

      await expect(candidate.build('2026-09-02', 3)).rejects.toThrow('Scramble is not a permutation of')
    })
  })
})
