import { pack, packDate, phrases } from '../__mocks__'
import { createPhrasePuzzlesHandler } from '@handlers/create-phrase-puzzles'
import { getRecentPacks } from '@services/dynamodb'
import { addPhrasePuzzles, phrasesNeeded } from '@services/packs'
import { generatePhrases } from '@services/phrases'
import { reviewPhrases } from '@services/review'
import { log, logError, logWarning } from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/packs')
jest.mock('@services/phrases')
jest.mock('@services/review')
jest.mock('@utils/logging')

describe('create-phrase-puzzles', () => {
  const event = { date: packDate }

  beforeAll(() => {
    jest.mocked(getRecentPacks).mockResolvedValue([])
    jest.mocked(generatePhrases).mockResolvedValue({ phrases, upstreamUnavailable: false })
    jest.mocked(addPhrasePuzzles).mockResolvedValue({ ...pack, complete: true })
    // What the real registry returns, stubbed so this suite pins the MULTIPLIER; index.test.ts and
    // packs-integration.test.ts cover the registry.
    jest.mocked(phrasesNeeded).mockReturnValue(6)
    jest.mocked(reviewPhrases).mockImplementation(async (input) => input)
  })

  // An unvalidated event field reaching a DynamoDB key is unbounded.
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
    // 2 * PHRASE_HISTORY_DAYS + 1: the window reaches both ways and includes the target.
    expect(jest.mocked(getRecentPacks).mock.calls[0][0]).toHaveLength(41)
  })

  // A backward-only window suits only the nightly run: a backfill targets the past, and the packs
  // that already shipped after it are the ones a player sees beside it.
  it('reads the days on BOTH sides of the target date', async () => {
    await createPhrasePuzzlesHandler({ date: '2026-06-15' } as never)

    const dates = jest.mocked(getRecentPacks).mock.calls[0][0]
    expect(dates).toContain('2026-06-14')
    expect(dates).toContain('2026-06-16')
    expect(dates).toContain('2026-05-26')
    expect(dates).toContain('2026-07-05')
  })

  // A short pack is topped up by a later run over the SAME date, which would otherwise be blind
  // to the answers its own pack carries.
  it('reads the target date itself, so a top-up cannot repeat its own pack', async () => {
    await createPhrasePuzzlesHandler({ date: '2026-06-15' } as never)

    expect(jest.mocked(getRecentPacks).mock.calls[0][0]).toContain('2026-06-15')
  })

  // Shown to the model rather than enforced after: rejecting a repeat it was never told about
  // kills a generation that had no way to do better.
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

  // A filter narrowed to one type leaves every other type's recent phrases free to serve again.
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

  // goFigure's data has no `answer`, and a pack can carry a type this deploy never heard of.
  // toStrictEqual on the captured argument, because jest's toEqual treats [undefined] as [] and
  // would pass over the exact leak here.
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

  // `answer` does two jobs -- offline adjudication and the anti-repetition key -- which diverge
  // for an ordinary English word: SIDE in a list of phrases not to reuse bans it for 20 nights.
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

  // Re-gated on READ: nothing rewrites a pack an older deploy wrote under an older gate set.
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

  // The blocklist, charset and word-count rules reject after the fact, so asking for exactly what
  // is needed comes up short.
  it('asks for more phrases than a pack needs', async () => {
    await createPhrasePuzzlesHandler(event as never)

    // The 6 a full pack needs, times three: a two-times request came up short against cryptogram's
    // filter alone. phrasesNeeded ignores availableFrom, so a type counts here from the day it
    // registers, and asking for too many is the recoverable direction.
    expect(jest.mocked(generatePhrases).mock.calls[0][0]).toEqual(18)
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

  // `complete` is computed over the WHOLE registry and lambda.ts invokes the two builders
  // concurrently, so alarming here pages about the other builder's types. Nothing is lost: the
  // per-type loop below names every type this handler owns.
  it('does not alarm on pack-level completeness, which is the other builder to finish', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({ ...pack, complete: false })

    await createPhrasePuzzlesHandler(event as never)

    expect(logError).not.toHaveBeenCalledWith('Pack is still incomplete after adding phrase puzzles', expect.anything())
  })

  // The pack-level count tells "short by one" from "produced nothing" without summing three lines.
  it('still reports pack completeness at log level', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({ ...pack, complete: false })

    await createPhrasePuzzlesHandler(event as never)

    expect(log).toHaveBeenCalledWith(
      'Phrase puzzles added',
      expect.objectContaining({ complete: false, date: packDate }),
    )
  })

  // Short and empty are different pages, and the level says which: the next GET re-triggers a
  // short night through hasWorkRemaining, while a type at zero is a pipeline no retry fixes. The
  // fixture reaches both arms -- cryptogram gets one of two, the other types none.
  it('alarms only for the phrase type that produced nothing', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({
      complete: false,
      date: packDate,
      puzzles: [{ data: { answer: 'Jaws' }, difficulty: 3, estimatedSeconds: 240, id: 'a', type: 'cryptogram' }],
    } as never)

    await createPhrasePuzzlesHandler(event as never)

    // Both types, each naming its OWN countPerDay: asserting one passes over a loop that stops.
    expect(logError).toHaveBeenCalledWith('Phrase type produced nothing', {
      date: packDate,
      type: 'phrazle',
      upstreamUnavailable: false,
      wanted: 3,
    })
    expect(logError).toHaveBeenCalledWith('Phrase type produced nothing', {
      date: packDate,
      type: 'missingvowels',
      upstreamUnavailable: false,
      wanted: 3,
    })
    expect(logError).not.toHaveBeenCalledWith(
      'Phrase type produced nothing',
      expect.objectContaining({
        type: 'cryptogram',
      }),
    )
  })

  // One upstream fault is not three pages, since every type draws from one pool. logError is
  // asserted absent across ALL types, because a loop lowering only the first would satisfy a
  // single-type check.
  it('warns rather than alarming for every type when no call reached the model', async () => {
    jest.mocked(generatePhrases).mockResolvedValueOnce({ phrases: [], upstreamUnavailable: true })
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [] } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(logWarning).toHaveBeenCalledWith('Phrase type produced nothing', {
      date: packDate,
      type: 'phrazle',
      upstreamUnavailable: true,
      wanted: 3,
    })
    expect(logError).not.toHaveBeenCalledWith('Phrase type produced nothing', expect.anything())
  })

  // What makes the flag worth carrying: an empty pool whose calls came back is a prompt not being
  // followed, which lowering on emptiness alone would silence.
  it('still alarms when the calls came back and the pool was empty anyway', async () => {
    jest.mocked(generatePhrases).mockResolvedValueOnce({ phrases: [], upstreamUnavailable: false })
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({ complete: false, date: packDate, puzzles: [] } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(logError).toHaveBeenCalledWith('Phrase type produced nothing', {
      date: packDate,
      type: 'phrazle',
      upstreamUnavailable: false,
      wanted: 3,
    })
  })

  // Dropping the alarm must not drop the reading: "1 of 2" over a week is a trend.
  it('reports a partially short phrase type at log level with both counts', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({
      complete: false,
      date: packDate,
      puzzles: [{ data: { answer: 'Jaws' }, difficulty: 3, estimatedSeconds: 240, id: 'a', type: 'cryptogram' }],
    } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(log).toHaveBeenCalledWith('Phrase type is short after its call', {
      date: packDate,
      produced: 1,
      type: 'cryptogram',
      wanted: 2,
    })
  })

  // Without this, the loop could satisfy the rows above by logging unconditionally.
  it('says nothing about a phrase type that met its count', async () => {
    jest.mocked(addPhrasePuzzles).mockResolvedValueOnce({
      complete: false,
      date: packDate,
      puzzles: [
        { data: { answer: 'Jaws' }, difficulty: 3, estimatedSeconds: 240, id: 'a', type: 'cryptogram' },
        { data: { answer: 'Alien' }, difficulty: 4, estimatedSeconds: 270, id: 'b', type: 'cryptogram' },
      ],
    } as never)

    await createPhrasePuzzlesHandler(event as never)

    expect(log).not.toHaveBeenCalledWith(
      'Phrase type is short after its call',
      expect.objectContaining({
        type: 'cryptogram',
      }),
    )
    expect(logError).not.toHaveBeenCalledWith(
      'Phrase type produced nothing',
      expect.objectContaining({
        type: 'cryptogram',
      }),
    )
  })

  // Swallowed: the self-contained puzzles are written, so a failed model call leaves a short pack.
  it('logs and does not throw when generation fails', async () => {
    jest.mocked(generatePhrases).mockRejectedValueOnce(new Error('bedrock on fire'))

    await expect(createPhrasePuzzlesHandler(event as never)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledWith('Could not add phrase puzzles', expect.objectContaining({ date: packDate }))
  })
})
