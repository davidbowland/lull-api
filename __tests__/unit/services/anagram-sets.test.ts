import {
  MAX_THEME_LENGTH,
  MINIMUM_SET_REQUEST,
  SET_REQUEST_MULTIPLIER,
  fetchAnagramSets,
  passesThemeGates,
} from '@services/anagram-sets'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { log, logError } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('anagram-sets', () => {
  const prompt = {
    config: { anthropicVersion: 'bedrock-2023-05-31', maxTokens: 8000, model: 'a-model', thinkingEffort: 'low' },
    contents: 'generate anagram sets',
  }

  // Six words clearing every gate: single tokens, A-Z, 6-9 letters, no letter twice over, past
  // the permutation floor, not charged, anagram-unique in ENABLE.
  const WORDS = ['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'teapot']

  // Shares no word with WORDS, so a THEME dedupe row cannot pass on a word collision instead.
  const WEATHER = ['blizzard', 'thunder', 'drizzle', 'humidity', 'cyclone', 'rainbow']

  const set = (theme: string, words: string[] = WORDS) => ({ theme, words })

  // No live randomness; getRandomSample is the only consumer.
  const fixedRandom = () => 0.5

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ sets: [set('Kitchen tools')] } as never)
  })

  describe('passesThemeGates', () => {
    it.each(['Kitchen tools', 'Weather', 'Things in a toolbox', 'Toys of the 1980s', 'Rock & roll', "Baker's shelf"])(
      'admits %s',
      (theme) => {
        expect(passesThemeGates(theme)).toBe(true)
      },
    )

    it.each([
      ['an empty theme', ''],
      ['a whitespace theme', '   '],
      // Digits are allowed but may never LEAD. The one place a natural-sounding theme is rejected.
      ['a leading digit', '1980s toys'],
      ['a semicolon', 'Tools; and more'],
      ['a bracket', 'Tools <b>'],
      ['five words', 'Things you find in a toolbox'],
      ['an over-length theme', 'k'.repeat(MAX_THEME_LENGTH + 1)],
      ['a charged word', 'Bollocks and other exclamations'],
    ])('rejects %s', (_name, theme) => {
      expect(passesThemeGates(theme)).toBe(false)
    })

    // The semicolon exclusion is load-bearing: a stored theme reaches later prompts with its
    // ampersand intact, and without a semicolon it can never carry a literal `&lt;`.
    it('admits an ampersand while rejecting the entity that would need a semicolon', () => {
      expect(passesThemeGates('Rock & roll')).toBe(true)
      expect(passesThemeGates('Rock &lt;b&gt; roll')).toBe(false)
    })
  })

  describe('fetchAnagramSets', () => {
    it('asks for four sets per puzzle on a full night', async () => {
      await fetchAnagramSets(3, [], [], fixedRandom)

      expect(jest.mocked(log)).toHaveBeenCalledWith(
        'Fetched batch',
        expect.objectContaining({ asked: 3 * SET_REQUEST_MULTIPLIER, type: 'themedanagrams' }),
      )
    })

    // Binds on one kind of night only, which is why it looks like dead code: `count` is the
    // number of MISSING puzzles, so a repair run needing one would otherwise ask for four.
    it('holds a repair run to the minimum ask rather than four sets', async () => {
      await fetchAnagramSets(1, [], [], fixedRandom)

      expect(jest.mocked(log)).toHaveBeenCalledWith(
        'Fetched batch',
        expect.objectContaining({ asked: MINIMUM_SET_REQUEST }),
      )
    })

    it('hands the model the computed count, the bounds and both exclusion lists', async () => {
      await fetchAnagramSets(3, ['Weather'], ['SPATULA'], fixedRandom)

      expect(jest.mocked(invokeModel)).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({ name: 'submit_anagram_sets' }),
        expect.objectContaining({
          maxWordLength: 9,
          minWordLength: 6,
          setCount: 12,
          themesAlreadyUsed: ['Weather'],
          wordsAlreadyUsed: ['SPATULA'],
          wordsPerSet: 11,
        }),
      )
    })

    it('seeds the prompt with inspiration nouns', async () => {
      await fetchAnagramSets(3, [], [], fixedRandom)

      const context = jest.mocked(invokeModel).mock.calls[0][2] as { inspirationNouns: string[] }
      expect(context.inspirationNouns.length).toBeGreaterThan(0)
    })

    it('returns the gated set with its words uppercased', async () => {
      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // `seed` is present and undefined rather than absent, and toStrictEqual tells them apart.
      expect(batch.sets).toStrictEqual([
        {
          seed: undefined,
          theme: 'Kitchen tools',
          words: ['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN', 'RAMEKIN', 'TEAPOT'],
        },
      ])
      expect(batch.setsReturned).toEqual(1)
    })

    // Every row rides alongside a good neighbor, so the assertion is that the neighbor survived.
    it.each([
      ['a null element', null, 'shape'],
      ['a non-object element', 'not an object', 'shape'],
      ['a missing theme', { words: WORDS }, 'shape'],
      ['a non-string theme', { theme: 5, words: WORDS }, 'shape'],
      ['a missing words array', { theme: 'Kitchen tools' }, 'shape'],
      ['a non-array words field', { theme: 'Kitchen tools', words: 'kettle' }, 'shape'],
      ['an empty words array', { theme: 'Kitchen tools', words: [] }, 'shape'],
      ['a non-string word', { theme: 'Kitchen tools', words: [5, ...WORDS] }, 'shape'],
      ['a theme that fails its gates', { theme: 'Tools; and more', words: WORDS }, 'themeGate'],
    ])('drops a set with %s while its neighbor survives', async (_name, bad, reason) => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sets: [bad, set('Weather', WEATHER)] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Weather'])
      expect(batch.setsReturned).toEqual(2)
      expect(batch.setsDiscardedByReason[reason as 'shape']).toEqual(1)
    })

    it('drops a set whose theme names one of its own answers', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ sets: [set('Kettle and friends'), set('Weather', WORDS)] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.setsDiscardedByReason.themeLeak).toEqual(1)
      // The neighbor ships the SAME six words: a set discarded after its word pass must not have
      // marked them used, or one bad theme costs six words.
      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Weather'])
      expect(batch.sets[0].words).toHaveLength(6)
    })

    it('drops a set left with fewer than four admissible words', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [set('Kitchen tools', ['kettle', 'spatula', 'skillet', 'toaster', 'colander', 'grater'])],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.sets).toStrictEqual([])
      expect(batch.setsDiscardedByReason.belowWordFloor).toEqual(1)
      // Three of six hit the busiest gate, which tells a thin batch from words with anagrams.
      expect(batch.droppedByGate.notUnique).toEqual(3)
    })

    it('counts every word-level gate under its own key', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [
          set('Kitchen tools', [
            'ice cream',
            'cafés',
            'cups',
            'banana',
            'bollocks',
            'colour',
            'toaster',
            ...WORDS.slice(0, 4),
          ]),
        ],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // permutations is 0 and cannot be anything else at the committed band: the worst six-letter
      // shape under MAX_LETTER_MULTIPLICITY is three pairs at 90 against a floor of 60, and
      // words.test.ts carries that arithmetic.
      //
      // `colour` fills britishSpelling and is a real fixture rather than a zero: an ENABLE word,
      // anagram-unique, so it clears every other gate and would ship as a board answered COLOR.
      expect(batch.droppedByGate).toStrictEqual({
        blocklist: 1,
        britishSpelling: 1,
        charset: 1,
        displacedForm: 0,
        duplicateInBatch: 0,
        length: 1,
        multiplicity: 1,
        notUnique: 1,
        permutations: 0,
        recentlyUsed: 0,
        tokens: 1,
      })
    })

    // Counted ACROSS the batch, and committed only when a set is accepted, so a discarded set
    // does not burn words the next one could use.
    it('counts a word repeated in a later set as a batch duplicate', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [set('Kitchen tools'), set('Weather', ['kettle', ...WEATHER.slice(0, 5)])],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.droppedByGate.duplicateInBatch).toEqual(1)
      // Both survive: the repeat costs one word, and five is still above the four-word floor.
      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Kitchen tools', 'Weather'])
      expect(batch.sets[1].words).toStrictEqual(['BLIZZARD', 'THUNDER', 'DRIZZLE', 'HUMIDITY', 'CYCLONE'])
    })

    it('counts a word a recent pack used, keyed on the normalized form', async () => {
      const batch = await fetchAnagramSets(3, [], ['Kettle'], fixedRandom)

      expect(batch.droppedByGate.recentlyUsed).toEqual(1)
    })

    // Enforced on the normalized key, so a repeat differing only in case still collapses.
    it('rejects a theme a recent pack already used', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sets: [set('kitchen tools'), set('Weather', WEATHER)] } as never)

      const batch = await fetchAnagramSets(3, ['Kitchen Tools'], [], fixedRandom)

      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Weather'])
    })

    it('rejects a theme repeated within one batch', async () => {
      jest
        .mocked(invokeModel)
        .mockResolvedValueOnce({ sets: [set('Kitchen tools'), set('KITCHEN TOOLS', WEATHER)] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // Distinct words in the second set, so this fails on the THEME key, not a word collision.
      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Kitchen tools'])
    })

    // One block per pool: a missing count is NaN, getRandomSample returns [], and losing one pool
    // silently deletes a third of the seed vocabulary. The symptom -- themes converging over a
    // week -- is invisible to every other instrument here.
    describe.each([['INSPIRATION_NOUNS_COUNT'], ['INSPIRATION_VERBS_COUNT'], ['INSPIRATION_ADJECTIVES_COUNT']])(
      'without %s',
      (variable) => {
        const original = process.env[variable]

        beforeAll(() => {
          delete process.env[variable]
          jest.resetModules()
        })

        afterAll(() => {
          process.env[variable] = original
          jest.resetModules()
        })

        it('logs an error and still returns sets', async () => {
          const reloaded = require('../../../src/services/anagram-sets')
          const bedrock = require('../../../src/services/bedrock')
          const dynamodb = require('../../../src/services/dynamodb')
          const logging = require('../../../src/utils/logging')
          jest.mocked(dynamodb.getPromptById).mockResolvedValue(prompt as never)
          jest.mocked(bedrock.invokeModel).mockResolvedValue({ sets: [set('Kitchen tools')] } as never)

          const batch = await reloaded.fetchAnagramSets(3, [], [], fixedRandom)

          expect(jest.mocked(logging.logError)).toHaveBeenCalledWith(
            `${variable} is not a number; generating with that pool unseeded`,
            expect.anything(),
          )
          expect(batch.sets).toHaveLength(1)
        })
      },
    )

    // The seeding rule's only instrument: a batch that quietly fell back on stock themes reads
    // identically in every other number the pool line carries. Reported, never gated.
    it('counts a seed the model named and was actually offered', async () => {
      // fixedRandom makes the draw deterministic, so a seed captured from one call is the next
      // call's too.
      await fetchAnagramSets(3, [], [], fixedRandom)
      const offered = jest.mocked(invokeModel).mock.calls[0][2] as { inspirationNouns: string[] }
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [{ ...set('Kitchen tools'), seed: offered.inspirationNouns[0] }],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 1, fromPool: 1, named: 1 })
      expect(batch.sets).toHaveLength(1)
    })

    // An invented seed is the fallback wearing a label: `named` alone scores it fully compliant.
    it('counts a named seed that was never offered as named but not from the pool', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [{ ...set('Kitchen tools'), seed: 'zzzznotaseed' }],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 1, fromPool: 0, named: 1 })
      expect(batch.sets).toHaveLength(1)
    })

    // Two themes off one seed is the convergence the rule exists to stop, and `named` reads 2 of 2.
    it('counts two sets naming the same seed as one distinct seed', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [
          { ...set('Kitchen tools'), seed: 'kettle' },
          // Shares nothing with WORDS above, or this row measures the dedupe, not the seeds.
          {
            ...set('Baking things', ['biscuit', 'custard', 'muffins', 'pastry', 'pitcher', 'whisker']),
            seed: 'Kettle',
          },
        ],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // Case-insensitive via normalizeAnswer, so a recased copy still reads as one seed.
      expect(batch.seedUse.named).toEqual(2)
      expect(batch.seedUse.distinct).toEqual(1)
    })

    // A missing seed must not cost the set: nothing about the words changed.
    it('ships a set that named no seed at all, and counts it as unnamed', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sets: [set('Kitchen tools')] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 0, fromPool: 0, named: 0 })
      expect(batch.sets).toHaveLength(1)
    })

    // Non-string rather than absent: the schema is opaque to ajv, so `seed` can arrive as a number.
    it('ships a set whose seed is not a string', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sets: [{ ...set('Kitchen tools'), seed: 42 }] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse.named).toEqual(0)
      expect(batch.sets).toHaveLength(1)
    })

    it('does not log the seeding error on a healthy configuration', async () => {
      await fetchAnagramSets(3, [], [], fixedRandom)

      expect(jest.mocked(logError)).not.toHaveBeenCalled()
    })
  })
})
