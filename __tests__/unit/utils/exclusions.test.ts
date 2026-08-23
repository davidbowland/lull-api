import { phraseGenerators } from '@generators/index'
import { Pack, Puzzle } from '@types'
import { MAX_EXCLUDED_PHRASES, PHRASE_CORPUS_TYPES, recentAnswersOfTypes } from '@utils/exclusions'

jest.mock('@utils/logging')

// Built rather than written as literals. A control character pasted into a source file is invisible
// in a diff and in a review, and this repo's own sweep for them uses a byte-level scan because the
// shell's grep skips any file containing a NUL outright.
const NUL = String.fromCharCode(0x00)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

describe('exclusions', () => {
  const puzzleOf = (type: string, answer: unknown): Puzzle =>
    ({ data: { answer }, difficulty: 1, estimatedSeconds: 60, id: `x:${type}:y`, type }) as Puzzle

  const packOf = (date: string, ...puzzles: Puzzle[]): Pack => ({ complete: true, date, puzzles })

  describe('type narrowing', () => {
    it('reads the answers of the declared types', () => {
      const packs = [
        packOf(
          '2026-08-20',
          puzzleOf('cryptogram', 'Bite the bullet'),
          puzzleOf('missingvowels', 'Pride and Prejudice'),
        ),
      ]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual(['Bite the bullet', 'Pride and Prejudice'])
    })

    // goFigure has no `answer` and would have dropped out of the old blind filter anyway. This
    // asserts the NARROWING rather than the accident: it contributes nothing because it is not in
    // the set, not because its data happens to lack a field.
    it('contributes nothing from a type outside the set, even when it has an answer', () => {
      const packs = [packOf('2026-08-20', puzzleOf('gofigure', 'a goFigure with an answer field'))]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual([])
    })

    it('contributes nothing from a type this deploy has never heard of', () => {
      const packs = [packOf('2026-08-20', puzzleOf('crypticclue', 'SIDE'))]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual([])
    })

    it.each([
      ['a missing answer', undefined],
      ['a non-string answer', 5],
    ])('drops %s', (_description, answer) => {
      expect(
        recentAnswersOfTypes([packOf('2026-08-20', puzzleOf('cryptogram', answer))], PHRASE_CORPUS_TYPES),
      ).toStrictEqual([])
    })

    it('drops null data', () => {
      const puzzle = { data: null, difficulty: 1, estimatedSeconds: 60, id: 'a', type: 'cryptogram' } as Puzzle

      expect(recentAnswersOfTypes([packOf('2026-08-20', puzzle)], PHRASE_CORPUS_TYPES)).toStrictEqual([])
    })
  })

  describe('re-gating on read', () => {
    // Gates change; stored packs do not, and the only thing that would rewrite one is a manual
    // runbook. A pack written by an older deploy passed an OLDER gate set and re-enters tonight's
    // prompt otherwise ungated.
    it.each([
      ['a control code, which no gate caught on the write side of an older deploy', `Bite${NUL}the bullet`],
      ['a right-to-left override', `Bite the bullet${RIGHT_TO_LEFT_OVERRIDE}`],
      ['a charset violation, so an ampersand cannot reach the context slot', 'Salt & Pepper'],
      ['a digit, which is not typeable', 'Catch 22'],
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s', (_description, answer) => {
      expect(
        recentAnswersOfTypes([packOf('2026-08-20', puzzleOf('cryptogram', answer))], PHRASE_CORPUS_TYPES),
      ).toStrictEqual([])
    })

    // REJECTED, never truncated. The same list builds excludedKeys in services/phrases.ts, and
    // truncating an entry changes its normalizeAnswer key -- so the model would be shown a phrase
    // not to reuse while the code stopped recognizing it.
    it('rejects an over-length entry rather than truncating it', () => {
      const long = 'a'.repeat(81)

      expect(
        recentAnswersOfTypes([packOf('2026-08-20', puzzleOf('cryptogram', long))], PHRASE_CORPUS_TYPES),
      ).toStrictEqual([])
    })

    it('keeps an entry sitting exactly on the length cap', () => {
      const atCap = 'a'.repeat(80)

      expect(
        recentAnswersOfTypes([packOf('2026-08-20', puzzleOf('cryptogram', atCap))], PHRASE_CORPUS_TYPES),
      ).toStrictEqual([atCap])
    })

    // G5 is NOT run, and this is the case that proves it. Every entry in this list IS an answer, so
    // leaksAnswerTokens(answer, answer) is true for anything of four characters or more -- running
    // it here would hand the model an empty exclusion list every night, which is the silent
    // poisoning this whole reader exists to prevent, arriving through the fix for it.
    it('does not reject an entry for containing itself', () => {
      const packs = [packOf('2026-08-20', puzzleOf('cryptogram', 'The Empire Strikes Back'))]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual(['The Empire Strikes Back'])
    })
  })

  describe('bounds', () => {
    it('is a hard slice at the declared bound, not a target', () => {
      const many = Array.from({ length: MAX_EXCLUDED_PHRASES + 50 }, (_, index) =>
        puzzleOf('cryptogram', `Phrase number ${'a'.repeat(index % 20)}`),
      )

      expect(recentAnswersOfTypes([packOf('2026-08-20', ...many)], PHRASE_CORPUS_TYPES)).toHaveLength(
        MAX_EXCLUDED_PHRASES,
      )
    })

    it('declares 200, derived from 20 packs x 6 phrase puzzles at 1.67x', () => {
      expect(MAX_EXCLUDED_PHRASES).toStrictEqual(200)
    })

    // The slice runs AFTER the gate, and nothing held that ordering. Slicing first spends the window
    // on entries that are about to be rejected, so a run whose newest entries are all gate failures
    // -- an older deploy's charset, which is exactly what the re-gate exists for -- returns fewer
    // exclusions than the bound, or none at all, and the model is free to repeat what it just wrote.
    it('counts the bound against entries that passed the gate, not against rejects', () => {
      const packs = [
        packOf(
          '2026-08-20',
          puzzleOf('cryptogram', 'Salt & Pepper'),
          puzzleOf('cryptogram', 'Catch 22'),
          puzzleOf('cryptogram', 'Bite the bullet'),
        ),
      ]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES, 1)).toStrictEqual(['Bite the bullet'])
    })

    it('takes a tighter bound from the caller', () => {
      const packs = [packOf('2026-08-20', puzzleOf('cryptogram', 'Bite the bullet'), puzzleOf('cryptogram', 'Jaws'))]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES, 1)).toStrictEqual(['Bite the bullet'])
    })

    // Newest first, so a hard slice keeps the most recent window rather than whatever order
    // BatchGetItem happened to return. getRecentPacks reads response.Responses directly and DynamoDB
    // does not preserve request order, so the sort here is what makes the bound deterministic.
    it('returns the newest packs first, whatever order the read came back in', () => {
      const packs = [
        packOf('2026-08-10', puzzleOf('cryptogram', 'Older')),
        packOf('2026-08-20', puzzleOf('cryptogram', 'Newer')),
      ]

      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual(['Newer', 'Older'])
    })

    // The bare { puzzles } shape a candidate fetcher can hand in, with no date at all. It must not
    // throw, and it sorts as the oldest thing present rather than jumping the window.
    //
    // BOTH ORDERINGS, because the comparator reads `date` off both sides and one arrangement only
    // ever exercises one of the two fallbacks -- the other stays an uncovered branch that a
    // `right.date.localeCompare(...)` regression would walk straight through.
    const dateless = { puzzles: [puzzleOf('cryptogram', 'Undated')] }
    const dated = packOf('2026-08-20', puzzleOf('cryptogram', 'Dated'))

    it.each([
      ['first', [dateless, dated]],
      ['second', [dated, dateless]],
    ])('accepts a dateless pack shape arriving %s', (_description, packs) => {
      expect(recentAnswersOfTypes(packs, PHRASE_CORPUS_TYPES)).toStrictEqual(['Dated', 'Undated'])
    })
  })

  describe('PHRASE_CORPUS_TYPES', () => {
    // Membership is NARROWER than "has an answer". A type whose answer is an ordinary single English
    // word stays out: a list titled "phrases not to reuse" containing SIDE bans that word from three
    // other types for twenty nights.
    it('holds exactly the types drawing on the shared phrase corpus', () => {
      expect([...PHRASE_CORPUS_TYPES].sort()).toStrictEqual(['cryptogram', 'missingvowels'])
    })

    // The assertion above restates its own literal, so the set was linked to NOTHING: the day
    // Phrazle registers as a phrase generator, its answers drop out of the exclusion list silently
    // and every model-backed type may repeat them for twenty nights with nothing logging. This is
    // the link -- a type that draws from the shared pool is a type whose answers must not be reused.
    //
    // The registry is the source and the set is the copy, which is why the registry is the left-hand
    // side. Anything joining phraseGenerators without joining the set reddens this.
    it('is kept in step with the generators that draw from the shared pool', () => {
      expect(phraseGenerators.map((generator) => generator.type).sort()).toStrictEqual([...PHRASE_CORPUS_TYPES].sort())
    })
  })
})
