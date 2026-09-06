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

  // Six words, every one of which clears every gate: single tokens, A-Z, 5-9 letters, no letter more
  // than twice, over the permutation floor, not charged, and anagram-unique in ENABLE.
  const WORDS = ['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin', 'teapot']

  // A second clean set sharing no word with the first, so a row about THEME dedupe cannot pass
  // because the words collided instead.
  const WEATHER = ['blizzard', 'thunder', 'drizzle', 'humidity', 'cyclone', 'rainbow']

  const set = (theme: string, words: string[] = WORDS) => ({ theme, words })

  // A source with no live randomness anywhere. getRandomSample is the only consumer.
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
      // Digits are allowed but may never LEAD, which the whitelist enforces by requiring a letter
      // first. Worth pinning because it is the one place a natural-sounding theme is rejected.
      ['a leading digit', '1980s toys'],
      ['a semicolon', 'Tools; and more'],
      ['a bracket', 'Tools <b>'],
      ['five words', 'Things you find in a toolbox'],
      ['an over-length theme', 'k'.repeat(MAX_THEME_LENGTH + 1)],
      ['a charged word', 'Bollocks and other exclamations'],
    ])('rejects %s', (_name, theme) => {
      expect(passesThemeGates(theme)).toBe(false)
    })

    // THE SEMICOLON EXCLUSION IS LOAD-BEARING, not incidental. escapeXml leaves `&` alone, so a
    // stored theme reaches the next twenty nights' prompts with its ampersand intact -- and without a
    // semicolon it can never carry a literal `&lt;` to be interpreted after escaping.
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

    // The floor binds on exactly one kind of night, which is why it is easy to mistake for dead code:
    // `count` is the number of MISSING puzzles, so a repair run that needs one would otherwise ask
    // for four sets against two-level rejection.
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
          wordsPerSet: 8,
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

      // `seed` is present and undefined rather than absent: toGeneratedSet normalizes it, and this
      // fixture's model response names none. Asserted with toStrictEqual, which distinguishes the
      // two, so the key cannot quietly disappear from the shape.
      expect(batch.sets).toStrictEqual([
        {
          seed: undefined,
          theme: 'Kitchen tools',
          words: ['KETTLE', 'SPATULA', 'SKILLET', 'SAUCEPAN', 'RAMEKIN', 'TEAPOT'],
        },
      ])
      expect(batch.setsReturned).toEqual(1)
    })

    // ONE BAD SET COSTS ONE SET. Every row below rides alongside a good neighbor, so the assertion
    // is that the neighbor survived rather than merely that the bad one did not.
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
      // The neighbor ships the SAME six words, which is the point: a set discarded after its word
      // pass must not have marked those words used, or one bad theme costs the batch six words.
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
      // Three of the six went to the gate that does the most work, which is the reading that tells a
      // thin batch from a batch of words with anagrams.
      expect(batch.droppedByGate.notUnique).toEqual(3)
    })

    it('counts every word-level gate under its own key', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [
          set('Kitchen tools', ['ice cream', 'cafés', 'cups', 'banana', 'bollocks', 'toaster', ...WORDS.slice(0, 4)]),
        ],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // permutations is 0 AND CANNOT BE ANYTHING ELSE at the committed band. LEVEL used to sit in
      // the fixture above to fill this key; at five letters it now stops at the length gate, and no
      // admissible word can reach the floor -- the worst six-letter shape under
      // MAX_LETTER_MULTIPLICITY is three pairs at 90 against a floor of 60. It was removed rather
      // than left to double-count `length`, which would have made this row pass while quietly
      // meaning something else. words.test.ts carries the arithmetic and goes red if the floor moves.
      expect(batch.droppedByGate).toStrictEqual({
        blocklist: 1,
        charset: 1,
        duplicateInBatch: 0,
        length: 1,
        multiplicity: 1,
        notUnique: 1,
        permutations: 0,
        recentlyUsed: 0,
        tokens: 1,
      })
    })

    // A model repeating one word across sets is a distinctive failure that would otherwise read as a
    // thin batch. Counted ACROSS the batch, and the batch-local set is only committed when a set is
    // accepted -- so a set that is later discarded does not burn words the next set could use.
    it('counts a word repeated in a later set as a batch duplicate', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [set('Kitchen tools'), set('Weather', ['kettle', ...WEATHER.slice(0, 5)])],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.droppedByGate.duplicateInBatch).toEqual(1)
      // BOTH sets survive: the repeat costs one word, not a set. The second set still has five
      // admissible words, which is above the four-word floor.
      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Kitchen tools', 'Weather'])
      expect(batch.sets[1].words).toStrictEqual(['BLIZZARD', 'THUNDER', 'DRIZZLE', 'HUMIDITY', 'CYCLONE'])
    })

    it('counts a word a recent pack used, keyed on the normalized form', async () => {
      const batch = await fetchAnagramSets(3, [], ['Kettle'], fixedRandom)

      expect(batch.droppedByGate.recentlyUsed).toEqual(1)
    })

    // Shown in the prompt AND enforced afterwards, on the normalized key, so a repeat differing only
    // in case or punctuation still collapses.
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

      // Distinct words in the second set, so this row fails for the reason it names -- the normalized
      // THEME key -- rather than because the words collided.
      expect(batch.sets.map(({ theme }) => theme)).toStrictEqual(['Kitchen tools'])
    })

    // A quiet degradation of an anti-repetition mechanism is worth one line at ERROR, because the
    // symptom -- themes converging over a week -- is invisible in every other instrument this type
    // has. Absent, INSPIRATION_NOUNS_COUNT is NaN, getRandomSample returns [], and the seeding this
    // type calls load-bearing produces nothing at all.
    /*
     * ONE BLOCK PER POOL, and the parameterisation is the point rather than tidiness.
     *
     * This described NOUNS ONLY, which was complete while nouns were the only seed pool this call
     * read and became a hole the moment they were not. A missing count is NaN, getRandomSample
     * computes Math.min(NaN, len), the loop never runs and it returns [] -- so losing verbs or
     * adjectives would silently delete a third of the seed vocabulary, and the symptom is themes
     * converging over a WEEK, which no instrument in this file can see.
     */
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

    /*
     * THE SEEDING RULE'S ONLY INSTRUMENT.
     *
     * Seeds are the whole anti-repetition mechanism -- measured over live calls the model maps them
     * to themes very nearly one-for-one -- and until it was asked to NAME the seed, whether it used
     * them at all was unmeasurable: a batch that quietly fell back on stock themes looked identical
     * to a healthy one in every other number the pool line carries.
     *
     * REPORTED, NEVER GATED, which these rows pin as hard as the counting. A wrong or missing
     * self-report costs a discarded set and a thinner night against a rule the model already follows
     * closely, so every one of these sets still ships.
     */
    it('counts a seed the model named and was actually offered', async () => {
      // The offered pool is read from a REAL call rather than guessed at. fixedRandom makes the draw
      // deterministic, so the seed captured here is the one the next call will offer.
      await fetchAnagramSets(3, [], [], fixedRandom)
      const offered = jest.mocked(invokeModel).mock.calls[0][2] as { inspirationNouns: string[] }
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [{ ...set('Kitchen tools'), seed: offered.inspirationNouns[0] }],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 1, fromPool: 1, named: 1 })
      expect(batch.sets).toHaveLength(1)
    })

    // A seed the model INVENTED is the fallback wearing a label, and it is the reading `fromPool`
    // exists for: `named` alone would score this batch as perfectly compliant.
    it('counts a named seed that was never offered as named but not from the pool', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [{ ...set('Kitchen tools'), seed: 'zzzznotaseed' }],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 1, fromPool: 0, named: 1 })
      expect(batch.sets).toHaveLength(1)
    })

    // Two themes off one seed is the convergence the "different seed per set" rule exists to stop,
    // and it is invisible in `named`, which would read 2 of 2.
    it('counts two sets naming the same seed as one distinct seed', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({
        sets: [
          { ...set('Kitchen tools'), seed: 'kettle' },
          // Four words that share nothing with WORDS above and clear every gate -- checked, because a
          // neighbor set built from the same fixture would be discarded as a batch duplicate and this
          // row would then measure the dedupe rather than the seed count.
          {
            ...set('Baking things', ['biscuit', 'custard', 'muffins', 'pastry', 'pitcher', 'whisker']),
            seed: 'Kettle',
          },
        ],
      } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      // Case-insensitive, via normalizeAnswer: 'kettle' and 'Kettle' are one seed, and a model that
      // recased its own copy would otherwise read as two.
      expect(batch.seedUse.named).toEqual(2)
      expect(batch.seedUse.distinct).toEqual(1)
    })

    // A missing seed is a model ignoring the field, and it must not cost the set. Nothing about the
    // words changed, so the set is exactly as good as it was before anyone asked for a seed.
    it('ships a set that named no seed at all, and counts it as unnamed', async () => {
      jest.mocked(invokeModel).mockResolvedValueOnce({ sets: [set('Kitchen tools')] } as never)

      const batch = await fetchAnagramSets(3, [], [], fixedRandom)

      expect(batch.seedUse).toStrictEqual({ distinct: 0, fromPool: 0, named: 0 })
      expect(batch.sets).toHaveLength(1)
    })

    // Non-string rather than absent -- the tool schema is opaque to ajv, so `seed` can arrive as a
    // number. Same outcome: counted as unnamed, never a rejection.
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
