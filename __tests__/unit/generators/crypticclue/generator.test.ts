import { SHORTLIST_SIZE, drawAnswers } from '@generators/crypticclue/answers'
import { crypticClueContribution } from '@generators/crypticclue/contribution'
import { crypticClueGenerator, crypticTool } from '@generators/crypticclue/generator'
import { verifyClue } from '@generators/crypticclue/verify'
import { BatchRequest, requestBatch } from '@services/model-batch'
import { Candidate, CrypticClueData, Pack, Puzzle } from '@types'
import { log, logError } from '@utils/logging'

jest.mock('@services/model-batch')
jest.mock('@utils/logging')
jest.mock('@generators/crypticclue/answers', () => ({
  SHORTLIST_SIZE: 40,
  drawAnswers: jest.fn(),
}))

// The 152,206-entry membership slice, replaced with the words these fixtures use. This suite is
// about the generator's WIRING; the oracle has its own asset test, and parsing two megabytes of
// array literal per worker is pure cost.
jest.mock('../../../../src/generators/crypticclue/data/known-words', () => ({
  knownWords: ['an', 'angora', 'dance', 'got', 'instant'],
}))

// A deterministic shortlist of exactly SHORTLIST_SIZE entries, one of which the fixture clue
// actually encodes. drawAnswers samples 40 of 1,395 lemmas at random and is pinned by its own suite;
// what this file needs is a shortlist a hand-written clue can be verified against.
const shortlist = (excluded: ReadonlySet<string> = new Set()): ReadonlyMap<string, string> =>
  new Map(
    ['TANGO', ...Array.from({ length: SHORTLIST_SIZE - 1 }, (_unused, index) => `WORD${index}`)]
      .filter((word) => !excluded.has(word))
      .map((word) => [word, word]),
  )

const clue = (overrides: Record<string, unknown> = {}) => ({
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  definition: 'Dance',
  device: 'hidden',
  fodder: 'instant angora',
  indicator: 'hidden in',
  ...overrides,
})

const pack = (answer: string): Pack => ({
  complete: false,
  date: '2026-10-02',
  puzzles: [
    {
      data: { answer },
      difficulty: 3,
      estimatedSeconds: 120,
      id: '2026-10-02:crypticclue:abcd1234',
      type: 'crypticclue',
    } as Puzzle,
  ],
})

type CrypticRequest = BatchRequest<unknown, Candidate<CrypticClueData> & { answer: string }>

describe('crypticClueGenerator', () => {
  const mockRequestBatch = jest.mocked(requestBatch)
  const mockDrawAnswers = jest.mocked(drawAnswers)

  // What the faked model call comes back with, set by `fetch` below.
  let returned: unknown[] = []

  // Shared defaults, per CLAUDE.md. requestBatch is faked faithfully enough that `accept` really
  // runs over the elements a call returns -- which is what makes the funnel counts below a
  // measurement of the generator rather than of the fixture.
  beforeAll(() => {
    mockDrawAnswers.mockImplementation(shortlist)
    mockRequestBatch.mockImplementation(async (request) =>
      returned.map((item) => request.accept(item)).filter((item) => item !== undefined),
    )
  })

  const request = (): CrypticRequest => mockRequestBatch.mock.calls[0][0] as CrypticRequest

  const fetch = (
    count: number,
    recent: { puzzles: Puzzle[] }[] = [],
    items: unknown[] = [],
  ): Promise<Candidate<CrypticClueData>[]> => {
    returned = items
    return crypticClueGenerator.fetchCandidates(count, recent)
  }

  describe('the tool schema', () => {
    it('describes the top level and nothing below it', () => {
      expect(Object.keys(crypticTool.input_schema).sort()).toStrictEqual(['properties', 'required', 'type'])
      expect(crypticTool.input_schema.properties.clues).toStrictEqual({ items: {}, type: 'array' })
    })

    // Under an opaque element the description is the ONLY thing that specifies a clue to the model,
    // so the values that reach it as literals are pinned to the constants that enforce them.
    it('names every field the schema no longer describes', () => {
      expect(crypticTool.description).toContain('`answer`')
      expect(crypticTool.description).toContain('`clue`')
      expect(crypticTool.description).toContain('`device`')
      expect(crypticTool.description).toContain('`definition`')
      expect(crypticTool.description).toContain('`indicator`')
      expect(crypticTool.description).toContain('`fodder`')
      expect(crypticTool.description).toContain('"hidden"')
      expect(crypticTool.description).toContain('"anagram"')
    })
  })

  describe('fetchCandidates', () => {
    it('asks for eight candidates per puzzle', async () => {
      await fetch(1)

      expect(request().asked).toEqual(8)
      expect(request().context.clueCount).toEqual(8)
    })

    it('scales the over-ask with the count asked of it', async () => {
      await fetch(2)

      expect(request().asked).toEqual(16)
    })

    it('reads the recent packs through the narrowed exclusion reader', async () => {
      await fetch(1, [pack('TANGO')])

      expect(request().context.crypticAnswersAlreadyUsed).toStrictEqual(['TANGO'])
      // ACTUALLY PASSED. An earlier design claimed keyOf collapsed candidates "against the
      // exclusions" and never passed the field that does it.
      expect(request().excludedKeys).toStrictEqual(new Set(['TANGO']))
    })

    it('draws its shortlist against the same exclusions', async () => {
      await fetch(1, [pack('TANGO')])

      expect(mockDrawAnswers).toHaveBeenCalledWith(new Set(['TANGO']))
      expect(request().context.answerChoices).not.toContain('TANGO')
    })

    it('supplies the whole shortlist and both indicator lists', async () => {
      await fetch(1)

      expect(request().context.answerChoices).toHaveLength(SHORTLIST_SIZE)
      expect(request().context.hiddenIndicators).toContain('hidden in')
      expect(request().context.anagramIndicators).toContain('shaken')
      expect(request().context.connectives).toContain('OF')
    })

    // The charset is NOT in the context object. The prompt text states it, and a second copy here is
    // a second place for it to drift out of agreement with CLUE_CHARSET.
    it('does not put the charset in the context', async () => {
      await fetch(1)

      expect(JSON.stringify(request().context)).not.toContain('A-Za-z')
    })

    it('names the prompt and the tool it was built for', async () => {
      await fetch(1)

      expect(request().tool).toBe(crypticTool)
      expect(request().type).toEqual('crypticclue')
    })

    it('reads the clues out of the payload, and an absent key as no clues', async () => {
      await fetch(1)

      expect(request().itemsOf({ clues: [1, 2] })).toStrictEqual([1, 2])
      expect(request().itemsOf({})).toStrictEqual([])
      expect(request().itemsOf(undefined)).toStrictEqual([])
    })

    it('costs one candidate rather than the batch when one is bad', async () => {
      const kept = await fetch(1, [], [clue({ clue: 'Dance hidden in instant angora ,' }), clue()])

      expect(kept).toHaveLength(1)
    })

    it('collapses two clues on one answer', async () => {
      const kept = await fetch(1, [], [clue()])

      expect(request().keyOf(kept[0] as Candidate<CrypticClueData> & { answer: string })).toEqual('TANGO')
    })

    it('marks every candidate usable at difficulty 3 only', async () => {
      const kept = await fetch(1, [], [clue()])

      expect(kept[0].usableAt).toStrictEqual([3])
    })

    // The funnel is a DELIVERABLE rather than telemetry garnish: the cheap kill criterion reads it,
    // and the per-reason counts are what turn "the model is bad at cryptics" into a clause to argue
    // about. It is a `log` because the handler already raises 'Model type is still short after its
    // call' unconditionally, and a second ERROR for one event into a stack whose only alarm channel
    // is a level="ERROR" subscription is exactly the noise that design exists to avoid.
    it('logs the funnel on one line, at log rather than logError', async () => {
      await fetch(1, [], [clue()])

      expect(log).toHaveBeenCalledWith('Fetched cryptic clues', {
        asked: 8,
        kept: 1,
        rejections: {},
        returned: 1,
        type: 'crypticclue',
        verified: 1,
      })
      expect(logError).not.toHaveBeenCalled()
    })

    it('counts each rejection under its own reason code', async () => {
      await fetch(1, [], [clue({ clue: 'Dance hidden in instant angora with' }), clue({ answer: 'WALTZ' })])

      expect(log).toHaveBeenCalledWith(
        'Fetched cryptic clues',
        expect.objectContaining({
          kept: 0,
          rejections: { 'answer-not-on-shortlist': 1, 'residue-out-of-position': 1 },
          returned: 2,
          verified: 0,
        }),
      )
    })

    it('rejects a fodder word the membership oracle does not know', async () => {
      const kept = await fetch(1, [], [clue({ clue: 'Dance hidden in instant angorax', fodder: 'instant angorax' })])

      expect(kept).toStrictEqual([])
    })

    // The clue's own G1-G4 pass, which verify.ts does not make: G4, the charged-term check, has no
    // counterpart in the verifier at all, and rung 2 quotes a slice of this string.
    it('rejects a clue carrying a charged term, which no verifier clause catches', async () => {
      const kept = await fetch(1, [], [clue({ clue: 'Bastard hidden in instant angora', definition: 'Bastard' })])

      expect(kept).toStrictEqual([])
    })
  })

  describe('build', () => {
    const built = async (overrides: Record<string, unknown> = {}): Promise<Puzzle<CrypticClueData>> => {
      const kept = await fetch(1, [], [clue(overrides)])
      return (await kept[0].build('2026-10-02', 3, () => 'abcd1234')) as Puzzle<CrypticClueData>
    }

    it('stamps the id, the type and the estimated seconds', async () => {
      expect(await built()).toEqual(
        expect.objectContaining({
          difficulty: 3,
          estimatedSeconds: 120,
          id: '2026-10-02:crypticclue:abcd1234',
          type: 'crypticclue',
        }),
      )
    })

    // Derived rather than pinned to a literal, so a change to either constant on the contribution
    // moves this and the registry's ceiling assertion together.
    it('derives estimatedSeconds from the contribution rather than from a literal', async () => {
      const { baseSeconds, secondsPerDifficulty } = crypticClueContribution

      expect((await built()).estimatedSeconds).toEqual(baseSeconds + secondsPerDifficulty * 2)
    })

    it('ships the code-supplied answer, never the model spelling of it', async () => {
      expect((await built({ answer: 'tango' })).data.answer).toEqual('TANGO')
    })

    it('derives the enumeration from the answer', async () => {
      expect((await built()).data.enumeration).toStrictEqual([5])
    })

    // ABSENT BY DESIGN rather than hidden: the definition half IS the category, it is always on the
    // wire because it is inside the clue, and hiding it is not available.
    it('ships no category, by design rather than by omission', async () => {
      expect('category' in (await built()).data).toBe(false)
    })

    it('ships no indicatorSpan, because nothing renders it', async () => {
      expect('indicatorSpan' in (await built()).data).toBe(false)
    })

    it('ships three rungs, device first', async () => {
      const { hints } = (await built()).data

      expect(hints).toHaveLength(3)
      expect(hints[0].text).toContain('hidden word')
      expect(hints[1].text).toEqual('The definition is "Dance".')
    })

    // THE STORED-SPAN ROUND-TRIP -- one of the two most important tests in this change. Any future
    // normalization of `clue` on the way out silently invalidates every span, and nothing else would
    // catch it, because the spans still typecheck and still render SOMETHING. Insert a .trim() on
    // the clue written into `data`, give the fixture a leading space so the trim moves the string,
    // and these three assertions are what go red.
    it('round-trips the spans through a serialized-and-parsed data', async () => {
      const stored = JSON.parse(JSON.stringify((await built()).data)) as CrypticClueData

      expect(stored.clue.slice(stored.definitionSpan.start, stored.definitionSpan.end)).toEqual('Dance')
      expect(stored.clue.slice(stored.fodderSpan.start, stored.fodderSpan.end)).toEqual('instant angora')
      expect(
        verifyClue(clue({ clue: stored.clue }), shortlist(), (word) => ['instant', 'angora'].includes(word)),
      ).toBeDefined()
    })
  })
})
