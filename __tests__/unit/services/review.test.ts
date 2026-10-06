import Ajv from 'ajv'

import { phrase, phrases, prompt, verdicts } from '../__mocks__'
import { invokeModel } from '@services/bedrock'
import { getPromptById } from '@services/dynamodb'
import { reviewPhrases, reviewTool } from '@services/review'
import { log, logError, logWarning } from '@utils/logging'

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
    // tool-schemas.test.ts asserts what the schema may contain. These rows are the consequence: a
    // per-element constraint would fail the WHOLE review over one bad verdict, so the checks live
    // in indexVerdicts below. Run through ajv exactly as bedrock.ts does, because a verdict fed
    // straight to applyVerdicts says nothing about whether that shape survives validation.
    describe('ajv validation', () => {
      const validate = new Ajv().compile(reviewTool.input_schema)

      const payload = (verdict: unknown): Record<string, unknown> => ({ verdicts: [verdict] })

      it.each([
        ['a fractional index', { index: 0.5 }],
        ['an index sent as a string', { index: '0' }],
        ['no index', { index: undefined }],
        ['an unrecognized verdict word', { verdict: 'maybe' }],
      ])('accepts a review containing %s so the other verdicts survive', (_description, overrides) => {
        expect(validate(payload({ index: 0, reason: 'Fine.', verdict: 'keep', ...overrides }))).toBe(true)
      })

      it('accepts a verdict with no reason', () => {
        expect(validate(payload({ index: 0, verdict: 'keep' }))).toBe(true)
      })

      it('accepts replacement hints that are not three strings', () => {
        expect(validate(payload({ hints: [{ text: 'a rung' }, 2], index: 0, verdict: 'fix' }))).toBe(true)
      })

      // The one surviving gate: with no verdicts key there is no batch to iterate.
      it('still rejects a review with no verdicts key at all', () => {
        expect(validate({})).toBe(false)
      })
    })
  })

  describe('reviewPhrases', () => {
    // The verdict WORD, checked in indexVerdicts because the schema no longer does: without that
    // guard an unrecognized verdict falls through applyVerdicts' if-chain into a silent keep.
    it.each([
      ['an unrecognized verdict word', 'maybe'],
      ['a non-string verdict', 5],
    ])('ignores %s rather than falling through to a silent keep', async (_description, verdict) => {
      respond({ verdicts: [{ index: 0, reason: 'Drifted.', verdict }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
      expect(log).toHaveBeenCalledWith('Ignored an unusable verdict', { index: 0, verdict })
      // The fall-through keep would not count the phrase as unjudged; the guard does.
      expect(log).toHaveBeenCalledWith('Kept phrases the reviewer returned no verdict for', { count: 1 })
    })

    // A null element now reaches the loop, which is why indexVerdicts reads `verdict?.index`.
    it('ignores a null verdict rather than throwing the review away', async () => {
      respond({ verdicts: [null, { index: 0, reason: 'Universal.', verdict: 'keep' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
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

    // The reviewer sees the phrases and nothing else, so it judges the output rather than
    // re-deriving the generator's reasoning from its inputs.
    it('hands the model the phrases indexed by array position and nothing else', async () => {
      await reviewPhrases([phrase])

      expect(invokeModel).toHaveBeenCalledWith(prompt, reviewTool, {
        phrases: [{ category: phrase.category, hints: phrase.hints, index: 0, shape: phrase.shape, text: phrase.text }],
      })
    })

    it('logs how many phrases it kept and dropped', async () => {
      respond({
        verdicts: [
          { index: 0, reason: 'Universal.', verdict: 'keep' },
          { index: 1, reason: 'Universal.', verdict: 'keep' },
          { index: 2, reason: 'Nobody knows it.', verdict: 'drop' },
        ],
      })

      await reviewPhrases(phrases.slice(0, 3))

      expect(log).toHaveBeenCalledWith('Reviewed phrases', { dropped: 1, kept: 2 })
    })

    it('keeps a phrase unchanged', async () => {
      respond({ verdicts: [{ index: 0, reason: 'Universal.', verdict: 'keep' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it('removes a dropped phrase', async () => {
      respond({
        verdicts: [
          { index: 0, reason: 'Nobody knows it.', verdict: 'drop' },
          { index: 1, reason: 'Fine.', verdict: 'keep' },
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
        verdicts: [{ category: 'Cinema', hints, index: 0, reason: 'Ladder was flat.', verdict: 'fix' }],
      })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, category: 'Cinema', hints }])
    })

    // Re-gated against the ORIGINAL hints: passesProseGates requires a three-rung ladder, so
    // re-gating the replacement alone would fail every category-only fix.
    it('re-gates a category-only fix against the original hints', async () => {
      respond({ verdicts: [{ category: 'Cinema', index: 0, reason: 'Too narrow.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, category: 'Cinema' }])
    })

    // The mirror image: re-gated against the ORIGINAL category, which must be non-empty.
    it('re-gates a hints-only fix against the original category', async () => {
      const hints: [string, string, string] = [
        'A famous sequel',
        'The heroes lose this one',
        'A revelation about parentage in a duel',
      ]
      respond({ verdicts: [{ hints, index: 0, reason: 'Ladder was flat.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([{ ...phrase, hints }])
    })

    // A bad replacement must not cost more than a reviewer that stayed silent.
    it('keeps the original when a fix fails re-gating', async () => {
      respond({ verdicts: [{ hints: ['too few'], index: 0, reason: 'Rewrote it.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it('treats a fix with neither replacement field as a keep', async () => {
      respond({ verdicts: [{ index: 0, reason: 'Meant to change something.', verdict: 'fix' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it.each([
      ['out of range', 9],
      ['negative', -1],
      ['not an integer', 0.5],
    ])('ignores a verdict with an %s index', async (_description, index) => {
      respond({ verdicts: [{ index, reason: 'Nowhere.', verdict: 'drop' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it('lets the first verdict win when an index is judged twice', async () => {
      respond({
        verdicts: [
          { index: 0, reason: 'Keep it.', verdict: 'keep' },
          { index: 0, reason: 'Actually drop it.', verdict: 'drop' },
        ],
      })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it('keeps a phrase the reviewer returned no verdict for', async () => {
      respond({ verdicts: [] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    it('returns the input unchanged and raises an alarm when every phrase is dropped', async () => {
      respond({ verdicts: [{ index: 0, reason: 'No.', verdict: 'drop' }] })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
      expect(logError).toHaveBeenCalledWith(
        'Reviewer dropped every phrase; keeping the batch unreviewed',
        expect.objectContaining({ count: 1 }),
      )
    })

    it('logs batchNotes without letting them touch a phrase', async () => {
      respond({
        batchNotes: 'Three of six are titles.',
        verdicts: [{ index: 0, reason: 'Fine.', verdict: 'keep' }],
      })

      expect(await reviewPhrases([phrase])).toEqual([phrase])
    })

    // A short pack beats no pack, but unreviewed player-visible prose is worth an alarm: the
    // handler gets no signal distinguishing this from "reviewed and kept everything".
    it('ships the batch unreviewed when the model call throws', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(new Error('bedrock on fire'))

      expect(await reviewPhrases([phrase])).toEqual([phrase])
      expect(logError).toHaveBeenCalledWith(
        'Could not review phrases; shipping the batch unreviewed',
        expect.objectContaining({ error: expect.any(Error) }),
      )
    })

    // The same degrade at WARN when the reviewer was unreachable: every gate in
    // utils/phrase-checks.ts has run, so a 503 here is the designed fallback rather than a fault.
    it('warns rather than alarming when the reviewer is unavailable', async () => {
      jest.mocked(invokeModel).mockRejectedValueOnce(
        Object.assign(new Error('Bedrock is unable to process your request'), {
          $fault: 'server',
          $metadata: { attempts: 4, httpStatusCode: 503 },
        }),
      )

      expect(await reviewPhrases([phrase])).toEqual([phrase])
      expect(logWarning).toHaveBeenCalledWith(
        'Could not review phrases; shipping the batch unreviewed',
        expect.objectContaining({ error: expect.any(Error) }),
      )
      expect(logError).not.toHaveBeenCalled()
    })
  })
})
