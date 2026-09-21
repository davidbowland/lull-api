import { markGuess } from '@rules/mark-guess'

// A SECOND implementation, from the definition: an invariant checked with the code under test's
// own counter cannot catch a bug in it.
const countLettersInTest = (letters: string): Record<string, number> =>
  [...letters].reduce<Record<string, number>>(
    (counts, letter) => ({ ...counts, [letter]: (counts[letter] ?? 0) + 1 }),
    {},
  )

// Row 1 CORRECTS the catalog's published example, which shows HOT's H as purple: the phrase has
// one H, HAND's green spends it, and the purple pass has nothing left.
describe('markGuess', () => {
  it('marks the corrected TOE HOLD / HOT HAND board', () => {
    expect(markGuess(['HOT', 'HAND'], ['TOE', 'HOLD'])).toStrictEqual([
      ['gray', 'green', 'yellow'],
      ['green', 'gray', 'gray', 'green'],
    ])
  })

  // Three E's, three colored tiles, the fourth gray -- a ledger rather than a membership test.
  it('spends a repeated letter across words in reading order', () => {
    expect(markGuess(['NEE', 'TEE'], ['EEL', 'NET'])).toStrictEqual([
      ['purple', 'green', 'yellow'],
      ['yellow', 'green', 'gray'],
    ])
  })

  // Total surplus: six E's guessed, three in the answer, exactly three colored.
  it('colors exactly as many tiles as the answer has copies', () => {
    expect(markGuess(['EEE', 'EEE'], ['EEL', 'NET'])).toStrictEqual([
      ['green', 'green', 'gray'],
      ['gray', 'green', 'gray'],
    ])
  })

  // The cross-word D is YELLOW because yellow reads remaining[w] alone and never reaches pass 3.
  it('prefers a yellow in the tile own word over a purple elsewhere', () => {
    expect(markGuess(['PEEP', 'EDS'], ['DEEP', 'END'])).toStrictEqual([
      ['gray', 'green', 'green', 'green'],
      ['green', 'yellow', 'gray'],
    ])
  })

  // Purple across a word boundary in BOTH directions, with colored counts equal to occurrences.
  it('marks purple in both directions across a word boundary', () => {
    expect(markGuess(['CALL', 'COLD'], ['COLD', 'CALL'])).toStrictEqual([
      ['green', 'purple', 'green', 'purple'],
      ['green', 'purple', 'green', 'purple'],
    ])
  })

  // Yellow saturation: nine tiles, seven yellow, zero purple -- every letter the guess misplaces is
  // misplaced inside its own word.
  it('does not reach the purple pass when yellow can absorb the letter', () => {
    expect(markGuess(['SALT', 'WARTS'], ['LAST', 'STRAW'])).toStrictEqual([
      ['yellow', 'green', 'yellow', 'green'],
      ['yellow', 'yellow', 'green', 'yellow', 'yellow'],
    ])
  })

  it('marks a fully correct guess all green', () => {
    expect(markGuess(['TOE', 'HOLD'], ['TOE', 'HOLD'])).toStrictEqual([
      ['green', 'green', 'green'],
      ['green', 'green', 'green', 'green'],
    ])
  })

  // Shape is isValidGuess's job. Reaching here with the wrong shape is a programming error.
  it('throws when the word lengths do not correspond', () => {
    expect(() => markGuess(['STRAW', 'LAST'], ['LAST', 'STRAW'])).toThrow('Guess and answer do not have the same shape')
  })

  it('throws when the word counts differ', () => {
    expect(() => markGuess(['TOE'], ['TOE', 'HOLD'])).toThrow('Guess and answer do not have the same shape')
  })

  // Purple depends on the GUESS, not the answer's internal sharing, which is why the structural
  // floor has no cross-word-sharing clause -- one would stop BEAR HUG reaching a board.
  it('marks purple on an answer whose words share no letter', () => {
    expect(markGuess(['GRAB', 'HUE'], ['BEAR', 'HUG'])).toStrictEqual([
      ['purple', 'yellow', 'green', 'yellow'],
      ['green', 'green', 'purple'],
    ])
  })

  // The only board here where two purple tiles want the same copy, so the only thing pinning pass
  // 3's `remaining[donor][letter]--`: delete that line and every other row still passes. It pins
  // the left-to-right tie-break in the same cell, and no board separates the two, because
  // contention is what makes either observable.
  it('lets only one of two competing purples take the phrase last copy', () => {
    expect(markGuess(['HOT', 'EASE'], ['TOE', 'HOLD'])).toStrictEqual([
      ['purple', 'green', 'yellow'],
      ['purple', 'gray', 'gray', 'gray'],
    ])
  })

  // The yellow pass's left-to-right scan, which nothing else pins: EEL's two E's contend for TOE's
  // one with no green in sight, so a reversed inner loop reads gray-yellow-purple.
  it('gives a yellow to the earlier of two tiles that want the same copy', () => {
    expect(markGuess(['EEL', 'DEEP'], ['TOE', 'HOLD'])).toStrictEqual([
      ['yellow', 'gray', 'purple'],
      ['yellow', 'gray', 'gray', 'gray'],
    ])
  })

  // Pass 3's WORD order, which needs three words: a purple never draws from its own word, so with
  // two the only donor for word 0 is word 1 and they cannot contend. Every other fixture here has
  // two words, so reversing the outer loop reddens this row alone. THE OLD HAT's one unspent O is
  // wanted by TOE and HOT, so exactly one tile moves between ascending and descending.
  it('gives the phrase last copy to the earlier WORD, not just the earlier position', () => {
    expect(markGuess(['TOE', 'EAT', 'HOT'], ['THE', 'OLD', 'HAT'])).toStrictEqual([
      ['green', 'purple', 'green'],
      ['gray', 'purple', 'gray'],
      ['green', 'gray', 'green'],
    ])
  })

  // Green-and-yellow word-major is provably identical -- yellow debits remaining[w] alone -- so
  // what is wrong is PURPLE BEFORE A LATER WORD'S GREEN. Asserted as a COUNT, because a word-major
  // implementation goes wrong only by printing HOT's purple H alongside HAND's green.
  it('colors exactly one H tile, because TOE HOLD has exactly one H', () => {
    const guess = ['HOT', 'HAND']
    const board = markGuess(guess, ['TOE', 'HOLD'])
    const coloredH = board.flatMap((word, index) =>
      word.filter((tile, position) => guess[index][position] === 'H' && tile !== 'gray'),
    )

    expect(coloredH).toHaveLength(1)
  })
})

// A COMMITTED table rather than generated pairs: a random-guess property test passes today and
// fails tomorrow, and its counterexample could not be reproduced from the file. Every pair's word
// lengths must CORRESPOND, or the pair throws at step 0 and tests the throw.
//
// The independent guard on the ledger debit, counting colored tiles per letter and naming no cell.
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

      // Fewer colored tiles than the phrase justifies is conservative; more is a lie the player
      // can count. Reported as pairs so a failure names the letter and both counts.
      expect(Object.entries(colored).filter(([letter, count]) => count > (occurrences[letter] ?? 0))).toStrictEqual([])
    },
  )
})
