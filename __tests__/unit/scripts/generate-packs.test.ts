import { formatSummary, toRerun } from '../../../scripts/generate-packs'
import { RunSummary } from '@services/local-generation'

// The script's imports reach DynamoDB and the claude backend; formatting needs neither.
jest.mock('@services/claude-cli')
jest.mock('@services/local-generation', () => ({
  describeResult: jest.requireActual('@services/local-generation').describeResult,
}))

describe('generate-packs', () => {
  describe('formatSummary', () => {
    it('prints one block per date, with have/want for a short result', () => {
      const summary: RunSummary = {
        aborted: false,
        dates: [
          {
            chains: {
              crypticclue: { status: 'short', have: 1, want: 3 },
              cryptogram: { status: 'complete' },
              phrases: { status: 'skipped' },
              themedanagrams: { status: 'failed' },
            },
            date: '2026-10-05',
            selfContained: { status: 'complete' },
          },
          {
            chains: {
              crypticclue: { status: 'aborted' },
              cryptogram: { status: 'aborted' },
              phrases: { status: 'aborted' },
              themedanagrams: { status: 'aborted' },
            },
            date: '2026-10-06',
            selfContained: { status: 'aborted' },
          },
        ],
      }

      expect(formatSummary(summary)).toEqual([
        '',
        '2026-10-05',
        '  self-contained  complete',
        '  crypticclue     short (1/3)',
        '  cryptogram      complete',
        '  phrases         skipped',
        '  themedanagrams  failed',
        '',
        '2026-10-06',
        '  self-contained  aborted',
        '  crypticclue     aborted',
        '  cryptogram      aborted',
        '  phrases         aborted',
        '  themedanagrams  aborted',
      ])
    })

    it('prints nothing when no date started', () => {
      expect(formatSummary({ aborted: true, dates: [] })).toEqual([])
    })
  })

  describe('toRerun', () => {
    it('lists unfinished and unstarted dates, leaving out finished ones', () => {
      const done = { status: 'complete' } as const
      const summary: RunSummary = {
        aborted: true,
        dates: [
          {
            chains: { crypticclue: done, cryptogram: done, phrases: { status: 'skipped' }, themedanagrams: done },
            date: '2026-10-04',
            selfContained: done,
          },
          {
            chains: {
              crypticclue: { status: 'aborted' },
              cryptogram: done,
              phrases: done,
              themedanagrams: done,
            },
            date: '2026-10-05',
            selfContained: done,
          },
        ],
      }

      expect(toRerun(['2026-10-04', '2026-10-05', '2026-10-06'], summary)).toEqual(['2026-10-05', '2026-10-06'])
    })
  })
})
