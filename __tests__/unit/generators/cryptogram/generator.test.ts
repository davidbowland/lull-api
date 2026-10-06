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

const SENTENCE = { category: 'Proverb', text: 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES' }
const LONG_WORD = { category: 'Proverb', text: 'NECESSITY IS THE MOTHER OF EVERY GOOD IDEA WE HAVE' }

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
    it('passes the recent cryptogram answers and the recent phrase answers to the model call', async () => {
      const recent: Pack[] = [
        {
          complete: true,
          date: '2026-06-14',
          puzzles: [
            {
              data: { answer: 'A FOOL AND HIS MONEY ARE SOON PARTED', category: 'Proverb', ciphertext: 'X' },
              difficulty: 4,
              estimatedSeconds: 270,
              id: '2026-06-14:cryptogram:abcd1234',
              type: 'cryptogram',
            },
            {
              data: { answer: 'BITE THE BULLET', category: 'Saying' },
              difficulty: 3,
              estimatedSeconds: 240,
              id: '2026-06-14:phrazle:abcd1235',
              type: 'phrazle',
            },
          ],
        },
      ]

      await cryptogramGenerator.fetchCandidates(1, recent, packDate)

      expect(fetchCryptogramSentences).toHaveBeenCalledWith(
        1,
        ['A FOOL AND HIS MONEY ARE SOON PARTED'],
        ['A FOOL AND HIS MONEY ARE SOON PARTED', 'BITE THE BULLET'],
        expect.any(Function),
      )
    })

    // The prompt's long-word cap is the only ration; reordering here would turn it into a ban.
    it('keeps the order the model wrote', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([LONG_WORD, SENTENCE])

      const [first, second] = await candidatesFor()
      const answerOf = async (candidate: Candidate<CryptogramData>) => (await candidate.build(packDate, 4)).data.answer

      expect(await answerOf(first)).toEqual(LONG_WORD.text)
      expect(await answerOf(second)).toEqual(SENTENCE.text)
    })

    it('offers every candidate at the one declared band', async () => {
      const [candidate] = await candidatesFor()

      expect(candidate.usableAt).toStrictEqual([4])
    })

    it('logs how many sentences landed and how many carry a long word', async () => {
      jest.mocked(fetchCryptogramSentences).mockResolvedValueOnce([LONG_WORD, SENTENCE])

      await candidatesFor()

      expect(log).toHaveBeenCalledWith('Cryptogram sentences fetched', { longWord: 1, usable: 2 })
    })
  })

  describe('build', () => {
    it('carries the plaintext as the answer and the category at band 4', async () => {
      const puzzle = await build()

      expect(puzzle.data.answer).toEqual(SENTENCE.text)
      expect(puzzle.data.category).toEqual('Proverb')
    })

    it('enciphers every letter and leaves every space alone', async () => {
      const { answer, ciphertext } = (await build()).data as CryptogramData

      expect(ciphertext).toHaveLength(answer.length)
      expect(ciphertext.split('').map((character) => character === ' ')).toEqual(
        answer.split('').map((character) => character === ' '),
      )
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
