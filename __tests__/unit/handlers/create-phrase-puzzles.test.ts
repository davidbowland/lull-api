import { pack, packDate, phrases } from '../__mocks__'
import { createPhrasePuzzlesHandler } from '@handlers/create-phrase-puzzles'
import { getRecentPacks } from '@services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '@services/packs'
import { generatePhrases } from '@services/phrases'
import { reviewPhrases } from '@services/review'
import { logError } from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/packs')
jest.mock('@services/phrases')
jest.mock('@services/review')
jest.mock('@utils/logging')

describe('create-phrase-puzzles', () => {
  const event = { date: packDate }

  beforeAll(() => {
    jest.mocked(getRecentPacks).mockResolvedValue([])
    jest.mocked(generatePhrases).mockResolvedValue(phrases)
    jest.mocked(addPhrasePuzzles).mockResolvedValue({ ...pack, complete: true })
    // What the real registry now returns: 2 cryptograms plus 2 missing vowels, after the pack-wide
    // count table rebalanced both types down.
    jest.mocked(phrasesNeeded).mockReturnValue(4)
    jest.mocked(reviewPhrases).mockImplementation(async (input) => input)
  })

  // An unvalidated event field reaching a DynamoDB key is an unbounded key, and this one names both
  // the pack to fill and the dates to read.
  it.each([
    ['missing', undefined],
    ['malformed', 'fnord'],
  ])('refuses a %s date', async (_description, date) => {
    await createPhrasePuzzlesHandler({ date } as never)

    expect(generatePhrases).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('Invalid date, refusing to generate', { date })
  })

  // Bounded on purpose: BatchGetItem over known keys, so cost does not grow with the archive.
  it('reads the configured window of recent packs', async () => {
    await createPhrasePuzzlesHandler(event as never)

    expect(getRecentPacks).toHaveBeenCalledWith(expect.arrayContaining([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]))
    expect(jest.mocked(getRecentPacks).mock.calls[0][0]).toHaveLength(20)
  })

  // The dates read are the days BEFORE the target, newest first -- the target itself is the pack
  // being filled, so its own answers are not exclusions.
  it('reads the days before the target date, not the target itself', async () => {
    await createPhrasePuzzlesHandler({ date: '2026-06-15' } as never)

    const dates = jest.mocked(getRecentPacks).mock.calls[0][0]
    expect(dates[0]).toEqual('2026-06-14')
    expect(dates).not.toContain('2026-06-15')
  })

  // Shown to the model rather than enforced after the fact: rejecting a repeat the model was never
  // told about kills a generation with no way for it to have done better.
  it('hands recent answers to the generator as exclusions', async () => {
    jest.mocked(getRecentPacks).mockResolvedValueOnce([
      {
        complete: true,
        date: '2026-06-14',
        puzzles: [
          { data: { answer: 'Jaws' }, difficulty: 1, estimatedSeconds: 60, id: 'a', type: 'missingvowels' },
          { data: { goal: 10 }, difficulty: 1, estimatedSeconds: 60, id: 'b', type: 'gofigure' },
        ],
      },
    ] as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(generatePhrases).toHaveBeenCalledWith(expect.any(Number), ['Jaws'])
  })

  // Every type that draws on the shared phrase corpus, not just Missing Vowels. An older filter read
  // `puzzle.type === 'missingvowels'`, so a cryptogram's answer was invisible to it and every
  // cryptogram phrase of the last 20 days was free to be served again.
  it('excludes the answers of every phrase type, not just Missing Vowels', async () => {
    jest.mocked(getRecentPacks).mockResolvedValueOnce([
      {
        complete: true,
        date: '2026-06-14',
        puzzles: [
          { data: { answer: 'Jaws' }, difficulty: 1, estimatedSeconds: 60, id: 'a', type: 'missingvowels' },
          { data: { answer: 'Bite the bullet' }, difficulty: 2, estimatedSeconds: 210, id: 'b', type: 'cryptogram' },
          { data: { goal: 10 }, difficulty: 1, estimatedSeconds: 60, id: 'c', type: 'gofigure' },
        ],
      },
    ] as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(generatePhrases).toHaveBeenCalledWith(expect.any(Number), ['Jaws', 'Bite the bullet'])
  })

  // goFigure's data has no `answer`, and a pack can also carry a type this deploy has never heard
  // of. Neither may put an undefined into the exclusion list the prompt is built from.
  //
  // The list is read out of the mock call and asserted with toStrictEqual rather than through
  // toHaveBeenCalledWith(..., []) DELIBERATELY: jest's toEqual semantics treat [undefined] as equal
  // to [], so the obvious form of this assertion passes even when an undefined leaks all the way
  // into the prompt -- which is the exact failure this test is named for.
  it('skips a puzzle whose data carries no answer', async () => {
    jest.mocked(getRecentPacks).mockResolvedValueOnce([
      {
        complete: true,
        date: '2026-06-14',
        puzzles: [
          { data: { goal: 10 }, difficulty: 1, estimatedSeconds: 60, id: 'a', type: 'gofigure' },
          { data: null, difficulty: 1, estimatedSeconds: 60, id: 'b', type: 'gofigure' },
        ],
      },
    ] as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(jest.mocked(generatePhrases).mock.calls[0][1]).toStrictEqual([])
  })

  // The hard constraint the incoming types depend on. `answer` is doing two jobs -- the offline
  // adjudication answer, and the cross-type anti-repetition key -- and they diverge for a type whose
  // answer is an ordinary single English word. Putting SIDE into a list titled "phrases not to
  // reuse" bans that word from three other types for twenty nights.
  it('does not hand the model an answer from a type outside the phrase corpus', async () => {
    jest.mocked(getRecentPacks).mockResolvedValueOnce([
      {
        complete: true,
        date: '2026-06-14',
        puzzles: [{ data: { answer: 'SIDE' }, difficulty: 3, estimatedSeconds: 120, id: 'a', type: 'crypticclue' }],
      },
    ] as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(jest.mocked(generatePhrases).mock.calls[0][1]).toStrictEqual([])
  })

  // Re-gated on READ, not merely on write. A pack written by an older deploy passed an older gate
  // set, and nothing in this repo will ever rewrite it -- so without this it re-enters tonight's
  // prompt ungated.
  it('drops a stored answer that no longer passes the gates', async () => {
    jest.mocked(getRecentPacks).mockResolvedValueOnce([
      {
        complete: true,
        date: '2026-06-14',
        puzzles: [
          { data: { answer: 'Catch 22' }, difficulty: 1, estimatedSeconds: 60, id: 'a', type: 'cryptogram' },
          { data: { answer: 'Jaws' }, difficulty: 1, estimatedSeconds: 60, id: 'b', type: 'missingvowels' },
        ],
      },
    ] as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(jest.mocked(generatePhrases).mock.calls[0][1]).toStrictEqual(['Jaws'])
  })

  // More than a full pack needs. The blocklist, charset and word-count rules all reject after the
  // fact, so asking for exactly what is needed reliably comes up short.
  it('asks for more phrases than a pack needs', async () => {
    await createPhrasePuzzlesHandler(event as never)

    // 7 phrases a full pack needs, times three. Cryptogram's filter is strict enough that a
    // two-times request came up short.
    expect(jest.mocked(generatePhrases).mock.calls[0][0]).toEqual(12)
  })

  it('reviews the generated phrases before assembling the pack', async () => {
    await createPhrasePuzzlesHandler(event as never)

    expect(reviewPhrases).toHaveBeenCalledWith(phrases)
  })

  it('adds the reviewed puzzles to the pack', async () => {
    jest.mocked(reviewPhrases).mockResolvedValueOnce(phrases.slice(0, 2))

    await createPhrasePuzzlesHandler(event as never)

    expect(addPhrasePuzzles).toHaveBeenCalledWith(packDate, phrases.slice(0, 2))
  })

  // The moment that actually warrants an alarm: the async builder has run and the day is STILL
  // short, which the callers deliberately do not raise because at their point it is expected.
  it('logs an error when the pack is still incomplete afterwards', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({ ...pack, complete: false })

    await createPhrasePuzzlesHandler(event as never)

    expect(logError).toHaveBeenCalledWith(
      'Pack is still incomplete after adding phrase puzzles',
      expect.objectContaining({ date: packDate }),
    )
  })

  // The pack-level line above stopped saying WHICH type failed the moment there were two builders
  // and several types behind one flag, and for a bestEffort type it is silent by construction --
  // isComplete skips it, so `complete` can be true with that type at zero. The per-type line is the
  // only thing left that can report either.
  //
  // The fixture reaches both arms of the loop on purpose: cryptogram declares countPerDay 2 and gets
  // one, missingvowels declares 2 and gets none. A fixture returning nothing at all would still name
  // both types while proving nothing about the count comparison.
  it('names the phrase type that came up short', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({
      complete: false,
      date: packDate,
      puzzles: [{ data: { answer: 'Jaws' }, difficulty: 3, estimatedSeconds: 240, id: 'a', type: 'cryptogram' }],
    } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(logError).toHaveBeenCalledWith('Phrase type is still short after its call', {
      date: packDate,
      type: 'cryptogram',
    })
    expect(logError).toHaveBeenCalledWith('Phrase type is still short after its call', {
      date: packDate,
      type: 'missingvowels',
    })
  })

  // The counterpart to the row above: a type that met its countPerDay is NOT named. Without this the
  // loop could satisfy the row above by logging unconditionally, which is a line nobody can act on.
  it('does not name a phrase type that met its count', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({
      complete: false,
      date: packDate,
      puzzles: [
        { data: { answer: 'Jaws' }, difficulty: 3, estimatedSeconds: 240, id: 'a', type: 'cryptogram' },
        { data: { answer: 'Alien' }, difficulty: 4, estimatedSeconds: 270, id: 'b', type: 'cryptogram' },
      ],
    } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(logError).not.toHaveBeenCalledWith('Phrase type is still short after its call', {
      date: packDate,
      type: 'cryptogram',
    })
    expect(logError).toHaveBeenCalledWith('Phrase type is still short after its call', {
      date: packDate,
      type: 'missingvowels',
    })
  })

  // Swallowed rather than rethrown. The self-contained puzzles are already written, so a failed
  // model call leaves a short pack rather than no pack.
  it('logs and does not throw when generation fails', async () => {
    jest.mocked(generatePhrases).mockRejectedValueOnce(new Error('bedrock on fire'))

    await expect(createPhrasePuzzlesHandler(event as never)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('Could not add phrase puzzles', expect.objectContaining({ date: packDate }))
  })
})
