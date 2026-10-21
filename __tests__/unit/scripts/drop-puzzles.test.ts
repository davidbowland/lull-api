import { dropFromPack, parseRequest, servedDates } from '../../../scripts/drop-puzzles'
import { Pack, Puzzle, PuzzleType } from '@types'

// The script's imports reach DynamoDB; the pure halves need none of it.
jest.mock('@services/dynamodb')

const puzzle = (type: PuzzleType, difficulty: number): Puzzle =>
  ({ data: { theme: `${type} ${difficulty}` }, difficulty, id: `2026-10-26:${type}:${difficulty}`, type }) as Puzzle

const pack: Pack = {
  complete: true,
  date: '2026-10-26',
  puzzles: [
    puzzle('gofigure', 1),
    puzzle('themedanagrams', 1),
    puzzle('themedanagrams', 3),
    puzzle('themedanagrams', 4),
    puzzle('cryptogram', 2),
  ],
}

describe('drop-puzzles', () => {
  describe('parseRequest', () => {
    it('reads the type, difficulties, dates and flags', () => {
      expect(
        parseRequest([
          '--type',
          'themedanagrams',
          '--difficulty',
          '4',
          '--difficulty',
          '3',
          '2026-10-26..2026-10-27',
          '--apply',
        ]),
      ).toStrictEqual({
        allowServed: false,
        apply: true,
        dates: ['2026-10-26', '2026-10-27'],
        difficulties: [4, 3],
        type: 'themedanagrams',
      })
    })

    // A dry run is the default, so a forgotten flag can only fail to write.
    it('defaults to a dry run over every difficulty', () => {
      expect(parseRequest(['--type', 'cryptogram', '2026-10-26'])).toMatchObject({ apply: false, difficulties: [] })
    })

    it.each([
      ['a missing type', ['2026-10-26'], '--type must be one of'],
      ['an unknown type', ['--type', 'anagrams', '2026-10-26'], '--type must be one of'],
      ['a non-integer difficulty', ['--type', 'cryptogram', '--difficulty', 'hard', '2026-10-26'], 'integer'],
      ['no dates', ['--type', 'cryptogram'], 'No dates given'],
      ['an invalid date', ['--type', 'cryptogram', '2026-02-30'], 'Invalid date'],
    ])('rejects %s', (_name, args, message) => {
      expect(() => parseRequest(args)).toThrow(message)
    })
  })

  describe('servedDates', () => {
    const now = () => Date.parse('2026-10-20T12:00:00.000Z')

    // Tomorrow is the last date the API serves, so it is the last date a device can already hold.
    it('flags dates up to and including tomorrow', () => {
      expect(servedDates(['2026-10-19', '2026-10-21', '2026-10-22'], now)).toStrictEqual(['2026-10-19', '2026-10-21'])
    })
  })

  describe('dropFromPack', () => {
    it('drops only the named difficulties of the named type', () => {
      const { dropped, pack: result } = dropFromPack(pack, { difficulties: [4], type: 'themedanagrams' })

      expect(dropped.map((entry) => entry.id)).toStrictEqual(['2026-10-26:themedanagrams:4'])
      expect(result.puzzles.map((entry) => entry.id)).toStrictEqual([
        '2026-10-26:gofigure:1',
        '2026-10-26:themedanagrams:1',
        '2026-10-26:themedanagrams:3',
        '2026-10-26:cryptogram:2',
      ])
    })

    it('drops every difficulty when none is named', () => {
      const { pack: result } = dropFromPack(pack, { difficulties: [], type: 'themedanagrams' })

      expect(result.puzzles.map((entry) => entry.type)).toStrictEqual(['gofigure', 'cryptogram'])
    })

    // A pack left complete: true would never be refetched by a client, and that flag is recomputed
    // rather than cleared so it is right by the same rule the builders use.
    it('marks the pack incomplete once a puzzle it owes is gone', () => {
      expect(dropFromPack(pack, { difficulties: [4], type: 'themedanagrams' }).pack.complete).toBe(false)
    })

    it('leaves the stored pack untouched', () => {
      dropFromPack(pack, { difficulties: [], type: 'themedanagrams' })

      expect(pack.puzzles).toHaveLength(5)
    })
  })
})
