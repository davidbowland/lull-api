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
  // THE BAND, tested here rather than in difficulty.ts: the tolerance is this generator's appetite,
  // not a property of the phrase. TOE HOLD derives to 3.
  it.each([
    [2, true],
    [3, true],
    [4, true],
    [5, false],
    [1, false],
  ])('accepts a derived-3 phrase at difficulty %i: %s', (difficulty, expected) => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Toe hold'), difficulty as Difficulty)).toBe(expected)
  })

  // The structural floor rejecting first, so getDictionary is never reached for a phrase that does
  // not look like a Phrazle.
  it('rejects a phrase that fails the structural floor', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('The Empire Strikes Back'), 3)).toBe(false)
  })

  // THE DICTIONARY CLAUSE, isolated. GATSBY is absent from ENABLE and from the fixture list, and the
  // phrase clears every structural clause -- 3/5/6 words, 14 letters -- so the dictionary is the only
  // thing that can reject it. This is the "puzzle rejects its own answer" hole, closed at selection.
  it('rejects a phrase whose word the dictionary lacks', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('The Great Gatsby'), 5)).toBe(false)
  })

  it('accepts a three-word compact whose words are all in the dictionary', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Bite the bullet'), 5)).toBe(true)
  })

  // The shape tag is never read, so a structurally compact title is as usable as a tagged compact.
  it('accepts a structurally compact phrase tagged as a title', () => {
    expect(phrazleGenerator.isUsablePhrase(phraseOf('Brave new world', 'title'), 5)).toBe(true)
  })
})

describe('phrazleGenerator.generate', () => {
  it('ships the canonical answer rather than the corpus text', async () => {
    expect((await generate('  toe   Hold ')).data.answer).toEqual('TOE HOLD')
  })

  // ASSERTS AN ABSENCE, which is the only way left to defend this. `maxGuesses` is gone from
  // PhrazleData, so an assertion about its VALUE no longer compiles -- and without this one the
  // field could come back tomorrow with nothing objecting. The game is not losable and nothing on
  // the wire bounds the attempts.
  it('ships no guess limit at all', async () => {
    expect((await generate('Toe hold')).data).not.toHaveProperty('maxGuesses')
  })

  it('builds three code-authored positional rungs off the canonical answer', async () => {
    expect((await generate('Toe hold')).data.hints).toStrictEqual([
      { metadata: { kind: 'phrazle-reveal', letter: 'T', position: 0, word: 0 }, text: 'Letter 1 of word 1 is T.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'H', position: 0, word: 1 }, text: 'Letter 1 of word 2 is H.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'O', position: 1, word: 0 }, text: 'Letter 2 of word 1 is O.' },
    ])
  })

  // It never ships the model's prose ladder. The shared prompt's rung 3 is near-explicit by
  // instruction, and here recognizing the phrase IS the game.
  it('never ships the phrase own hints', async () => {
    const { hints } = (await generate('Toe hold')).data

    expect(hints.map((hint) => hint.text)).not.toContain('Almost naming it')
  })

  // HIDDEN AT TWO OF THE THREE DECLARED BANDS. This type shipped no category at all while it
  // declared [3, 5] -- exactly the two bands CATEGORY_HIDDEN_BY_DIFFICULTY hides at -- and band 1
  // ends that, which is asserted directly below. The key disappears from the payload rather than
  // being nulled.
  it.each([3, 5])('hides the category at difficulty %i', async (difficulty) => {
    const puzzle = await generate('Toe hold', difficulty as Difficulty)

    expect(puzzle.data.category).toBeUndefined()
    // undefined, not a placeholder: dynamodb.ts stores the pack as JSON.stringify, so the key
    // disappears from the payload the UI reads rather than arriving as null.
    expect(JSON.parse(JSON.stringify(puzzle.data))).not.toHaveProperty('category')
  })

  // THE REVERSAL, asserted on a DECLARED band. Band 2 joined this type on 2026-08-26 and
  // CATEGORY_HIDDEN_BY_DIFFICULTY does not hide at 2, so the sentence "this type ships no category
  // ever" -- true only because [3, 5] happened to be the hidden pair -- stops being true here.
  it('ships the category at band 2, which it declares', async () => {
    expect((await generate('Toe hold', 2)).data.category).toEqual('Idioms')
  })

  // And at a band this type does NOT declare, so the mechanism is provably the shared table rather
  // than anything band 1 special-cases.
  it('shows the category at a band the visibility table does not hide', async () => {
    expect((await generate('Toe hold', 4)).data.category).toEqual('Idioms')
  })

  it.each([
    [2, 210],
    [3, 240],
    [5, 300],
  ])('estimates difficulty %i at %i seconds', async (difficulty, seconds) => {
    expect((await generate('Toe hold', difficulty as Difficulty)).estimatedSeconds).toEqual(seconds)
  })

  it('stamps the type and an opaque id', async () => {
    const puzzle = await generate('Toe hold')

    expect(puzzle.type).toEqual('phrazle')
    expect(puzzle.id).toEqual('2026-09-02:phrazle:abc12300')
    expect(puzzle.difficulty).toEqual(3)
  })

  // THE SELF-CHECK THAT CAN ACTUALLY FAIL, reached by calling generate directly with a phrase the
  // predicate would have rejected -- which is precisely the divergence it guards: what the floor and
  // the dictionary saw at selection is not necessarily what ships. GATSBY is in neither the fixture
  // list nor ENABLE.
  //
  // The earlier draft of this guard was markGuess(words, words), a tautology: one array passed as
  // both parameters is green at every position for any content whatsoever, so no phrase could make
  // it fire and the mandated test for it was unwritable.
  it('throws when the answer is not a valid guess for itself', async () => {
    await expect(generate('The Great Gatsby', 5)).rejects.toThrow('Phrazle answer is not a valid guess for itself')
  })

  // THE CONTENT GATE ON THE CODE-COMPOSED STRING. `answer` is the only phrase-type answer that is not
  // the corpus text verbatim, so the string a player sees is composed here -- and a composed string
  // gets its own check rather than inheriting its input's. The floor's canonicality clause makes this
  // provably redundant today, which is a claim about today's floor.
  it('throws when the canonicalized answer contains a charged word', async () => {
    await expect(generate('Fuck the world')).rejects.toThrow('charged word')
  })

  // The generated puzzle satisfies the base every phrase type shares -- `answer` is the one string
  // the player types, one guess at a time, which is what puts this type in PHRASE_CORPUS_TYPES.
  it('satisfies the shared phrase-puzzle shape', async () => {
    const data: PhrasePuzzleData = (await generate('Toe hold')).data

    expect(data.answer).toEqual('TOE HOLD')
    expect(data.hints).toHaveLength(3)
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

  // Not claimed, and its absence is the decision: every declared band is reachable from the
  // derivation table, so a starved band here is a bad night rather than an unclearable nightly ERROR.
  //
  // EVERY DECLARED BAND SITS ON A CELL THE DIAL CAN ACTUALLY PRODUCE, which band 1 did not:
  // derivedDifficulty bottoms out at 2 by arithmetic -- widthOf's floor is 3, two words add 0, and
  // the sharing bonus subtracts at most 1 -- so a declared band 1 would have been reachable only
  // through DIFFICULTY_TOLERANCE from the same derived-2 cell band 2 draws on directly. Two bands
  // drawing on one cell is one puzzle wearing two labels. prompts/create-phrases.txt asks for that
  // cell by name and by count, which is what keeps band 2 genuinely easier than band 3.
  it('does not claim best-effort', () => {
    expect(phrazleGenerator.bestEffort).toBeUndefined()
  })

  // Forward of the date this branch lands, so the type appears on no wire until lull-ui's board
  // ships and someone moves it deliberately.
  it('applies to every date the API will ever serve', () => {
    // Deliberately earlier than PACK_START_DATE rather than equal to it. appliesTo compares
    // lexically against the pack date, and every servable date is >= PACK_START_DATE, so a floor
    // below that means "no date this API accepts is too early for this type" without tying the
    // literal to a deploy constant that moves for unrelated reasons.
    expect(phrazleGenerator.availableFrom).toEqual('2026-01-01')
    expect(phrazleGenerator.availableFrom < '2026-08-01').toBe(true)
  })
})
