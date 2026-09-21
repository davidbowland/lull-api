import { packDate } from '../../__mocks__'
import { derange } from '@generators/cryptogram/cipher'
import { cryptogramGenerator } from '@generators/cryptogram/generator'
import { CryptogramData, Difficulty, Familiarity, Phrase } from '@types'

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

const phraseOf = (text: string, familiarity: Familiarity = 3): Phrase => ({
  category: 'Film',
  familiarity,
  hints: ['A space opera sequel', 'The middle chapter', 'The one with the revelation'],
  shape: 'quote',
  text,
})

// 20 letters, 8 repeats: ratio 0.40, which takes no nudge, so at familiarity 3 it derives to 3.
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

    it('enciphers every letter and leaves every space alone', async () => {
      const puzzle = await generate(3)

      const { answer, ciphertext } = puzzle.data as CryptogramData
      expect(ciphertext).toHaveLength(answer.length)
      expect(ciphertext.split('').map((character) => character === ' ')).toEqual(
        answer.split('').map((character) => character === ' '),
      )
      expect(ciphertext).toEqual(ciphertext.toUpperCase())
    })

    // One plain letter per cipher letter, both ways: a ciphertext that fails this is unsolvable rather than hard.
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

    // One letter enciphered to itself hands the solver a free letter on a board with nothing pre-filled.
    it('never leaves a letter enciphered as itself', async () => {
      const puzzle = await generate(3)

      const { answer, ciphertext } = puzzle.data as CryptogramData
      const plain = answer.toUpperCase()
      expect(
        ciphertext.split('').filter((character, index) => /[A-Z]/.test(character) && character === plain[index]),
      ).toEqual([])
    })

    // The expected map is the real derange over the same seeded source, so nothing here re-implements the
    // shuffle; the row fails if the generator reaches for Math.random behind the injection.
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

    // undefined, not a placeholder: the pack is stored as JSON.stringify, so an omitted key disappears entirely.
    it('hides the category at difficulty 3', async () => {
      expect(((await generate(3)).data as CryptogramData).category).toBeUndefined()
    })

    it('shows the category at difficulty 4', async () => {
      expect(((await generate(4)).data as CryptogramData).category).toEqual('Film')
    })

    // The phrase's rungs are semantic by instruction, which helps recognition rather than breaking a cipher;
    // rungs are chosen on the device by lull-ui's src/components/cryptogram/rungs.ts. `in` rather than
    // undefined: JSON.stringify erases the difference on the wire, but only one form says the field is gone.
    it('ships no hint ladder, and the phrase own rungs go nowhere', async () => {
      const data = (await generate(3)).data as CryptogramData

      expect('hints' in data).toBe(false)
      expect(JSON.stringify(data)).not.toContain(PHRASE.hints[0])
    })

    it.each([
      [2, 210],
      [3, 240],
      [4, 270],
    ] as [Difficulty, number][])('estimates difficulty %i at %i seconds of play', async (difficulty, seconds) => {
      expect((await generate(difficulty)).estimatedSeconds).toEqual(seconds)
    })

    // Opaque and carrying no position: an index in the id makes the identifier a contract about content.
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

  // The +/-1 band lives here rather than in difficulty.ts: the tolerance is this generator's declared appetite.
  describe('isUsablePhrase', () => {
    // THE GREAT GATSBY derives to 3: fourteen letters over nine distinct is 0.36, on the measured median of 0.37.
    it('accepts a phrase that derives to the difficulty asked for', () => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('The Great Gatsby', 3), 3)).toBe(true)
    })

    it.each([2, 4] as Difficulty[])('accepts a phrase one band away at difficulty %i', (difficulty) => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('The Great Gatsby', 3), difficulty)).toBe(true)
    })

    it('rejects a phrase two bands away', () => {
      // Thirteen letters over nine distinct is a ratio of 0.31, so band 4, and familiarity 1 nudges it to 5.
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('A stitch in time', 1), 3)).toBe(false)
    })

    // The floor is independent of difficulty, so a phrase failing it is rejected even on a perfect band match.
    it('rejects a phrase that fails the structural floor whatever the band says', () => {
      expect(cryptogramGenerator.isUsablePhrase(phraseOf('Big cat', 3), 3)).toBe(false)
    })
  })

  it('declares one difficulty per puzzle', () => {
    expect(cryptogramGenerator.difficulties).toHaveLength(cryptogramGenerator.countPerDay)
  })
})
