import { packDate } from '../../__mocks__'
import { derange } from '@generators/cryptogram/cipher'
import { cryptogramGenerator } from '@generators/cryptogram/generator'
import { CryptogramData, Difficulty, Familiarity, Phrase } from '@types'

jest.mock('@utils/logging')

// The same seeded Lehmer generator the other generator suites use. A cryptogram built from live
// randomness is a test that passes today and fails on some Tuesday.
const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

const CIPHER_SEED = 17
// A different seed for the threading case, so it witnesses the derangement rather than agreeing
// with the one every other case happens to share.
const THREADING_SEED = 42

const phraseOf = (text: string, familiarity: Familiarity = 3): Phrase => ({
  category: 'Film',
  familiarity,
  hints: ['A space opera sequel', 'The middle chapter', 'The one with the revelation'],
  shape: 'quote',
  text,
})

// 20 letters, 8 repeats -- a repetition ratio of 0.40, which takes no nudge, so with familiarity 3
// it derives to 3.
const PHRASE = phraseOf('The Empire Strikes Back')

const shortId = () => 'abc123de'

const generate = (difficulty: Difficulty, phrase: Phrase = PHRASE) =>
  cryptogramGenerator.generate(packDate, difficulty, phrase, shortId, seededRandom(CIPHER_SEED))

describe('cryptogramGenerator', () => {
  describe('generate', () => {
    it('carries the plaintext as the answer', async () => {
      const puzzle = await generate(3)

      expect((puzzle.data as CryptogramData).answer).toEqual('The Empire Strikes Back')
    })

    // The device adjudicates locally, exactly as Missing Vowels does: offline-first means the
    // answer ships with the pack, and the pack is already on the phone.
    it('enciphers every letter and leaves every space alone', async () => {
      const puzzle = await generate(3)

      const { answer, ciphertext } = puzzle.data as CryptogramData
      expect(ciphertext).toHaveLength(answer.length)
      expect(ciphertext.split('').map((character) => character === ' ')).toEqual(
        answer.split('').map((character) => character === ' '),
      )
      expect(ciphertext).toEqual(ciphertext.toUpperCase())
    })

    // The whole contract of a substitution cipher: one plain letter per cipher letter, both ways,
    // for the entire phrase. A ciphertext that failed this is unsolvable rather than hard.
    it('round-trips under the inverse map', async () => {
      const puzzle = await generate(3)

      const { answer, ciphertext } = puzzle.data as CryptogramData
      const plain = answer.toUpperCase()
      const inverse: Record<string, string> = {}
      ciphertext.split('').forEach((character, index) => {
        inverse[character] = plain[index]
      })
      expect(
        ciphertext
          .split('')
          .map((character) => inverse[character])
          .join(''),
      ).toEqual(plain)
    })

    // No fixed point, end to end. One letter that enciphers to itself hands the solver a free
    // letter on a board with nothing pre-filled. LETTERS only -- a space is deliberately left where
    // it stands, which the space-preservation case above is what asserts.
    it('never leaves a letter enciphered as itself', async () => {
      const puzzle = await generate(3)

      const { answer, ciphertext } = puzzle.data as CryptogramData
      const plain = answer.toUpperCase()
      expect(
        ciphertext.split('').filter((character, index) => /[A-Z]/.test(character) && character === plain[index]),
      ).toEqual([])
    })

    // The randomness is threaded all the way into derange rather than the generator reaching for
    // Math.random behind the injection. The expected map is the real derange called on the same
    // seeded source, so nothing here re-implements the shuffle.
    it('uses the derangement it is handed rather than reaching for Math.random', async () => {
      const puzzle = await cryptogramGenerator.generate(packDate, 3, PHRASE, shortId, seededRandom(THREADING_SEED))

      const cipher = derange(seededRandom(THREADING_SEED))
      const { answer, ciphertext } = puzzle.data as CryptogramData
      const enciphered = answer
        .toUpperCase()
        .split('')
        .map((character) => cipher[character] ?? character)
        .join('')
      expect(ciphertext).toEqual(enciphered)
    })

    it('shows the category at difficulty 2', async () => {
      expect(((await generate(2)).data as CryptogramData).category).toEqual('Film')
    })

    // undefined, not a placeholder: dynamodb.ts stores the pack as JSON.stringify, so an omitted key
    // simply disappears from the payload the UI reads.
    it('hides the category at difficulty 3', async () => {
      expect(((await generate(3)).data as CryptogramData).category).toBeUndefined()
    })

    it('shows the category at difficulty 4', async () => {
      expect(((await generate(4)).data as CryptogramData).category).toEqual('Film')
    })

    it('passes the ladder through untouched', async () => {
      expect(((await generate(3)).data as CryptogramData).hints).toEqual(PHRASE.hints)
    })

    // 210 / 240 / 270 -- inside the catalog's 3-5 minutes, and sorting after both existing types on
    // the shelf, which orders on this number.
    it.each([
      [2, 210],
      [3, 240],
      [4, 270],
    ] as [Difficulty, number][])('estimates difficulty %i at %i seconds of play', async (difficulty, seconds) => {
      expect((await generate(difficulty)).estimatedSeconds).toEqual(seconds)
    })

    // Opaque and carrying no position. An earlier design put an index in the id and used it to pick
    // difficulty, which made the identifier a contract about content.
    it('addresses the puzzle with the id it was handed', async () => {
      const puzzle = await generate(3)

      expect(puzzle.id).toEqual(`${packDate}:cryptogram:abc123de`)
      expect(puzzle.type).toEqual('cryptogram')
      expect(puzzle.difficulty).toEqual(3)
    })

    it('defaults its id source so the registry can call it with three arguments', async () => {
      const puzzle = await cryptogramGenerator.generate(packDate, 3, PHRASE)

      expect(puzzle.id).toMatch(/^2026-06-15:cryptogram:[0-9a-f]{8}$/)
    })
  })

  // The +/-1 band lives HERE, not in difficulty.ts: the tolerance is this generator's declared
  // appetite, and difficulty.ts only says what a phrase IS.
  describe('isUsablePhrase', () => {
    it('accepts a phrase that derives to the difficulty asked for', () => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('The Great Gatsby', 3), 3)).toBe(true)
    })

    it.each([2, 4] as Difficulty[])('accepts a phrase one band away at difficulty %i', (difficulty) => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('The Great Gatsby', 3), difficulty)).toBe(true)
    })

    // Two bands away is not "a bit off", it is a different puzzle. The tolerance exists because the
    // bands are thin, not because everything derives to 3.
    it('rejects a phrase two bands away', () => {
      // Derives to 5.
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('A stitch in time', 1), 3)).toBe(false)
    })

    // The floor is independent of difficulty, so a phrase that fails it is rejected even when its
    // derived band is a perfect match.
    it('rejects a phrase that fails the structural floor whatever the band says', () => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('Big cat', 3), 3)).toBe(false)
    })
  })

  it('declares one difficulty per puzzle', () => {
    expect(cryptogramGenerator.difficulties).toHaveLength(cryptogramGenerator.countPerDay)
  })
})
