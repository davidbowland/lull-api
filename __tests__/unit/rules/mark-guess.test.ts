import { markGuess } from '@rules/mark-guess'

// Deliberately a SECOND implementation of the letter counter, written from the definition rather
// than imported from mark-guess.ts. An invariant checked with the code under test's own counter
// cannot catch a bug in that counter, and this is the assertion the whole one-ledger design exists
// to make.
const countLettersInTest = (letters: string): Record<string, number> =>
  [...letters].reduce<Record<string, number>>(
    (counts, letter) => ({ ...counts, [letter]: (counts[letter] ?? 0) + 1 }),
    {},
  )

// The mandated fixture table, written BEFORE the implementation, per the catalog's own instruction:
// marking is "the one real implementation hazard in this project... write the tests first."
//
// ROW 1 IS THE CORRECTED CATALOG EXAMPLE. The catalog publishes HOT's H as Purple against answer
// TOE HOLD. That phrase has exactly one H, HAND's green H spends it, and the multi-pass rule stated
// eight lines below the table leaves the purple pass nothing to draw from. That tile is GRAY.
// Anyone building this fixture from the published table would enshrine the bug in the test that was
// supposed to catch it.
describe('markGuess', () => {
  it('marks the corrected TOE HOLD / HOT HAND board', () => {
    expect(markGuess(['HOT', 'HAND'], ['TOE', 'HOLD'])).toStrictEqual([
      ['gray', 'green', 'yellow'],
      ['green', 'gray', 'gray', 'green'],
    ])
  })

  // Three E's in the phrase, three colored E tiles, the fourth gray. Word 2's trailing E is the
  // tile that separates a ledger from a membership test.
  it('spends a repeated letter across words in reading order', () => {
    expect(markGuess(['NEE', 'TEE'], ['EEL', 'NET'])).toStrictEqual([
      ['purple', 'green', 'yellow'],
      ['yellow', 'green', 'gray'],
    ])
  })

  // Total surplus: six E's guessed, three in the answer, exactly three colored. Wordle's rule --
  // the copies that keep the color are the ones the passes reach first.
  it('colors exactly as many tiles as the answer has copies', () => {
    expect(markGuess(['EEE', 'EEE'], ['EEL', 'NET'])).toStrictEqual([
      ['green', 'green', 'gray'],
      ['gray', 'green', 'gray'],
    ])
  })

  // Repeated letters within one word, plus a cross-word D taken as YELLOW because it is in its own
  // answer word -- yellow reads remaining[w] and nothing else, so it never reaches pass 3.
  it('prefers a yellow in the tile own word over a purple elsewhere', () => {
    expect(markGuess(['PEEP', 'EDS'], ['DEEP', 'END'])).toStrictEqual([
      ['gray', 'green', 'green', 'green'],
      ['green', 'yellow', 'gray'],
    ])
  })

  // Purple across a word boundary in BOTH directions. Colored counts equal occurrences exactly for
  // all five letters.
  it('marks purple in both directions across a word boundary', () => {
    expect(markGuess(['CALL', 'COLD'], ['COLD', 'CALL'])).toStrictEqual([
      ['green', 'purple', 'green', 'purple'],
      ['green', 'purple', 'green', 'purple'],
    ])
  })

  // Yellow saturation: nine tiles, seven yellow, ZERO purple. Every letter the guess misplaces is
  // misplaced inside its own word. The purple coverage is carried by the rows above and below; this
  // row pins that purple does NOT fire when yellow can absorb the letter.
  it('does not reach the purple pass when yellow can absorb the letter', () => {
    expect(markGuess(['SALT', 'WARTS'], ['LAST', 'STRAW'])).toStrictEqual([
      ['yellow', 'green', 'yellow', 'green'],
      ['yellow', 'yellow', 'green', 'yellow', 'yellow'],
    ])
  })

  // Asserted rather than assumed. Pass 1 consumes every letter of every answer word, so the ledger
  // is empty when passes 2 and 3 run -- but "it is automatic" is the class of claim a refactor
  // falsifies.
  it('marks a fully correct guess all green', () => {
    expect(markGuess(['TOE', 'HOLD'], ['TOE', 'HOLD'])).toStrictEqual([
      ['green', 'green', 'green'],
      ['green', 'green', 'green', 'green'],
    ])
  })

  // Shape is isValidGuess's job, not this function's. Reaching here with the wrong shape is a
  // programming error, and a board built from mismatched lengths is a board that lies.
  it('throws when the word lengths do not correspond', () => {
    expect(() => markGuess(['STRAW', 'LAST'], ['LAST', 'STRAW'])).toThrow('Guess and answer do not have the same shape')
  })

  it('throws when the word counts differ', () => {
    expect(() => markGuess(['TOE'], ['TOE', 'HOLD'])).toThrow('Guess and answer do not have the same shape')
  })

  // TWO PURPLE TILES ON AN ANSWER WHOSE WORDS SHARE NO LETTER. Purple depends on the GUESS, not on
  // the answer's internal sharing, which is why the structural floor carries no cross-word-sharing
  // clause. This row goes red if anyone adds one, because BEAR HUG stops reaching a board at all.
  it('marks purple on an answer whose words share no letter', () => {
    expect(markGuess(['GRAB', 'HUE'], ['BEAR', 'HUG'])).toStrictEqual([
      ['purple', 'yellow', 'green', 'yellow'],
      ['green', 'green', 'purple'],
    ])
  })

  // THE PURPLE PASS'S LEDGER DEBIT, WHICH UNTIL THIS ROW WAS PINNED BY NOTHING. Delete
  // `remaining[donor][letter]--` from pass 3 and every other test in this file passed -- the
  // thirty-two it held then, and the twenty-one-pair invariant table below too. That is the single line
  // the whole one-ledger design comes down to, and the table simply never happened to contain a
  // board where two purple tiles want the same copy.
  //
  // EASE has two E's. TOE HOLD has one, and no green or yellow spends it, so exactly one of them
  // may be purple and the reading-order winner takes it. Without the debit both go purple: two
  // colored E tiles for the phrase's one E, which is the invariant broken and the lie the docstring
  // says a player can prove by counting.
  //
  // It pins the left-to-right tie-break in the same cell, and those two cannot be separated by any
  // board. Contention is what makes the order observable, and contention is exactly what makes the
  // debit observable -- a board with no two purples competing sees neither mutation. One row, both
  // properties, and that is a fact about the rule rather than a shortcut.
  //
  // The H is the complement of row 1's. Same guess word, same answer, and HOT's H is PURPLE here
  // because no HAND arrives to spend the phrase's only H with a green. Membership did not change;
  // the ledger did. That is the docstring's "purple is not implied by membership" read from the
  // other side.
  it('lets only one of two competing purples take the phrase last copy', () => {
    expect(markGuess(['HOT', 'EASE'], ['TOE', 'HOLD'])).toStrictEqual([
      ['purple', 'green', 'yellow'],
      ['purple', 'gray', 'gray', 'gray'],
    ])
  })

  // THE YELLOW PASS'S LEFT-TO-RIGHT SCAN, which was also pinned by nothing: reverse the inner loop
  // of pass 2 and every other test in the file passed, the thirty-two it held then. The docstring calls this order "arbitrary
  // and still written down" because two hand-copies drift on exactly this kind of tie-break, and
  // until now it was written down only in prose.
  //
  // EEL's two E's contend for TOE's one E with no green in sight, so the scan direction decides
  // which tile is yellow and which falls through to the purple pass. Reversed, the board reads
  // gray-yellow-purple instead. Nothing else on it moves, which is what makes the row a test of the
  // order rather than of the marking.
  it('gives a yellow to the earlier of two tiles that want the same copy', () => {
    expect(markGuess(['EEL', 'DEEP'], ['TOE', 'HOLD'])).toStrictEqual([
      ['yellow', 'gray', 'purple'],
      ['yellow', 'gray', 'gray', 'gray'],
    ])
  })

  // PASS 3'S WORD ORDER, WHICH NO TWO-WORD BOARD IN THIS FILE CAN REACH. Reverse the OUTER loop of
  // the purple pass -- words descending instead of ascending -- and every other test here passes,
  // all thirty-seven of them, plus the invariant table. The row above pins position order WITHIN a
  // word, which is a different tie-break: EASE's two E's are both in word 1.
  //
  // It is unpinnable with two words, and that is arithmetic rather than an oversight. Cross-word
  // purple contention needs a letter wanted by two words and held by a third, because a purple
  // never draws from its own word -- the lemma in the docstring -- so with two words the only
  // possible donor for word 0 is word 1 and vice versa, and the two can never contend. Three words
  // is the smallest board where the order is observable, and until this row every fixture and every
  // invariant pair in this file had two.
  //
  // THE OLD HAT holds one unspent O, in word 2. TOE's O and HOT's O both want it and neither can
  // take it from its own word. Ascending gives it to TOE and leaves HOT's O gray; descending gives
  // it to HOT and leaves TOE's O gray. Exactly one tile moves, between two words, which is the
  // property stated as narrowly as a board can state it.
  //
  // The docstring calls this order arbitrary and says it is written down anyway, because two
  // hand-copies drift on exactly this kind of unpinned tie-break. It was written down in prose and
  // in no test.
  it('gives the phrase last copy to the earlier WORD, not just the earlier position', () => {
    expect(markGuess(['TOE', 'EAT', 'HOT'], ['THE', 'OLD', 'HAT'])).toStrictEqual([
      ['green', 'purple', 'green'],
      ['gray', 'purple', 'gray'],
      ['green', 'gray', 'green'],
    ])
  })

  // THE WORD-MAJOR REJECTION, PINNED -- and pinned for the right reason. Green-and-yellow word-major
  // is not wrong, it is provably IDENTICAL: yellow reads and debits remaining[w] and nothing else,
  // so a word-0 yellow cannot take a letter word 1 needs for a green. What is actually wrong is
  // PURPLE BEFORE A LATER WORD'S GREEN, because purple reads the phrase-wide sum and can spend a
  // copy a later word's green is entitled to.
  //
  // These are row 1's inputs asserted as a COUNT rather than as a cell. A word-major implementation
  // still gets O, T, A, N and D right; what it gets wrong is printing HOT's purple H alongside
  // HAND's green H -- two colored tiles for the phrase's one H, which is the catalog's published
  // bug and the invariant broken, rather than a precedence table inverted.
  it('colors exactly one H tile, because TOE HOLD has exactly one H', () => {
    const guess = ['HOT', 'HAND']
    const board = markGuess(guess, ['TOE', 'HOLD'])
    const coloredH = board.flatMap((word, index) =>
      word.filter((tile, position) => guess[index][position] === 'H' && tile !== 'gray'),
    )

    expect(coloredH).toHaveLength(1)
  })
})

// The mandated invariant, which is the whole reason for one ledger. Looped over a COMMITTED table
// rather than generated: a random-guess property test passes today and fails tomorrow, which
// CLAUDE.md forbids outright, and a counterexample it found could not be reproduced from the file.
//
// Twenty-four pairs, covering duplicate letters inside one word, duplicate letters across words,
// total surplus, zero overlap, exact match, a full reversal, and every fixture board's inputs above.
// Every pair's word lengths CORRESPOND -- a mismatched pair throws at step 0 and would test the
// throw rather than the invariant.
//
// The last three are the purple-contention boards, and they are here because this table is the
// INDEPENDENT guard on the ledger debit -- it counts colored tiles per letter and never names a
// cell, so it catches a missing debit without knowing which tile was supposed to win. It could not
// catch it before because no pair in it had two purples wanting one copy.
const INVARIANT_PAIRS: [string[], string[]][] = [
  [
    ['HOT', 'HAND'],
    ['TOE', 'HOLD'],
  ],
  [
    ['NEE', 'TEE'],
    ['EEL', 'NET'],
  ],
  [
    ['EEE', 'EEE'],
    ['EEL', 'NET'],
  ],
  [
    ['PEEP', 'EDS'],
    ['DEEP', 'END'],
  ],
  [
    ['CALL', 'COLD'],
    ['COLD', 'CALL'],
  ],
  [
    ['SALT', 'WARTS'],
    ['LAST', 'STRAW'],
  ],
  [
    ['TOE', 'HOLD'],
    ['TOE', 'HOLD'],
  ],
  [
    ['GRAB', 'HUE'],
    ['BEAR', 'HUG'],
  ],
  [
    ['ZZZ', 'ZZZZ'],
    ['TOE', 'HOLD'],
  ],
  [
    ['LEE', 'TEN'],
    ['EEL', 'NET'],
  ],
  [
    ['DEED', 'DEE'],
    ['DEEP', 'END'],
  ],
  [
    ['LOOSE', 'ENDS'],
    ['LOOSE', 'ENDS'],
  ],
  [
    ['SNORE', 'DUNE'],
    ['LOOSE', 'ENDS'],
  ],
  [
    ['HIGH', 'NOON'],
    ['HIGH', 'NOON'],
  ],
  [
    ['NIGH', 'MOON'],
    ['HIGH', 'NOON'],
  ],
  [
    ['SPLIT', 'SECOND'],
    ['SPLIT', 'SECOND'],
  ],
  [
    ['STILT', 'SECOND'],
    ['SPLIT', 'SECOND'],
  ],
  [
    ['BLIND', 'SPOT'],
    ['BLIND', 'SPOT'],
  ],
  [
    ['BLAND', 'STOP'],
    ['BLIND', 'SPOT'],
  ],
  [
    ['FREE', 'FALL'],
    ['FREE', 'FALL'],
  ],
  [
    ['REEF', 'LLAF'],
    ['FREE', 'FALL'],
  ],
  [
    ['HOT', 'EASE'],
    ['TOE', 'HOLD'],
  ],
  [
    ['EEL', 'DEEP'],
    ['TOE', 'HOLD'],
  ],
  [
    ['TOE', 'EAT', 'HOT'],
    ['THE', 'OLD', 'HAT'],
  ],
]

describe('the colored-tile invariant', () => {
  it.each(INVARIANT_PAIRS.map(([guess, answer]) => [answer.join(' '), guess.join(' '), guess, answer]))(
    'colors no more of %s than it holds, for guess %s',
    (_answer, _guess, guess, answer) => {
      const board = markGuess(guess as string[], answer as string[])
      const occurrences = countLettersInTest((answer as string[]).join(''))
      const colored = countLettersInTest(
        board
          .flatMap((word, index) =>
            word.map((tile, position) => (tile === 'gray' ? '' : (guess as string[])[index][position])),
          )
          .join(''),
      )

      // A board showing FEWER colored tiles than the phrase justifies is conservative -- every
      // colored tile still corresponds to a real, distinct letter. A board showing MORE is a lie
      // the player can prove by counting. Reported as the offending pairs rather than as a boolean,
      // so a failure names the letter and both counts.
      expect(Object.entries(colored).filter(([letter, count]) => count > (occurrences[letter] ?? 0))).toStrictEqual([])
    },
  )
})
