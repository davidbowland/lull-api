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

  // Three E's in the phrase, three coloured E tiles, the fourth gray. Word 2's trailing E is the
  // tile that separates a ledger from a membership test.
  it('spends a repeated letter across words in reading order', () => {
    expect(markGuess(['NEE', 'TEE'], ['EEL', 'NET'])).toStrictEqual([
      ['purple', 'green', 'yellow'],
      ['yellow', 'green', 'gray'],
    ])
  })

  // Total surplus: six E's guessed, three in the answer, exactly three coloured. Wordle's rule --
  // the copies that keep the colour are the ones the passes reach first.
  it('colours exactly as many tiles as the answer has copies', () => {
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

  // Purple across a word boundary in BOTH directions. Coloured counts equal occurrences exactly for
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

  // THE WORD-MAJOR REJECTION, PINNED -- and pinned for the right reason. Green-and-yellow word-major
  // is not wrong, it is provably IDENTICAL: yellow reads and debits remaining[w] and nothing else,
  // so a word-0 yellow cannot take a letter word 1 needs for a green. What is actually wrong is
  // PURPLE BEFORE A LATER WORD'S GREEN, because purple reads the phrase-wide sum and can spend a
  // copy a later word's green is entitled to.
  //
  // These are row 1's inputs asserted as a COUNT rather than as a cell. A word-major implementation
  // still gets O, T, A, N and D right; what it gets wrong is printing HOT's purple H alongside
  // HAND's green H -- two coloured tiles for the phrase's one H, which is the catalog's published
  // bug and the invariant broken, rather than a precedence table inverted.
  it('colours exactly one H tile, because TOE HOLD has exactly one H', () => {
    const guess = ['HOT', 'HAND']
    const board = markGuess(guess, ['TOE', 'HOLD'])
    const colouredH = board.flatMap((word, index) =>
      word.filter((tile, position) => guess[index][position] === 'H' && tile !== 'gray'),
    )

    expect(colouredH).toHaveLength(1)
  })
})

// The mandated invariant, which is the whole reason for one ledger. Looped over a COMMITTED table
// rather than generated: a random-guess property test passes today and fails tomorrow, which
// CLAUDE.md forbids outright, and a counterexample it found could not be reproduced from the file.
//
// Twenty-one pairs, covering duplicate letters inside one word, duplicate letters across words,
// total surplus, zero overlap, exact match, a full reversal, and every fixture board's inputs above.
// Every pair's word lengths CORRESPOND -- a mismatched pair throws at step 0 and would test the
// throw rather than the invariant.
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
]

describe('the coloured-tile invariant', () => {
  it.each(INVARIANT_PAIRS.map(([guess, answer]) => [answer.join(' '), guess.join(' '), guess, answer]))(
    'colours no more of %s than it holds, for guess %s',
    (_answer, _guess, guess, answer) => {
      const board = markGuess(guess as string[], answer as string[])
      const occurrences = countLettersInTest((answer as string[]).join(''))
      const coloured = countLettersInTest(
        board
          .flatMap((word, index) =>
            word.map((tile, position) => (tile === 'gray' ? '' : (guess as string[])[index][position])),
          )
          .join(''),
      )

      // A board showing FEWER coloured tiles than the phrase justifies is conservative -- every
      // coloured tile still corresponds to a real, distinct letter. A board showing MORE is a lie
      // the player can prove by counting. Reported as the offending pairs rather than as a boolean,
      // so a failure names the letter and both counts.
      expect(Object.entries(coloured).filter(([letter, count]) => count > (occurrences[letter] ?? 0))).toStrictEqual([])
    },
  )
})
