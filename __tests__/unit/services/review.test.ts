import Ajv from 'ajv'

import { phrase, phrases, prompt, verdicts } from '../__mocks__'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { reviewPhrases, reviewTool } from '@services/review'
import { log, logError } from '@utils/logging'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('review', () => {
  const respond = (payload: Record<string, unknown>): void => {
    jest.mocked(invokeModel).mockResolvedValueOnce(payload as never)
  }

  beforeAll(() => {
    jest.mocked(getPromptById).mockResolvedValue(prompt as never)
    jest.mocked(invokeModel).mockResolvedValue({ verdicts } as never)
  })

  describe('reviewTool', () => {
    // What this schema may and may not contain is asserted in tool-schemas.test.ts, over every tool
    // in the repo at once, along with the per-element malformations it now lets through. What was
    // asserted here -- `required: ['index', 'verdict']`, an untyped familiarity, an untyped index --
    // described constraints that no longer exist: every one of them failed the WHOLE review over one
    // bad verdict. Their behavior moved to indexVerdicts, below.
    //
    // Run against the REAL schema through ajv, exactly as bedrock.ts does, because a verdict shape
    // the tests further down feed straight to applyVerdicts says nothing about whether that shape
    // survives validation to reach it.
    describe('ajv validation', () => {
      const validate = new Ajv().compile(reviewTool.input_schema)

      const payload = (verdict: unknown): Record<string, unknown> => ({ verdicts: [verdict] })

      it.each([
        ['a null familiarity, which is how a model answers "omit it on a drop"', { familiarity: null }],
        ['a fractional familiarity', { familiarity: 3.5 }],
        ['a familiarity sent as a string', { familiarity: '4' }],
        ['an out-of-range familiarity', { familiarity: 9 }],
        ['a fractional index', { index: 0.5 }],
        ['an index sent as a string', { index: '0' }],
        ['no index', { index: undefined }],
        ['an unrecognized verdict word', { verdict: 'maybe' }],
      ])('accepts a review containing %s so the other verdicts survive', (_description, overrides) => {
        expect(validate(payload({ index: 0, reason: 'Fine.', verdict: 'keep', ...overrides }))).toBe(true)
      })

      it('accepts a verdict with no reason', () => {
        expect(validate(payload({ familiarity: 4, index: 0, verdict: 'keep' }))).toBe(true)
      })

      it('accepts replacement hints that are not three strings', () => {
        expect(validate(payload({ hints: [{ text: 'a rung' }, 2], index: 0, verdict: 'fix' }))).toBe(true)
      })

      // The one surviving gate, and it is at the top level: with no verdicts key there is no batch
      // to iterate and nothing left for a per-verdict filter to do.
      it('still rejects a review with no verdicts key at all', () => {
        expect(validate({})).toBe(false)
      })
    })
  })

  describe('reviewPhrases', () => {
    // The verdict WORD, checked in indexVerdicts because the schema stopped checking it. Without
    // that guard an unrecognized or non-string verdict falls through applyVerdicts' if-chain into a
    // silent keep -- a reviewer's `drop` arriving as `"DROP"` would quietly ship the phrase.
    it.each([
      ['an unrecognized verdict word', 'maybe'],
      ['a non-string verdict', 5],
    ])('ignores %s rather than falling through to a silent keep', async (_description, verdict) => {
      // familiarity 5, and it is the whole of what makes the rating below discriminating. On a
      // verdict carrying no familiarity both outcomes land on 3 -- ignored gives the unjudged
      // default, admitted gives toFamiliarity(undefined) -- so the assertion read the same with the
      // guard removed and only the log line above was holding the test up. A 5 the phrase must NOT
      // have is the difference between the verdict being ignored and being applied.
      respond({ verdicts: [{ familiarity: 5, index: 0, reason: 'Drifted.', verdict }] })

      const reviewed = await reviewPhrases([phrase])

      expect(log).toHaveBeenCalledWith('Ignored an unusable verdict', { index: 0, verdict })
      expect(reviewed[0].familiarity).toEqual(3)
    })

    // A null element now reaches the loop, which is why indexVerdicts reads `verdict?.index`.
    it('ignores a null verdict rather than throwing the review away', async () => {
      respond({ verdicts: [null, { familiarity: 5, index: 0, reason: 'Universal.', verdict: 'keep' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 5 }])
      expect(log).toHaveBeenCalledWith('Ignored an unusable verdict', { index: undefined, verdict: undefined })
    })

    it('spends no model call on an empty batch', async () => {
      expect(await reviewPhrases([])).toEqual([])

      expect(invokeModel).not.toHaveBeenCalled()
    })

    it('fetches the review prompt by its configured id', async () => {
      await reviewPhrases([phrase])

      expect(getPromptById).toHaveBeenCalledWith('review-phrases')
    })

    // The reviewer sees the phrases and NOTHING else -- not the inspiration words, not the
    // used-phrase list. Narrow context is what keeps a reviewer from re-deriving the generator's
    // reasoning instead of judging its output.
    it('hands the model the phrases indexed by array position and nothing else', async () => {
      await reviewPhrases([phrase])

      expect(invokeModel).toHaveBeenCalledWith(prompt, reviewTool, {
        phrases: [{ category: phrase.category, hints: phrase.hints, index: 0, shape: phrase.shape, text: phrase.text }],
      })
    })

    // The number the whole phrase pipeline turns on, and nothing used to log it. Cryptogram's
    // derived difficulty is dominated by familiarity, so a batch rated 4 and 5 across the board
    // cannot fill its hardest band -- and the only signal that reached CloudWatch was "No usable
    // phrase for this difficulty", which says a band starved without saying the pool was the wrong
    // shape. Every band is present so an EMPTY one shows as a zero rather than as an absent key.
    it('logs how many kept phrases landed on each rating', async () => {
      respond({
        verdicts: [
          { familiarity: 5, index: 0, reason: 'Universal.', verdict: 'keep' },
          { familiarity: 5, index: 1, reason: 'Universal.', verdict: 'keep' },
          { familiarity: 2, index: 2, reason: 'Hard but fair.', verdict: 'keep' },
        ],
      })

      await reviewPhrases(phrases.slice(0, 3))

      expect(log).toHaveBeenCalledWith(
        'Reviewed phrases',
        expect.objectContaining({ familiarity: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 2 } }),
      )
    })

    it('keeps a phrase and takes the reviewer rating', async () => {
      respond({ verdicts: [{ familiarity: 5, index: 0, reason: 'Universal.', verdict: 'keep' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 5 }])
    })

    it('removes a dropped phrase', async () => {
      respond({
        verdicts: [
          { index: 0, reason: 'Nobody knows it.', verdict: 'drop' },
          { familiarity: 3, index: 1, reason: 'Fine.', verdict: 'keep' },
        ],
      })

      const reviewed = await reviewPhrases(phrases.slice(0, 2))

      expect(reviewed.map((entry) => entry.text)).toEqual([phrases[1].text])
    })

    it('applies a fix whose replacements pass re-gating', async () => {
      const hints: [string, string, string] = [
        'A famous sequel',
        'The heroes lose this one',
        'A revelation about parentage in a duel',
      ]
      respond({
        verdicts: [{ category: 'Cinema', familiarity: 4, hints, index: 0, reason: 'Ladder was flat.', verdict: 'fix' }],
      })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, category: 'Cinema', familiarity: 4, hints }])
    })

    // A category-only fix has to be re-gated against the ORIGINAL hints. passesProseGates requires
    // a three-rung ladder, so re-gating the replacement on its own would fail every such fix.
    it('re-gates a category-only fix against the original hints', async () => {
      respond({ verdicts: [{ category: 'Cinema', familiarity: 4, index: 0, reason: 'Too narrow.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, category: 'Cinema', familiarity: 4 }])
    })

    // The mirror image: a hints-only fix is re-gated against the ORIGINAL category, which
    // passesProseGates requires to be non-empty.
    it('re-gates a hints-only fix against the original category', async () => {
      const hints: [string, string, string] = [
        'A famous sequel',
        'The heroes lose this one',
        'A revelation about parentage in a duel',
      ]
      respond({ verdicts: [{ familiarity: 4, hints, index: 0, reason: 'Ladder was flat.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 4, hints }])
    })

    // A reviewer that correctly spots a weak ladder and writes a bad replacement would otherwise
    // cost more than one that stayed silent.
    it('keeps the original when a fix fails re-gating', async () => {
      respond({ verdicts: [{ familiarity: 4, hints: ['too few'], index: 0, reason: 'Rewrote it.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 4 }])
    })

    it('treats a fix with neither replacement field as a keep', async () => {
      respond({ verdicts: [{ familiarity: 2, index: 0, reason: 'Meant to change something.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 2 }])
    })

    it.each([
      ['absent', undefined],
      ['out of range', 0],
      ['not an integer', 3.5],
    ])('defaults a %s familiarity to 3', async (_description, familiarity) => {
      respond({ verdicts: [{ familiarity, index: 0, reason: 'Fine.', verdict: 'keep' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 3 }])
    })

    it.each([
      ['out of range', 9],
      ['negative', -1],
      ['not an integer', 0.5],
    ])('ignores a verdict with an %s index', async (_description, index) => {
      respond({ verdicts: [{ familiarity: 5, index, reason: 'Nowhere.', verdict: 'drop' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 3 }])
    })

    it('lets the first verdict win when an index is judged twice', async () => {
      respond({
        verdicts: [
          { familiarity: 5, index: 0, reason: 'Keep it.', verdict: 'keep' },
          { index: 0, reason: 'Actually drop it.', verdict: 'drop' },
        ],
      })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 5 }])
    })

    // An omission is a reviewer failure, not a phrase failure.
    it('keeps a phrase the reviewer returned no verdict for', async () => {
      respond({ verdicts: [] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 3 }])
    })

    // Far more likely a malfunction than ten genuinely unrecognizable phrases.
    it('returns the input unchanged and raises an alarm when every phrase is dropped', async () => {
      respond({ verdicts: [{ index: 0, reason: 'No.', verdict: 'drop' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 3 }])
      expect(logError).toHaveBeenCalledWith(
        'Reviewer dropped every phrase; keeping the batch unreviewed',
        expect.objectContaining({ count: 1 }),
      )
    })

    it('logs batchNotes without letting them touch a phrase', async () => {
      respond({
        batchNotes: 'Three of six are titles.',
        verdicts: [{ familiarity: 4, index: 0, reason: 'Fine.', verdict: 'keep' }],
      })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 4 }])
    })

    // Decision 7: a short pack beats no pack, and shipping unreviewed player-visible prose is worth
    // an alarm. The handler gets no signal distinguishing this from "reviewed and kept everything".
    it('ships the batch unreviewed when the model call throws', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('bedrock on fire'))

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, familiarity: 3 }])
      expect(logError).toHaveBeenCalledWith(
        'Could not review phrases; shipping the batch unreviewed',
        expect.objectContaining({ error: expect.any(Error) }),
      )
    })
  })
})
