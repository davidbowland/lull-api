import { addPhrasePuzzles } from '@services/packs'
import { Difficulty, Phrase, Puzzle } from '@types'
import { log } from '@utils/logging'

const mockStrictGenerate = jest.fn()
const mockPermissiveGenerate = jest.fn()

// A phrase's derived difficulty is the FIRST character of its text. Nothing here re-implements the
// real derivation -- this suite is about selection, and a fixture that had to be recomputed
// alongside difficulty.ts would break for reasons that have nothing to do with packs.ts. Anything
// after that first character is a label, so two phrases can share a derived difficulty and still be
// told apart in an assertion.
const derivedOf = (phrase: Phrase): number => Number(phrase.text[0])

const TOLERANCE = 1

// Cryptogram's shape: three difficulties, a narrow band, and it must run FIRST. The permissive
// generator accepts anything, so running it first would leave this one whatever was left over.
const strict = {
  countPerDay: 3,
  difficulties: [2, 3, 4],
  generate: (...args: unknown[]) => mockStrictGenerate(...args),
  isUsablePhrase: (phrase: Phrase, difficulty: Difficulty) => Math.abs(derivedOf(phrase) - difficulty) <= TOLERANCE,
  type: 'cryptogram',
}
const permissive = {
  countPerDay: 2,
  difficulties: [1, 2],
  generate: (...args: unknown[]) => mockPermissiveGenerate(...args),
  isUsablePhrase: () => true,
  type: 'missingvowels',
}
jest.mock('@generators/index', () => ({
  allGenerators: [strict, permissive],
  phraseGenerators: [strict, permissive],
  selfContainedGenerators: [],
}))

const mockGetPackByDate = jest.fn()
const mockSetPackByDate = jest.fn()
jest.mock('@services/dynamodb', () => ({
  getPackByDate: (...args: unknown[]) => mockGetPackByDate(...args),
  setPackByDate: (...args: unknown[]) => mockSetPackByDate(...args),
}))

jest.mock('@utils/logging')

const packDate = '2026-06-15'

const phraseOf = (text: string): Phrase => ({
  category: 'Thing',
  familiarity: 3,
  hints: ['One', 'Two', 'Three'],
  shape: 'title',
  text,
})

const poolOf = (...texts: string[]): Phrase[] => texts.map(phraseOf)

const puzzleFrom =
  (type: string) =>
  (_date: string, difficulty: Difficulty, phrase: Phrase): Promise<Puzzle> =>
    Promise.resolve({
      data: { answer: phrase.text, hints: phrase.hints },
      difficulty,
      estimatedSeconds: 200,
      id: `${packDate}:${type}:${phrase.text}${difficulty}`,
      type: type as never,
    })

// What each generator was actually handed, in call order.
const handedTo = (mock: jest.Mock): [number, string][] =>
  mock.mock.calls.map((call) => [call[1] as number, (call[2] as Phrase).text])

describe('addPhrasePuzzles', () => {
  const setup = (): void => {
    mockStrictGenerate.mockImplementation(puzzleFrom('cryptogram'))
    mockPermissiveGenerate.mockImplementation(puzzleFrom('missingvowels'))
    mockGetPackByDate.mockResolvedValue(undefined)
    mockSetPackByDate.mockResolvedValue(true)
  }

  // Most-constrained-first, not first-fit. Under a +/-1 tolerance a derived-3 phrase is acceptable
  // to every declared difficulty, so first-fit lets whichever difficulty ran first drain them and
  // leaves difficulty 4 with only the rare extremes. Selection takes the phrase that FEWEST of this
  // generator's difficulties can use, so the scarce ones are spent where only they fit.
  //
  // Difficulty 4 is also where the second key shows: it is the last band owed, so the derived 3, 4
  // and 5 left in the pool are all equally scarce against what remains and pool order alone would
  // hand it the derived 3. Declared breadth breaks that in favour of the derived 5, which no other
  // difficulty here can play.
  it('spends each phrase on the difficulty that can least afford to lose it', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('3', '2', '4', '1', '5'))

    expect(handedTo(mockStrictGenerate)).toEqual([
      [2, '1'],
      [3, '2'],
      [4, '5'],
    ])
  })

  // Breadth is counted over the difficulties this generator has STILL to fill, never over every one
  // it declares. Against the declared set all three of these score 2, so difficulty 3 took the
  // derived 4 on pool order and difficulty 4 was left a derived 2 it cannot use -- zero difficulty-4
  // cryptograms from a pool that could have served all three bands.
  it('leaves the last difficulty a phrase it can use', async () => {
    setup()

    // By the time difficulty 3 chooses, only 3 and 4 are still owed: the derived 2 can serve one of
    // them and the derived 4 can serve both, so the derived 2 goes now and the derived 4 is held.
    await addPhrasePuzzles(packDate, poolOf('4', '2', '2'))

    expect(handedTo(mockStrictGenerate)).toEqual([
      [2, '2'],
      [3, '2'],
      [4, '4'],
    ])
  })

  // Ties are broken by pool order and nothing else -- no re-sorting, no scanning backwards. Both of
  // these are derived 2, so they are worth exactly the same to every difficulty and only their
  // position separates them.
  it('breaks a tie by pool order', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('2first', '2second'))

    expect(handedTo(mockStrictGenerate)).toEqual([
      [2, '2first'],
      [3, '2second'],
    ])
  })

  // THE regression this task exists for. packs.ts used to `return generated` when the pool ran dry,
  // which was harmless with one phrase generator and means ZERO cryptograms with two.
  // A difficulty that can use nothing costs THAT difficulty and nothing else. The pool here is all
  // derived 5: difficulty 2 is two bands away and difficulty 3 is one too far, but difficulty 4 can
  // use it perfectly well. Abandoning the generator at the first empty band would ship zero
  // cryptograms out of a batch that could have made one -- the same starvation the selection rule
  // exists to prevent, one level down.
  it('keeps trying a generator’s later difficulties when one band can use nothing', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('5', '5'))

    expect(handedTo(mockStrictGenerate)).toEqual([[4, '5']])
  })

  it('keeps generating for later generators when the first one runs out', async () => {
    setup()

    // Derived 9: outside every band the strict generator declares, so it can place none of them.
    const pack = await addPhrasePuzzles(packDate, poolOf('9', '9', '9'))

    expect(mockStrictGenerate).not.toHaveBeenCalled()
    expect(handedTo(mockPermissiveGenerate)).toEqual([
      [1, '9'],
      [2, '9'],
    ])
    expect(pack.puzzles).toHaveLength(2)
  })

  it('keeps generating for later generators when the pool is empty', async () => {
    setup()

    const pack = await addPhrasePuzzles(packDate, [])

    expect(pack.puzzles).toEqual([])
  })

  // One phrase per puzzle, never reused within a pack -- which is what stops a single day shipping
  // the same answer twice across two types.
  it('never hands the same phrase to two generators', async () => {
    setup()

    const pack = await addPhrasePuzzles(packDate, poolOf('1', '2', '3', '4', '5'))

    const answers = pack.puzzles.map((puzzle) => (puzzle as Puzzle<{ answer: string }>).data.answer)
    expect(new Set(answers).size).toEqual(answers.length)
    expect(answers).toHaveLength(5)
  })

  // "No usable phrase for this difficulty" cannot distinguish an EMPTY pool from a pool of the wrong
  // SHAPE, and the shape is what actually goes wrong: a batch that serves difficulties 2 and 3
  // several times over and difficulty 4 not at all is a starved band, not a starved run, and the two
  // want opposite fixes. The pool here is all derived 2 -- plenty for difficulty 2, usable by
  // difficulty 3, and nothing at all for difficulty 4.
  it('logs the shape of the pool that starved a band', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('2', '2', '2', '2'))

    expect(log).toHaveBeenCalledWith(
      'No usable phrase for this difficulty, trying the next',
      expect.objectContaining({ difficulty: 4, usableByDifficulty: { 2: 2, 3: 2, 4: 0 } }),
    )
  })

  // A run that turns a large batch into a handful of puzzles and discards the rest used to log the
  // batch size and the puzzle count in different lines and never the leftovers, which reads as a
  // scarce batch when it was an unspendable one.
  it('logs what the pool cost and what went unused', async () => {
    setup()

    await addPhrasePuzzles(packDate, poolOf('2', '2', '2', '2'))

    expect(log).toHaveBeenCalledWith('Phrase pool spent', { date: packDate, generated: 4, pool: 4, unused: 0 })
  })

  // The catch is around each generate CALL. A phrase that cannot be turned into a puzzle costs that
  // puzzle and nothing else -- and the phrase is still spent, so the next difficulty does not
  // immediately retry the same failing input.
  it('loses only the failed puzzle when a generate call throws', async () => {
    setup()
    mockStrictGenerate.mockRejectedValueOnce(new Error('could not encipher'))

    const pack = await addPhrasePuzzles(packDate, poolOf('3', '2', '4', '1', '5'))

    expect(mockStrictGenerate).toHaveBeenCalledTimes(3)
    expect(pack.puzzles).toHaveLength(4)
  })
})
