import { worstCasePuzzle as worstCaseCryptogram } from '@generators/cryptogram/worst-case'
import { worstCasePuzzle as worstCaseGoFigure } from '@generators/gofigure/worst-case'
import { allContributions } from '@generators/index'
import { worstCasePuzzle as worstCaseMissingVowels } from '@generators/missingvowels/worst-case'
import { worstCasePuzzle as worstCaseThemedAnagrams } from '@generators/themedanagrams/worst-case'
import { Difficulty, Pack, Puzzle, PuzzleType } from '@types'

// A type's worst case is a function of caps that live in that type's own code, so the registry
// cannot produce this and never will -- PackContribution carries no shape information. A new type is
// registered HERE.
//
// What the first assertion below buys is a NAMED failure, and that is a smaller claim than the one
// the plan makes for it. The plan says an undeclared type would otherwise be "silently costed at
// zero"; measured by deleting goFigure's entry, it is not silent -- the non-null assertion in
// worstCasePack turns a missing builder into `WORST_CASE_BUILDERS[...] is not a function`, which
// reddens the two size assertions with a TypeError that names neither the type nor the omission.
// The kept assertion says `undeclared: ["gofigure"]` instead, and says it before the pack is built,
// so the branch that forgot reads its own mistake rather than a stack trace. Costed at zero is what
// would happen under a `?? 0` or a filtered flatMap, and this file deliberately has neither.
const WORST_CASE_BUILDERS: Partial<Record<PuzzleType, (difficulty: Difficulty) => Puzzle>> = {
  cryptogram: worstCaseCryptogram,
  gofigure: worstCaseGoFigure,
  missingvowels: worstCaseMissingVowels,
  themedanagrams: worstCaseThemedAnagrams,
}

describe('pack size', () => {
  // toStrictEqual, never toEqual. Measured against this repo's own @jest/expect-utils,
  // equals([undefined], []) is TRUE -- so `expect(undeclared).toEqual([])` passes over a list holding
  // an undefined, which is the shape a `.map` over a missing entry produces and exactly the defect
  // this assertion exists to catch.
  it('has a worst case declared for every registered type', () => {
    const undeclared = allContributions
      .filter((contribution) => WORST_CASE_BUILDERS[contribution.type] === undefined)
      .map((contribution) => contribution.type)

    expect(undeclared).toStrictEqual([])
  })

  // Built the way isComplete counts a pack: countPerDay puzzles per type, one per declared
  // difficulty. The size therefore moves when the COUNT TABLE moves, not only when a type's fields
  // grow -- which is the point, since both are ways a pack gets bigger.
  const worstCasePack = (): Pack => ({
    complete: true,
    date: '2026-08-20',
    puzzles: allContributions.flatMap((contribution) =>
      contribution.difficulties.map((difficulty) => WORST_CASE_BUILDERS[contribution.type]!(difficulty)),
    ),
  })

  // 40KB. Every figure here was MEASURED by running this suite, never copied from a plan, and the
  // plan's were low: it priced goFigure at ~1,100 B and each phrase type at ~1,010 B, against
  // measured rows of 1,453 / 1,074 / 1,117 B a puzzle. Today's three types come to 8,799 bytes --
  // goFigure 4,361, Missing Vowels 2,234, Cryptogram 2,148, plus a 56-byte envelope -- so the
  // ceiling carries 4.66x.
  //
  // Sized against the SIX-type pack, not this one, which is why the multiple looks generous. Pricing
  // the three unbuilt types at the largest row measured here gives 8,799 + 6 x 1,454 = ~17,523 B for
  // a thirteen-puzzle pack, and 40KB is 2.34x THAT. A ceiling each incoming branch has to fit under
  // without anyone re-deriving it is a ceiling; one re-derived per branch is a running total.
  //
  // A ceiling is not a target. Its job is to fail when a TYPE grows past what the count table priced,
  // not to track the pack down as it shrinks -- so it does not move when a pack gets smaller, and
  // the day it fails is the day MAX_DAYS and PHRASE_HISTORY_DAYS genuinely need restating, because a
  // size budget whose dependents drift is a size budget that has stopped meaning anything.
  //
  // Bytes, not characters: Buffer.byteLength on the UTF-8 encoding, which is what DynamoDB charges
  // for. goFigure's rung glyphs are multi-byte and `.length` would under-count them.
  it('keeps a full pack of worst-case puzzles inside 40KB', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toBeLessThanOrEqual(40 * 1024)
  })

  // The measured figure, pinned, so the ceiling above is never the only thing watching. A ceiling
  // with 4.66x of headroom cannot notice a type doubling; this notices any change at all, and moves
  // deliberately, in the commit that caused it. It is also the input to MAX_DAYS in
  // scripts/audit-hints.ts and to the Scan page-size arithmetic in services/dynamodb.ts, neither of
  // which any code links to this number -- so when this assertion moves, both comments are re-read
  // in the same commit.
  // Themed Anagrams adds 2,635 bytes for three puzzles -- 877 / 877 / 878, against the 1,000-byte
  // row the count table budgets it. The largest of the four components is the RUNG line, not the
  // entries: three copies of a 23-character `kind` string plus two short fields, which is what an
  // earlier estimate of this type's size missed by 15%. Its 80-character rung cap, rather than the
  // 200 sized for model prose, is what keeps it inside its row -- at 200 the same puzzle is 1,238
  // bytes and does not fit.
  it('measures a worst-case pack at 11,434 bytes today', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toEqual(11_434)
  })
})
