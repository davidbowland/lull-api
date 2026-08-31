import { worstCasePuzzle as worstCaseCrypticClue } from '@generators/crypticclue/worst-case'
import { worstCasePuzzle as worstCaseCryptogram } from '@generators/cryptogram/worst-case'
import { worstCasePuzzle as worstCaseGoFigure } from '@generators/gofigure/worst-case'
import { allContributions } from '@generators/index'
import { worstCasePuzzle as worstCaseMissingVowels } from '@generators/missingvowels/worst-case'
import { worstCasePuzzle as worstCasePhrazle } from '@generators/phrazle/worst-case'
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
  crypticclue: worstCaseCrypticClue,
  cryptogram: worstCaseCryptogram,
  gofigure: worstCaseGoFigure,
  missingvowels: worstCaseMissingVowels,
  phrazle: worstCasePhrazle,
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
  // Themed Anagrams adds 3,100 bytes for three puzzles -- 1,033 / 1,033 / 1,034 -- and it is now the
  // ONE TYPE OVER ITS ROW, by 34 bytes against the 1,000 the count table budgeted. Recorded rather
  // than absorbed: a type that quietly exceeds its row is how a count table stops being a budget.
  //
  // THE CAUSE IS THE RESHUFFLE LIST, and it is shape rather than count. An entry carries up to
  // SCRAMBLES_PER_ENTRY arrangements instead of one, so the worst case pays for four 9-letter strings
  // per entry where it used to pay for one. The figures either side of that change were measured, not
  // estimated: 2,632 before and 3,100 after, +468 for the three puzzles, which is the whole of the
  // pack total's move below.
  //
  // (The previous revision of this comment said 2,635 while its own per-puzzle figures read
  // 877 / 877 / 878, which sum to 2,632. The total was the wrong one of the two -- re-measured here.)
  //
  // THE RUNG LINE IS STILL THE LARGEST COMPONENT and the entries line did NOT overtake it, which is
  // worth writing down because it is the obvious thing to assume once a field quadruples. Measured on
  // the band-4 worst case: hints 508 B, entries 341 B, theme 42 B. Quadrupling the entries closed the
  // gap from 4.5x to 1.5x and did not cross it -- the rung line is three copies of a 23-character
  // `kind` string plus two short fields, which is what an earlier estimate of this type's size missed
  // by 15%. Its 80-character rung cap, rather than the 200 sized for model prose, is what keeps the
  // overage at 34 bytes instead of 272 -- at 200 the same puzzle is 1,394 bytes.
  //
  // Cryptic Clue adds 744 bytes for its one puzzle, against the 750-byte row it declares. Derived
  // rather than estimated, and every part of it is a constant in that type's own code: a
  // 120-character clue, an eight-letter answer, two spans of two integers, and the heaviest of the
  // EIGHT ladders its hint pool can emit -- enumerated in crypticclue/worst-case.ts, which is where
  // that arithmetic belongs. The type carries NO metadata on any rung, which is what keeps it the
  // smallest row in the table despite the longest single string.
  //
  // SIX BYTES OF HEADROOM, and that is a statement about this row rather than a boast. It was 687
  // before the gloss and the row was never tight; an 80-character model-written rung is most of what
  // is left. THE NEXT RUNG THIS TYPE ADDS DOES NOT FIT, and the branch that adds one has to move the
  // row deliberately rather than discover it here -- which is what this figure is for.
  //
  // 677 at the original ladder and 695 at an intermediate commit, and the second was WRONG rather
  // than merely different: it filled the definition rung and the fodder rung to the same per-rung
  // cap, and those two quote DISJOINT SPANS OF ONE 120-CHARACTER CLUE. A per-rung cap cannot bound
  // an array whose members share a budget. It measured 817 and blew this row by 67 bytes for a shape
  // the verifier cannot emit, which is the failure mode a ceiling exists to catch and did.
  //
  // Phrazle adds 1,656 bytes for two puzzles -- 828 each, against the 1,030-byte row the count table
  // published as an ESTIMATE, so this type comes in UNDER its budget and the estimate resolves
  // downward. Its 80-character rung cap rather than the 200 sized for model prose is what does it: at
  // 200 the same puzzle is 1,188 bytes and does NOT fit its row. The metadata is what an earlier
  // estimate of this type missed -- three copies of a 21-character `kind` string plus three short
  // fields -- and is the only thing above Missing Vowels' shape.
  //
  // THE PACK IS COMPLETE AT SIX TYPES, so this figure is a measurement rather than a partial
  // measurement plus a projection. The projection was 8,799 + 6 x 1,454 = ~17,523 B; the real pack
  // measures 16,530 B, which is 6% under it and 2.5x inside the 40KB ceiling. Both comments that
  // quoted the projection -- MAX_DAYS in scripts/audit-hints.ts and the Scan page-size arithmetic in
  // services/dynamodb.ts -- were re-read against it, and neither number moves: a pack still under
  // the projection cannot break a bound derived from it.
  //
  // 13,799 before the cryptic hint pool and 13,810 after it; 13,867 once the gloss rung landed;
  // 13,837 once Phrazle's guess limit came off the wire.
  //
  // 16,530 SINCE THE 2026-08-26 BAND RESHUFFLE, which is +2,693 B for THREE puzzles: Phrazle and
  // Missing Vowels each went from two a day to three, and Cryptic Clue from one to two. That is the
  // largest single jump this figure has taken and it is entirely COUNT rather than shape -- no cap
  // moved, no rung grew -- so it is the row to re-read when a type is next added rather than evidence
  // of anything drifting. The headroom fell from 2.96x to 2.5x and the 40KB ceiling is still the
  // binding number, with the pack-duration ceiling in generators/index.test.ts now the tighter of the
  // two at 99.4% spent.
  //
  // 16,998 SINCE THE ANAGRAM RESHUFFLE LIST, which is +468 B and entirely SHAPE rather than count --
  // the exact inverse of the jump above it. No type was added and no count moved; one type's entries
  // went from carrying one arrangement to carrying up to four. Headroom falls from 2.5x to 2.41x and
  // the 40KB ceiling still is not the binding number.
  //
  // 17,007 SINCE THE PHRAZLE FLOOR WIDENED, which is +9 B and is SHAPE again rather than count. The
  // structural floor went from 2-3 words of 3-7 letters to 2-6 of 2-11, so worst-case.ts's widest
  // hint indices moved with it -- word 2 -> 5 and position 6 -> 10 -- and a two-digit position costs
  // one byte in each of three rungs across three puzzles. The answer field did not move: it is
  // bounded by MAX_TEXT_LENGTH at 80, which is a services/phrases.ts gate and not a floor clause.
  // Nine bytes for a board that can now hold KNOCK YOUR SOCKS OFF.
  it('measures a worst-case pack at 17,007 bytes today', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toEqual(17_007)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason. This type had no row of its own until the
  // reshuffle list took it past the 1,000 the count table budgeted -- which is exactly the moment one
  // is worth having, and the reason the restated 1,050 is written down here rather than absorbed.
  //
  // 16 BYTES OF HEADROOM, deliberately tight, and a statement about this row rather than a boast: A
  // FIFTH SCRAMBLE DOES NOT FIT. It costs 12 bytes an entry -- nine letters, two quotes, a comma --
  // across all four entries, so the same puzzle measures 1,082. SCRAMBLES_PER_ENTRY therefore cannot
  // move without moving this number in the same commit, which is the whole job of a per-type row.
  it('keeps one worst-case themed anagrams puzzle inside the 1,050-byte row it now declares', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseThemedAnagrams(4)), 'utf8')).toBeLessThanOrEqual(1_050)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason.
  it('keeps one worst-case phrazle inside the 1,030-byte row it declares', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePhrazle(5)), 'utf8')).toBeLessThanOrEqual(1_030)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason.
  it('keeps one worst-case cryptic clue inside the 750-byte row it declares', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseCrypticClue(3)), 'utf8')).toBeLessThanOrEqual(750)
  })
})
