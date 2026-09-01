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
  // measured rows of 1,453 / 1,117 / 1,074 B a puzzle back when three types existed. The registry is
  // complete at six now and the pack measures 12,649 B, so the ceiling carries 3.24x.
  //
  // Sized against the SIX-type pack from the beginning, which is why the multiple looked so generous
  // while three of the six were unbuilt: pricing them at the largest row then measured gave
  // 8,799 + 6 x 1,454 = ~17,523 B for a THIRTEEN-puzzle pack, which is what a complete pack was
  // under the count table of the day (gofigure 3, cryptogram 2, missingvowels 2, phrazle 2,
  // themedanagrams 3, crypticclue 1). The real thirteen-puzzle pack topped out at 13,837 B, 21%
  // under the projection.
  //
  // A COMPLETE PACK IS SIXTEEN PUZZLES NOW, not thirteen, and the count is read off the
  // contributions rather than remembered: gofigure 3, phrazle 3, cryptogram 2, missingvowels 3,
  // themedanagrams 3, crypticclue 2. The 2026-08-26 band reshuffle added the other three. That
  // sixteen-puzzle pack peaked at 17,007 B -- 3% under the same projection, which is the coincidence
  // worth naming so nobody reads it as the thirteen-puzzle figure -- and has since come DOWN rather
  // than up, because three types took their hint ladders off the wire entirely. A ceiling each
  // incoming branch has to fit under without anyone re-deriving it is a ceiling; one re-derived per
  // branch is a running total.
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
  // with 3.24x of headroom cannot notice a type doubling; this notices any change at all, and moves
  // deliberately, in the commit that caused it. It is also the input to MAX_DAYS in
  // scripts/audit-hints.ts and to the Scan page-size arithmetic in services/dynamodb.ts, neither of
  // which any code links to this number -- so when this assertion moves, both comments are re-read
  // in the same commit.
  // Themed Anagrams adds 1,549 bytes for three puzzles -- 516 / 516 / 517 -- and it is back INSIDE
  // the 1,000 the count table budgeted, with room to spare. It was the one type over its row, by 34
  // bytes at 1,033 / 1,033 / 1,034, which is why it has a per-type assertion of its own further down.
  //
  // THE RUNG LINE IS GONE, and it was the largest component: hints 508 B against entries 341 B and
  // theme 42 B on the band-4 worst case. This type stopped shipping a ladder at all -- it picked its
  // three target entries by answer length at generate time, so a player who had already solved the
  // longest entry still had the whole-answer reveal spent on it -- and the rungs are chosen on the
  // device now. THE ENTRIES ARE THE LARGEST FIELD, uncontested, which reverses the finding the
  // previous revision of this comment recorded and is worth stating in those words: the reshuffle
  // list closed the gap from 4.5x to 1.5x without crossing it, and removing the rungs crossed it.
  //
  // THE RESHUFFLE LIST IS STILL IN THE FIGURE, and it is shape rather than count. An entry carries up
  // to SCRAMBLES_PER_ENTRY arrangements instead of one, so the worst case pays for four 9-letter
  // strings per entry where it used to pay for one: 2,632 for the three puzzles before that change
  // and 3,100 after, +468. That +468 survives; what came off on top of it is the ladder.
  //
  // (An earlier revision said 2,635 while its own per-puzzle figures read 877 / 877 / 878, which sum
  // to 2,632. The total was the wrong one of the two -- re-measured then, and again here.)
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
  // Phrazle adds 978 bytes for three puzzles -- 326 each, against the 1,030-byte row the count table
  // published as an ESTIMATE. It is the SMALLEST ROW IN THE TABLE now and by a wide margin: what is
  // left of the shape is a phrase and a category, because this type's ladder came off the wire too.
  // It measured 831 with the ladder (three capped rungs plus three copies of a 21-character `kind`
  // string and its three short fields), and 1,191 at the 200-character cap sized for model prose,
  // which is the shape that would NOT have fit its row.
  //
  // 831 AND 1,191, RE-MEASURED, and the pair this file used to print -- 828 and 1,188 -- was three
  // bytes low in both places. Those two were measured when phrazle/worst-case.ts's WIDEST_WORD and
  // WIDEST_POSITION were 2 and 6; the structural floor widened to six words of eleven letters, both
  // moved to 5 and 10, and a two-digit `"position"` costs one byte in each of three rungs. The
  // figures were carried forward across that change rather than re-taken, in the file whose whole
  // discipline is that a byte number is derived and not remembered. RE-DERIVED by rebuilding the
  // pre-removal shape from git and running Buffer.byteLength over its JSON, at both caps and both
  // index pairs: 831 / 828 at the 80-cap, 1,191 / 1,188 at the 200-cap. 831 - 326 = 505 is the
  // per-puzzle drop, and it is the term that makes the -4,358 below add up.
  //
  // Cryptogram adds 856 bytes for two puzzles -- 428 each, down from 1,074 -- and its drop is the
  // largest of the three PER PUZZLE, at 646 against phrazle's 505 and themed anagrams' 517, because
  // the rungs it shipped were model prose capped at MAX_HINT_LENGTH rather than at 80. Three rungs
  // of 200 characters were more than the answer, the ciphertext and the category put together.
  //
  // PER TYPE TOTAL IT IS THE SMALLEST OF THE THREE, and the two readings have to be kept apart: this
  // type ships TWO a day against three for the other two, so the totals are cryptogram 1,292,
  // phrazle 1,515 and themed anagrams 1,551. Largest per puzzle, smallest per type.
  //
  // THE PACK IS COMPLETE AT SIX TYPES, so this figure is a measurement rather than a partial
  // measurement plus a projection. The projection was 8,799 + 6 x 1,454 = ~17,523 B; the real pack
  // peaked at 17,007 B, 3% under it, and now measures 12,649 B -- 4,358 bytes below the peak and
  // 3.24x inside the 40KB ceiling. Both comments that quote a pack size -- MAX_DAYS in
  // scripts/audit-hints.ts and the Scan page-size arithmetic in services/dynamodb.ts -- are re-read
  // whenever this assertion moves, and both moved WITH it this time: they were still quoting 13,799,
  // which had been stale since the band reshuffle, and each now quotes the figure below.
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
  //
  // 12,649 SINCE THREE TYPES TOOK THEIR HINTS OFF THE WIRE, which is -4,358 B and is the LARGEST
  // MOVE THIS FIGURE HAS EVER MADE, in either direction, and the first one downward that was not a
  // single field. Cryptogram, Phrazle and Themed Anagrams stopped shipping `hints` at all: their
  // hints are letter-shaped, chosen against a board the generator cannot see, and computed on the
  // device from the vendored builders in src/rules/. Per puzzle it
  // is cryptogram 1,074 -> 428, phrazle 831 -> 326, themed anagrams 1,034 -> 517, and 646 x 2 +
  // 505 x 3 + 517 x 3 is exactly the 4,358 above. Cryptogram's drop is the biggest PER PUZZLE
  // because its rungs were model prose at MAX_HINT_LENGTH (200) rather than at the 80 the two
  // code-built ladders used; per TYPE it is the smallest of the three, because it ships two a day
  // where the others ship three.
  //
  // A SHRINKING PACK BREAKS NO BOUND, which is why nothing downstream moves except the two comments
  // that quote the number for arithmetic. Every dependent bound -- the 40KB ceiling, MAX_DAYS,
  // PHRASE_HISTORY_DAYS, the Scan page size -- is derived from a LARGER pack than this one.
  it('measures a worst-case pack at 12,649 bytes today', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePack()), 'utf8')).toEqual(12_649)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason. This type had no row of its own until the
  // reshuffle list took it past the 1,000 the count table budgeted -- which is exactly the moment one
  // is worth having, and the reason the restated 1,050 was written down rather than absorbed.
  //
  // IT WAS 1,050 AND IT IS NOW 550, and the reason for moving it is that the previous revision of
  // this comment argued itself out of a job. It conceded, in its own words, that "the tripwire that
  // remains is SCRAMBLES_PER_ENTRY, and it no longer trips here" -- 517 measured against 1,050
  // leaves 533 bytes of headroom, and a fifth scramble lands at 565, which fits four times over. A
  // tripwire that states it cannot trip is not a conservative tripwire, it is dead weight, and the
  // argument it leaned on (a per-type row must never track the shape down, like the pack ceiling
  // above) does not carry: the pack ceiling is a CAPACITY bound with real dependents -- MAX_DAYS,
  // PHRASE_HISTORY_DAYS, the Scan page size -- and lowering it would falsify their derivations. This
  // row has no dependents. Its only job is to redden when this type grows, and 1,050 stopped doing
  // that.
  //
  // 550 IS DERIVED FROM THE ONE MULTIPLIER LEFT ON THE SHAPE. Measured across SCRAMBLES_PER_ENTRY:
  // four 517, five 565, six 613 -- 48 bytes a scramble, four 9-letter entries at a time. 550 sits
  // between four and five, so the next bump to that constant reddens this row and the branch that
  // makes it reads its own number, which is the whole point of a per-type assertion. The 33 bytes of
  // headroom also absorb MAX_WORD_LENGTH going 9 -> 10 (537) and stop at 11 (557), which is the
  // right sensitivity for the second multiplier on the same field.
  //
  // 1,050 IS STILL WHAT THE COUNT TABLE PRICED, and that number has not moved -- it is carried by
  // the 40KB pack ceiling above, which is where a capacity claim belongs. This row is a tripwire,
  // not the budget.
  it('keeps one worst-case themed anagrams puzzle inside the 550-byte scramble tripwire', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseThemedAnagrams(4)), 'utf8')).toBeLessThanOrEqual(550)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason.
  //
  // IT WAS 1,030 AND IT IS NOW 400, for the reason given on the row above: 326 measured against
  // 1,030 is a tripwire nothing could trip. This type is down to a phrase and a category, so the
  // only two caps left on it are MAX_TEXT_LENGTH (80) and MAX_CATEGORY_LENGTH (120), and 1,030 would
  // not notice either of them tripling.
  //
  // 400 IS SET AGAINST THE REGRESSION THIS TYPE ACTUALLY HAS. Its ladder came off the wire twice
  // over -- the shared prose one it never used, then three code-built positional reveals -- and the
  // realistic way this row grows again is a rung coming back. One rung at the 80-character cap plus
  // its wrapper is over 90 bytes, so any restored ladder reddens this at 400 while the 74 bytes of
  // headroom absorb a cap nudge that is genuinely just a cap nudge. 1,030 remains the number the
  // count table published for this type; it is carried by the pack ceiling, not by this row.
  it('keeps one worst-case phrazle inside the 400-byte ladder tripwire', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCasePhrazle(5)), 'utf8')).toBeLessThanOrEqual(400)
  })

  // The per-type row, asserted on its own so the branch that grows a cap reads its own number rather
  // than a pack total that moved for some other reason.
  it('keeps one worst-case cryptic clue inside the 750-byte row it declares', () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseCrypticClue(3)), 'utf8')).toBeLessThanOrEqual(750)
  })
})
