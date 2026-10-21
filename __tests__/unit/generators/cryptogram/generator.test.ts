import { packDate } from '../../__mocks__'
import { derange } from '@generators/cryptogram/cipher'
import { cryptogramGenerator } from '@generators/cryptogram/generator'
import { fetchCryptogramSentences } from '@services/cryptogram-sentences'
import { Candidate, CryptogramData, Pack } from '@types'
import { log } from '@utils/logging'

jest.mock('@services/cryptogram-sentences')
jest.mock('@utils/logging')

// The same seeded Lehmer generator the other suites use; live randomness here is a test that fails on a Tuesday.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

const CIPHER_SEED = 17
// A different seed, so the threading case witnesses the derangement rather than agreeing with the shared one.
const THREADING_SEED = 42

const SENTENCE = {
  author: 'THOMAS JEFFERSON',
  category: 'Quote',
  text: 'HONESTY IS THE FIRST CHAPTER IN THE BOOK OF WISDOM.',
}
const LONG_WORD = { author: null, category: 'Proverb', text: 'NECESSITY IS THE MOTHER OF EVERY GOOD IDEA WE HAVE.' }
const APOSTROPHE = {
  author: 'MARK TWAIN',
  category: 'Quote',
  text: "IT'S NOT THE SIZE OF THE DOG IN THE FIGHT, BUT THE FIGHT.",
}
const ANSWER = 'HONESTY IS THE FIRST CHAPTER IN THE BOOK OF WISDOM. - THOMAS JEFFERSON'

const shortId = () => 'abc123de'

const emptyPacks: Pack[] = []

const candidatesFor = (seed = CIPHER_SEED): Promise<Candidate<CryptogramData>[]> =>
  (
    cryptogramGenerator.fetchCandidates as (
      count: number,
      recent: Pack[],
      origin: string,
      random: () => number,
    ) => Promise<Candidate<CryptogramData>[]>
  )(1, emptyPacks, packDate, seededRandom(seed))

const build = async (seed = CIPHER_SEED) => {
  const [candidate] = await candidatesFor(seed)
  return (candidate.build as (date: string, difficulty: 4, createShortId: () => string) => Promise<any>)(
    packDate,
    4,
    shortId,
  )
}

describe('cryptogramGenerator', () => {
  beforeAll(() => {
    jest.mocked(fetchCryptogramSentences).mockResolvedValue([SENTENCE])
  })

  it('declares one Tricky puzzle a day with no best-effort claim', () => {
    expect(cryptogramGenerator.countPerDay).toEqual(1)
    expect(cryptogramGenerator.difficulties).toStrictEqual([4])
    expect(cryptogramGenerator.bestEffort).toBeUndefined()
    expect(cryptogramGenerator.type).toEqual('cryptogram')
  })

  describe('fetchCandidates', () => {
    // The model sees quotes without their speakers, and the phrase list reads the quote as a phrase.
    it('passes the recent quotes and the recent phrase answers to the model call', async () => {
      const recent: Pack[] = [
        {
          complete: true,
          date: '2026-05-14',
          puzzles: [
            {
              data: {
                answer: 'A FOOL AND HIS MONEY ARE SOON PARTED. - JOHN BRIDGES',
                category: 'Quote',
                ciphertext: 'X',
              },
              difficulty: 4,
              estimatedSeconds: 270,
              id: '2026-05-14:cryptogram:abcd1234',
              type: 'cryptogram',
            },
            {
              data: { answer: 'BITE THE BULLET', category: 'Saying' },
              difficulty: 3,
              estimatedSeconds: 240,
              id: '2026-05-14:phrazle:abcd1235',
              type: 'phrazle',
            },
          ],
        },
      ]

      await cryptogramGenerator.fetchCandidates(1, recent, packDate)

      expect(fetchCryptogramSentences).toHaveBeenCalledWith(
        1,
        ['A FOOL AND HIS MONEY ARE SOON PARTED.'],
        ['A FOOL AND HIS MONEY ARE SOON PARTED', 'BITE THE BULLET'],
        true,
        expect.any(Function),
      )
    })

    const cryptogramPack = (date: string | undefined, answer: string): Pack => ({
      complete: true,
      date,
      puzzles: [
        {
          data: { answer, category: 'Quote', ciphertext: 'X' },
          difficulty: 4,
          estimatedSeconds: 270,
          id: `${date}:cryptogram:abcd1234`,
          type: 'cryptogram',
        },
      ],
    })

    const apostropheAllowedFor = async (recent: Pack[]): Promise<unknown> => {
      await cryptogramGenerator.fetchCandidates(1, recent, packDate)
      return jest.mocked(fetchCryptogramSentences).mock.calls[0][3]
    }

    // packDate is 2026-06-15.
    it.each([
      ['six days before', '2026-06-09', false],
      ['six days after', '2026-06-21', false],
      ['seven days before', '2026-06-08', true],
      ['seven days after', '2026-06-22', true],
    ])('with an apostrophe %s, allows apostrophes: %p', async (_name, date, allowed) => {
      expect(await apostropheAllowedFor([cryptogramPack(date, "IT'S A START. - MARK TWAIN")])).toBe(allowed)
    })

    it('blocks apostrophes for an apostrophe in the speaker alone', async () => {
      expect(await apostropheAllowedFor([cryptogramPack('2026-06-14', "IT IS A START. - FLANNERY O'CONNOR")])).toBe(
        false,
      )
    })

    // A ration that cannot place a pack fails closed.
    it('blocks apostrophes for an undated pack', async () => {
      expect(await apostropheAllowedFor([cryptogramPack(undefined, "IT'S A START. - MARK TWAIN")])).toBe(false)
    })

    it('allows apostrophes when the recent quotes carry none', async () => {
      expect(await apostropheAllowedFor([cryptogramPack('2026-06-14', 'IT IS A START. - MARK TWAIN')])).toBe(true)
    })

    // The prompt is asked to hold back; the generator enforces it.
    it('drops an apostrophe quote the model returned while apostrophes were blocked', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([APOSTROPHE, SENTENCE])

      const candidates = await cryptogramGenerator.fetchCandidates(
        1,
        [cryptogramPack('2026-06-14', "IT'S A START. - MARK TWAIN")],
        packDate,
      )

      expect(candidates).toHaveLength(1)
      expect((await candidates[0].build(packDate, 4)).data.answer).toEqual(ANSWER)
    })

    it('keeps an apostrophe quote when apostrophes are allowed', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([APOSTROPHE, SENTENCE])

      expect(await candidatesFor()).toHaveLength(2)
    })

    // The prompt's long-word cap is the only ration; reordering here would turn it into a ban.
    it('keeps the order the model wrote', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([LONG_WORD, SENTENCE])

      const [first, second] = await candidatesFor()
      const answerOf = async (candidate: Candidate<CryptogramData>) => (await candidate.build(packDate, 4)).data.answer

      expect(await answerOf(first)).toEqual(LONG_WORD.text)
      expect(await answerOf(second)).toEqual(ANSWER)
    })

    it('offers every candidate at the one declared band', async () => {
      const [candidate] = await candidatesFor()

      expect(candidate.usableAt).toStrictEqual([4])
    })

    it('logs how many sentences landed and how many carry a long word', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([LONG_WORD, SENTENCE])

      await candidatesFor()

      expect(log).toHaveBeenCalledWith('Cryptogram sentences fetched', {
        apostropheAllowed: true,
        longWord: 1,
        usable: 2,
      })
    })
  })

  describe('build', () => {
    it('carries the quote and its speaker as the answer, with the category, at band 4', async () => {
      const puzzle = await build()

      expect(puzzle.data.answer).toEqual(ANSWER)
      expect(puzzle.data.category).toEqual('Quote')
    })

    it('carries a proverb with no separator', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([LONG_WORD])

      expect((await build()).data.answer).toEqual(LONG_WORD.text)
    })

    // A board aligns the two strings by index, so every non-letter must sit where the answer has it.
    it('enciphers every letter and leaves every space and mark in place', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([APOSTROPHE])
      const { answer, ciphertext } = (await build()).data as CryptogramData

      expect(ciphertext).toHaveLength(answer.length)
      expect(ciphertext.replace(/[A-Z]/g, '_')).toEqual(answer.replace(/[A-Z]/g, '_'))
    })

    // One plain letter per cipher letter, both ways: a ciphertext that fails this is unsolvable rather than hard.
    it('round-trips under the inverse map', async () => {
      const { answer, ciphertext } = (await build()).data as CryptogramData

      const inverse: Record<string, string> = {}
      ciphertext.split('').forEach((character, index) => {
        inverse[character] = answer[index]
      })
      expect(
        ciphertext
          .split('')
          .map((character) => inverse[character])
          .join(''),
      ).toEqual(answer)
    })

    // One letter enciphered to itself hands the solver a free letter on a board with nothing pre-filled.
    it('never leaves a letter enciphered as itself', async () => {
      const { answer, ciphertext } = (await build()).data as CryptogramData

      expect(
        ciphertext.split('').filter((character, index) => /[A-Z]/.test(character) && character === answer[index]),
      ).toEqual([])
    })

    // The expected map is the real derange over the same seeded source, so nothing here re-implements the
    // shuffle; the row fails if the generator reaches for Math.random behind the injection.
    it('uses the random source it was handed rather than reaching for Math.random', async () => {
      const { answer, ciphertext } = (await build(THREADING_SEED)).data as CryptogramData

      const cipher = derange(seededRandom(THREADING_SEED))
      expect(ciphertext).toEqual(
        answer
          .split('')
          .map((character) => cipher[character] ?? character)
          .join(''),
      )
    })

    // `in` rather than undefined: JSON.stringify erases the difference on the wire, but only one form says the
    // field is gone. Rungs are chosen on the device by lull-ui's src/components/cryptogram/rungs.ts.
    it('ships no hint ladder', async () => {
      expect('hints' in (await build()).data).toBe(false)
    })

    it('estimates band 4 at 270 seconds of play', async () => {
      expect((await build()).estimatedSeconds).toEqual(270)
    })

    // Opaque and carrying no position: an index in the id makes the identifier a contract about content.
    it('addresses the puzzle with the id it was handed', async () => {
      const puzzle = await build()

      expect(puzzle.id).toEqual(`${packDate}:cryptogram:abc123de`)
      expect(puzzle.type).toEqual('cryptogram')
      expect(puzzle.difficulty).toEqual(4)
    })

    it('defaults its id source so the selection loop can call it with two arguments', async () => {
      const [candidate] = await candidatesFor()

      expect((await candidate.build(packDate, 4)).id).toMatch(/^2026-06-15:cryptogram:[0-9a-f]{8}$/)
    })
  })
})
