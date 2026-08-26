import { SHORTLIST_SIZE, drawAnswers } from '@generators/crypticclue/answers'
import { crypticClueContribution } from '@generators/crypticclue/contribution'
import { crypticClueGenerator, crypticTool } from '@generators/crypticclue/generator'
import { MAX_GLOSS_LENGTH } from '@generators/crypticclue/hints'
import { reviewClues } from '@generators/crypticclue/review'
import { VerifiedClue, verifyClue } from '@generators/crypticclue/verify'
import { BatchRequest, requestBatch } from '@services/model-batch'
import { Candidate, CrypticClueData, Pack, Puzzle } from '@types'
import { log, logError } from '@utils/logging'

jest.mock('@services/model-batch')
jest.mock('@utils/logging')
// MOCKED, and the default is the identity. reviewClues makes the type's second Bedrock call, so an
// unmocked one reaches getPromptById and fails into its own catch -- which returns the input and
// would make every row here pass for the wrong reason. The rows that care about the review say so
// with mockResolvedValueOnce.
jest.mock('@generators/crypticclue/review')
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
  const mockReviewClues = jest.mocked(reviewClues)

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
    // The identity, which is also what the real reviewClues returns when the call fails. Rows that
    // exercise a drop or a fix override it per test.
    mockReviewClues.mockImplementation(async (clues) => clues)
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

    /*
     * THE DIAL, and it is the only thing that makes this type's second daily puzzle a different
     * puzzle rather than a second copy of the first.
     *
     * hidden -> 3, anagram -> 4, and the ordering is the repo's own argument made before the dial
     * existed. CLAUDE.md, ranking hint rungs: "a letter reveal is a mild hint on an anagram and the
     * entire solve on a hidden word, where the answer is a literal substring of the clue and position
     * plus enumeration is a lookup." A hidden answer sits in the surface in order and is READ OFF
     * once the indicator is spotted; an anagram hands over the letters and withholds the order.
     *
     * ONE BAND EACH, ASSERTED AS toStrictEqual RATHER THAN toContain. A candidate usable at both
     * bands is one the selection loop can spend anywhere, and a run of sixteen hidden clues would
     * then fill band 4 with a lookup -- this type shipping the same puzzle twice under two labels,
     * which is the failure the dial exists to prevent and the failure a `toContain` would pass over.
     */
    it.each([
      ['hidden', 3],
      ['anagram', 4],
    ])('bands a %s clue at difficulty %i and nothing else', async (device, difficulty) => {
      const raw =
        device === 'anagram'
          ? clue({ clue: 'Dance shaken got an', device: 'anagram', fodder: 'got an', indicator: 'shaken' })
          : clue()

      const kept = await fetch(2, [], [raw])

      expect(kept[0].usableAt).toStrictEqual([difficulty])
    })

    // The band reaches estimatedSeconds through the contribution's own base and step, so the second
    // puzzle is longer on the shelf as well as harder in the hand: 60 + 30 * 3.
    it('estimates the anagram band at 150 seconds', async () => {
      const kept = await fetch(
        2,
        [],
        [clue({ clue: 'Dance shaken got an', device: 'anagram', fodder: 'got an', indicator: 'shaken' })],
      )

      expect((await kept[0].build('2026-10-02', 4, () => 'abcd1234')).estimatedSeconds).toEqual(150)
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
        glossed: 0,
        kept: 1,
        rejections: {},
        returned: 1,
        reviewDropped: 0,
        type: 'crypticclue',
        verified: 1,
      })
      expect(logError).not.toHaveBeenCalled()
    })

    // `verified` counts what the DECOMPOSITION accepted and `kept` counts what SHIPS, and
    // `reviewDropped` is what names the review's share of the gap. It is NOT the only thing that can
    // open one: requestBatch dedupes on the normalized answer AFTER `accept` returns, so two clues
    // for the same word separate the two figures with `reviewDropped: 0`, and did so before this
    // reviewer existed. An operator reading a `verified > kept` gap has two candidate causes and this
    // field is how they tell which.
    it('reports a reviewer drop as its own funnel figure, not as a rejection', async () => {
      mockReviewClues.mockResolvedValueOnce([])

      const kept = await fetch(1, [], [clue()])

      expect(kept).toStrictEqual([])
      expect(log).toHaveBeenCalledWith(
        'Fetched cryptic clues',
        expect.objectContaining({ kept: 0, rejections: {}, reviewDropped: 1, verified: 1 }),
      )
    })

    it('hands the reviewer the verified clues rather than the built candidates', async () => {
      await fetch(1, [], [clue()])

      expect(mockReviewClues).toHaveBeenCalledWith([
        expect.objectContaining({ answer: 'TANGO', clue: 'Dance hidden in instant angora' }),
      ])
    })

    // THE GLOSS THE REVIEWER READS IS THE GLOSS THE PLAYER WOULD HAVE SEEN, which is what the gate
    // moving into `accept` buys. Before it moved, review.ts sent the RAW model string to a second
    // Bedrock call under a prompt calling it "the first hint the player is shown" -- so a gloss the
    // gates had already dropped still arrived looking shippable, and a reviewer judging a rung
    // nobody will ever see has no reason to return the `fix` that would restore one. It was also the
    // only field on VerifiedClue reaching a model with no length bound.
    //
    // ONE ROW PER GATE, because a gate that quietly stops firing is invisible to a row that only
    // exercises the common case, and these four are the whole of gatedGloss.
    //
    // THE REASON IS ASSERTED, NOT JUST THE ABSENCE, and that is what makes "one row per gate" a
    // pinned property rather than a comment: `toBeUndefined` alone passes for any gloss the gate
    // rejects for any reason, so a gate that stopped firing would still pass its row on another
    // gate's rejection. The first two rows SHARE `gloss-gate` -- the length cap and the answer-leak
    // row both live inside one passesStringGates call -- which is the arithmetic behind gatedGloss'
    // "four gates in three checks", and is exactly why the row names cannot be trusted to the
    // fixtures alone.
    it.each([
      ['runs past the length cap', 'x'.repeat(MAX_GLOSS_LENGTH + 1), 'gloss-gate'],
      ['names the answer', 'A tango is danced in pairs.', 'gloss-gate'],
      ['carries an inflection of the answer', 'Couples tangoed all night.', 'gloss-inflection'],
      ['restates the definition', 'A dance for two, done in step.', 'gloss-restates-definition'],
    ])('hands the reviewer no gloss at all when the gloss %s', async (_case, gloss, reason) => {
      await fetch(1, [], [clue({ gloss })])

      expect(mockReviewClues.mock.calls[0][0][0].gloss).toBeUndefined()
      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'TANGO',
        reason,
        source: 'generator',
        type: 'crypticclue',
      })
    })

    it('hands the reviewer a gloss that passes its gates, unchanged', async () => {
      await fetch(1, [], [clue({ gloss: 'Danced in pairs, and it takes two.' })])

      expect(mockReviewClues.mock.calls[0][0][0].gloss).toEqual('Danced in pairs, and it takes two.')
    })

    // THE GATE NOW RUNS TWICE on this path -- once in `accept`, once inside buildHints -- and the
    // second call MUST stay, because buildHints is the only entry point to a ladder and a builder
    // that trusts its caller ships an ungated rung the day someone adds a second caller. It is free
    // rather than merely cheap: a dropped gloss arrives at the second call as `undefined` and
    // returns above every drop(). Measured here rather than asserted in a comment, because the
    // alternative someone reaches for on seeing a doubled line is a `quiet` flag threaded through a
    // pure gate.
    it('logs a dropped gloss exactly once, however many times the gate runs', async () => {
      await fetch(1, [], [clue({ gloss: 'A dance for two, done in step.' })])

      expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
        answer: 'TANGO',
        reason: 'gloss-restates-definition',
        source: 'generator',
        type: 'crypticclue',
      })
      expect(jest.mocked(log).mock.calls.filter(([message]) => message === 'Dropped a cryptic gloss')).toHaveLength(1)
    })

    // THE ROW THAT WOULD CATCH A STALE LADDER. `build` closes over the VerifiedClue it was made
    // from, so a reviewer-replaced gloss that does not go back through toCandidate ships a ladder
    // composed from the ORIGINAL gloss -- a puzzle whose first hint is the sentence the reviewer
    // rejected, with nothing anywhere to show it happened.
    it('rebuilds the ladder when the reviewer replaces a gloss', async () => {
      const withGloss = (gloss: string): VerifiedClue => ({
        ...(verifyClue(clue({ gloss: 'A stately ballroom step.' }), shortlist(), () => true) as VerifiedClue),
        gloss,
      })
      mockReviewClues.mockResolvedValueOnce([withGloss('Danced in pairs, and it takes two.')])

      const [candidate] = await fetch(1, [], [clue({ gloss: 'A stately ballroom step.' })])
      const puzzle = await candidate.build('2026-10-02', 3, () => 'abcd1234')

      expect(puzzle.data.hints[0].text).toEqual('Danced in pairs, and it takes two.')
    })

    // THE TRANSITION THE MOVED GATE MAKES REACHABLE, and the reason the move is worth making rather
    // than only worth noting: `undefined -> string`. A dropped gloss now reaches the reviewer absent
    // instead of disguised as shippable, so a `fix` CREATES the type's only semantic rung rather
    // than replacing one -- and the rebuild guard needs no new arm for it, since a candidate built
    // with no gloss and a clue returned with one differ under the VALUE comparison exactly as a
    // replacement does. Without the rebuild this ships the backfilled ladder and the fix is lost
    // silently.
    it('creates the rung when the reviewer fixes a gloss that was dropped', async () => {
      const dropped = clue({ gloss: 'A dance for two, done in step.' })
      const fixed: VerifiedClue = {
        ...(verifyClue(dropped, shortlist(), () => true) as VerifiedClue),
        gloss: 'It takes two, and the floor is the whole point.',
      }
      mockReviewClues.mockResolvedValueOnce([fixed])

      const [candidate] = await fetch(1, [], [dropped])
      const puzzle = await candidate.build('2026-10-02', 3, () => 'abcd1234')

      expect(puzzle.data.hints[0].text).toEqual('It takes two, and the floor is the whole point.')
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
    // counterpart in the verifier at all, and the definition and fodder rungs quote slices of this
    // string.
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

    // The fixture clue is `Dance hidden in instant angora`: it says `hidden in`, so the device rung
    // is a restatement, and its definition is one word already on screen. BOTH conditional rungs
    // drop and the ladder is three facts the player did not have. hints.test.ts owns the rule; this
    // row is the one that proves the generator ships what the rule produces.
    it('ships two rungs rather than padding, none of them restating the clue', async () => {
      const { hints } = (await built()).data

      expect(hints.map((hint) => hint.text)).toStrictEqual([
        'The wordplay works on "instant angora".',
        'The answer begins with T.',
      ])
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
