import { MAX_LENGTH as LEXICON_FILTER_MAX_LENGTH } from '../../../scripts/build-cryptic-words'
import { LEXICON_MAX_WORD_LENGTH, worstCasePuzzle as worstCaseCrypticClue } from '@generators/crypticclue/worst-case'
import { worstCasePuzzle as worstCaseCryptogram } from '@generators/cryptogram/worst-case'
import { worstCasePuzzle as worstCaseGoFigure } from '@generators/gofigure/worst-case'
import { allContributions } from '@generators/index'
import { worstCasePuzzle as worstCaseMissingVowels } from '@generators/missingvowels/worst-case'
import { worstCasePuzzle as worstCasePhrazle } from '@generators/phrazle/worst-case'
import { worstCasePuzzle as worstCaseThemedAnagrams } from '@generators/themedanagrams/worst-case'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'

// A type's worst case is a function of caps in that type's own code and PackContribution carries
// no shape information, so a new type is registered HERE. The first assertion names the omission;
// without it a missing builder surfaces as a TypeError naming neither the type nor the gap.
const WORST_CASE_BUILDERS: Partial<Record<PuzzleType, (difficulty: Difficulty) => Puzzle>> = {
  crypticclue: worstCaseCrypticClue,
  cryptogram: worstCaseCryptogram,
  gofigure: worstCaseGoFigure,
  missingvowels: worstCaseMissingVowels,
  phrazle: worstCasePhrazle,
  themedanagrams: worstCaseThemedAnagrams,
}

describe('pack size', () => {
  // toStrictEqual, never toEqual: equals([undefined], []) is true under @jest/expect-utils, and
  // [undefined] is exactly what a `.map` over a missing entry produces.
  it('has a worst case declared for every registered type', () => {
    const undeclared = allContributions
      .filter((contribution) => WORST_CASE_BUILDERS[contribution.type] === undefined)
      .map((contribution) => contribution.type)

    expect(undeclared).toStrictEqual([])
  })

  // Built the way isComplete counts a pack: countPerDay puzzles per type, one per declared
  // difficulty, so the size moves when the count table moves as well as when a type's fields grow.
  const worstCasePack = (): Pack => ({
    complete: true,
    date: '2026-08-20',
    puzzles: allContributions.flatMap((contribution) =>
      contribution.difficulties.map((difficulty) => WORST_CASE_BUILDERS[contribution.type]!(difficulty)),
    ),
  })

  // A capacity ceiling with real dependents (MAX_DAYS, PHRASE_HISTORY_DAYS, the Scan page size),
  // so it does not move down when a pack shrinks. Bytes, not characters: Buffer.byteLength on the
  // UTF-8 encoding, since goFigure's rung glyphs are multi-byte and `.length` under-counts them.
  it('keeps a full pack of worst-case puzzles inside 40KB', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toBeLessThanOrEqual(40 * 1024)
  })

  // 12,345 B is measured by running this suite over all six registered types (sixteen puzzles).
  // The ceiling above carries 3.32x of headroom and cannot notice a type doubling; this notices
  // any change at all. It is also the input to MAX_DAYS in scripts/audit-hints.ts and to the Scan
  // page-size arithmetic in services/dynamodb.ts, which no code links -- re-read both when it moves.
  it('measures a worst-case pack at 12,345 bytes today', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toEqual(12_345)
  })

  // A per-type tripwire with no dependents, so the branch that grows a cap reads its own number
  // rather than a pack total that moved for another reason. 550 is derived from the one
  // multiplier left on the shape: across SCRAMBLES_PER_ENTRY, four measures 517, five 565 and six
  // 613, so the next bump reddens this row. The headroom absorbs MAX_WORD_LENGTH 9 -> 10 (537)
  // and stops at 11 (557).
  it('keeps one worst-case themed anagrams puzzle inside the 550-byte scramble tripwire', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseThemedAnagrams(4)), 'utf8')).toBeLessThanOrEqual(550)
  })

  // A per-type tripwire, measured at 326. This type ships no ladder, and the realistic way the row
  // grows again is a rung coming back: one rung at the 80-character cap plus its wrapper is over 90
  // bytes, so any restored ladder reddens this at 400 while 74 bytes of headroom absorb a cap nudge.
  it('keeps one worst-case phrazle inside the 400-byte ladder tripwire', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePhrazle(5)), 'utf8')).toBeLessThanOrEqual(400)
  })

  // A per-type tripwire, measured at 640 on both bands -- the only band-dependent field is
  // estimatedSeconds, and 120 and 180 are both three digits. 700 is set against the lever that
  // moves this shape: MAX_EXPLANATION_LENGTH is worth two bytes a character, measured at 110
  // (660), 130 (700) and 150 (740).
  it('keeps one worst-case cryptic clue inside the 700-byte row it declares', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseCrypticClue(3)), 'utf8')).toBeLessThanOrEqual(700)
    expect(Buffer.byteLength(JSON.stringify(worstCaseCrypticClue(5)), 'utf8')).toBeLessThanOrEqual(700)
  })

  // The one bound in crypticclue/worst-case.ts that is a hand copy: its definition rung is
  // 21 + 4 x 12 + 3 = 72 bytes wide because the lexicon holds no word over twelve letters, and
  // that filter lives in scripts/build-cryptic-words.ts, which worst-case.ts restates rather than
  // imports. Pinned here because this is the file it is load-bearing for -- raise MAX_LENGTH to
  // fifteen and the row above measures 652 with nothing to say so.
  it('measures the definition against the word length the lexicon was built with', () => {
    expect(LEXICON_MAX_WORD_LENGTH).toEqual(LEXICON_FILTER_MAX_LENGTH)
  })
})
