import { phrazleGenerator } from '@generators/phrazle/generator'
import { Difficulty, Familiarity, Phrase, PhrasePuzzleData, PhraseShape, PhrazleData, Puzzle } from '@types'

jest.mock('@utils/logging')

const phraseOf = (text: string, shape: PhraseShape = 'compact', familiarity: Familiarity = 3): Phrase => ({
  category: 'Idioms',
  familiarity,
  hints: ['A narrower thing', 'Where you meet it', 'Almost naming it'],
  shape,
  text,
})

const shortId = () => 'abc12300'

const generate = (text: string, difficulty: Difficulty = 3): Promise<Puzzle<PhrazleData>> =>
  phrazleGenerator.generate('2026-09-02', difficulty, phraseOf(text), shortId) as Promise<Puzzle<PhrazleData>>

describe('phrazleGenerator.isUsablePhrase', () => {
  // The tolerance band is this generator's appetite, not a property of the phrase. A row pinned to "a derived-3
  // phrase" needs re-choosing whenever the curve moves: pick it off the current table in difficulty.test.ts.
  it.each([
    [2, true],
    [3, true],
    [4, true],
    [5, false],
    [1, false],
  ])('accepts a derived-3 phrase at difficulty %i: %s', (difficulty, expected) => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Knock your socks off'), difficulty as Difficulty)).toBe(expected)
  })

  // The structural floor rejects first, so getDictionary is never reached. CONSCIOUSNESS is thirteen letters,
  // past the per-word cap of nine.
  it('rejects a phrase that fails the structural floor', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Consciousness matters'), 3)).toBe(false)
  })

  // Isolates the dictionary clause: GATSBY is absent from ENABLE and the phrase clears every structural clause.
  // Band 2 rather than 5 because THE GREAT GATSBY derives to 1 -- at band 5 the tolerance rejects it before the
  // dictionary is consulted and the row would stay green with the clause deleted.
  it('rejects a phrase whose word the dictionary lacks', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('The Great Gatsby'), 2)).toBe(false)
  })

  it('accepts a three-word phrase whose words are all in the dictionary', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Bite the bullet'), 2)).toBe(true)
  })

  // Four words including a two-letter word is the class the floor's bounds exist to admit.
  it('accepts a four-word phrase containing a two-letter word', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Out of the blue'), 2)).toBe(true)
  })

  // The shape tag is never read, so a structurally qualifying title is as usable as a tagged compact.
  it('accepts a structurally qualifying phrase tagged as a title', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Brave new world', 'title'), 2)).toBe(true)
  })
})

describe('phrazleGenerator.generate', () => {
  it('ships the canonical answer rather than the corpus text', async () => {
    expect((await generate('  snake   Eyes ')).data.answer).toEqual('SNAKE EYES')
  })

  // Asserts an absence: `maxGuesses` is gone from PhrazleData, so an assertion about its value no longer compiles
  // and without this row the field could come back with nothing objecting. The game is not losable.
  it('ships no guess limit at all', async () => {
    expect((await generate('Snake eyes')).data).not.toHaveProperty('maxGuesses')
  })

  // Asserts an absence, as the guess-limit row above does. Rungs are chosen on the device against the guesses
  // actually made, by lull-ui's src/components/phrazle/rungs.ts, so no row here exercises them.
  it('ships no hint ladder at all', async () => {
    expect((await generate('Snake eyes')).data).not.toHaveProperty('hints')
  })

  // Searches the whole payload rather than one key: the interesting failure is the phrase's ladder reappearing in
  // a field nobody was asserting about.
  it('never ships the phrase own hints', async () => {
    expect(JSON.stringify((await generate('Snake eyes')).data)).not.toContain('Almost naming it')
  })

  // CATEGORY_HIDDEN_BY_DIFFICULTY hides at exactly two of this type's three declared bands.
  it.each([3, 5])('hides the category at difficulty %i', async (difficulty) => {
    const puzzle = await generate('Snake eyes', difficulty as Difficulty)

    expect(puzzle.data.category).toBeUndefined()
    // undefined, not a placeholder: dynamodb.ts stores the pack as JSON.stringify, so the key disappears from the
    // payload the UI reads rather than arriving as null.
    expect(JSON.parse(JSON.stringify(puzzle.data))).not.toHaveProperty('category')
  })

  // Band 2 is declared and not hidden, so "this type ships no category ever" is false.
  it('ships the category at band 2, which it declares', async () => {
    expect((await generate('Snake eyes', 2)).data.category).toEqual('Idioms')
  })

  // A band this type does not declare, so the mechanism is provably the shared table rather than a special case.
  it('shows the category at a band the visibility table does not hide', async () => {
    expect((await generate('Snake eyes', 4)).data.category).toEqual('Idioms')
  })

  it.each([
    [2, 210],
    [3, 240],
    [5, 300],
  ])('estimates difficulty %i at %i seconds', async (difficulty, seconds) => {
    expect((await generate('Snake eyes', difficulty as Difficulty)).estimatedSeconds).toEqual(seconds)
  })

  it('stamps the type and an opaque id', async () => {
    const puzzle = await generate('Snake eyes')

    expect(puzzle.type).toEqual('phrazle')
    expect(puzzle.id).toEqual('2026-09-02:phrazle:abc12300')
    expect(puzzle.difficulty).toEqual(3)
  })

  // Calls generate directly with a phrase isUsablePhrase would have rejected, which is the divergence the
  // self-check guards: what selection saw is not necessarily what ships. GATSBY is in neither the fixture list
  // nor ENABLE.
  it('throws when the answer is not a valid guess for itself', async () => {
    await expect(generate('The Great Gatsby', 5)).rejects.toThrow('Phrazle answer is not a valid guess for itself')
  })

  // `answer` is the only phrase-type answer that is not the corpus text verbatim, so the composed string gets its
  // own content check rather than inheriting its input's.
  it('throws when the canonicalized answer contains a charged word', async () => {
    await expect(generate('Fuck the world')).rejects.toThrow('charged word')
  })

  // toStrictEqual over the whole object rather than `data.answer` alone: tsconfig excludes __tests__/, so the
  // `PhrasePuzzleData` annotation is checked by nothing and a stray field could appear in silence. Band 2 is the
  // only declared band where both fields of the shared base are on the wire at once.
  it('satisfies the shared phrase-puzzle shape', async () => {
    const data: PhrasePuzzleData = (await generate('Snake eyes', 2)).data

    expect(data).toStrictEqual({ answer: 'SNAKE EYES', category: 'Idioms' })
  })
})

describe('phrazleGenerator registration', () => {
  it('declares the count table row', () => {
    expect(phrazleGenerator).toEqual(
      expect.objectContaining({
        baseSeconds: 180,
        countPerDay: 3,
        difficulties: [2, 3, 5],
        secondsPerDifficulty: 30,
        type: 'phrazle',
      }),
    )
  })

  // Every declared band sits on a cell derivedDifficulty can produce, so a starved band is a bad night rather
  // than an unclearable nightly ERROR.
  it('does not claim best-effort', () => {
    expect(phrazleGenerator.bestEffort).toBeUndefined()
  })

  it('applies to every date the API will ever serve', () => {
    // Deliberately earlier than PACK_START_DATE rather than equal to it. appliesTo compares lexically against the
    // pack date, so a floor below PACK_START_DATE means no servable date is too early, without tying the literal
    // to a deploy constant that moves for unrelated reasons.
    expect(phrazleGenerator.availableFrom).toEqual('2026-01-01')
    expect(phrazleGenerator.availableFrom < '2026-08-01').toBe(true)
  })
})
