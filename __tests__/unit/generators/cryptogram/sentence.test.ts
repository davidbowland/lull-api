import { hasLongWord, meetsSentenceFloor } from '@generators/cryptogram/sentence'

describe('meetsSentenceFloor', () => {
  it.each([
    'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES',
    'It is not enough to be busy so are the ants',
    // Nine is the hard ceiling, and it is legal.
    'NECESSITY IS THE MOTHER OF EVERY GOOD IDEA WE HAVE',
  ])('accepts %s', (text) => {
    expect(meetsSentenceFloor(text)).toBe(true)
  })

  it.each([
    // Five words.
    ['too few words', 'THE EARLY BIRD CATCHES WORMS'],
    // Seventeen words, thirty-four letters.
    ['too many words', 'AN '.repeat(17).trim()],
    // Six words, twenty-two letters.
    ['too few letters', 'IT IS WHAT IT IS NOW'],
    // Eighty-two letters: nine nine-letter words and a trailing A.
    ['too many letters', `${'ABCDEFGHI '.repeat(9)}A`],
    ['a word over nine letters', 'THE COMMERCIAL BREAK RAN LONG AGAIN TONIGHT'],
    ['an apostrophe', "DON'T COUNT YOUR CHICKENS BEFORE THEY HATCH"],
    ['punctuation', 'WHEN IN ROME, DO AS THE ROMANS DO TODAY'],
    ['a digit', 'THE 2 OF US WALKED TO THE RIVER AND BACK'],
    // Valid on every other bound; only trailing whitespace carries it past the character cap.
    ['more characters than the cap', `IT IS NOT ENOUGH TO BE BUSY SO ARE THE ANTS${' '.repeat(60)}`],
  ])('rejects %s', (_name, text) => {
    expect(meetsSentenceFloor(text)).toBe(false)
  })
})

describe('hasLongWord', () => {
  it.each([
    ['PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES', false],
    // SQUEAKY is seven letters, the comfortable ceiling itself.
    ['THE SQUEAKY WHEEL GETS THE GREASE EVERY TIME', false],
    ['A STRANGER IS A FRIEND YOU HAVE NOT MET', true],
    ['NECESSITY IS THE MOTHER OF EVERY GOOD IDEA WE HAVE', true],
  ])('reads %s as %p', (text, expected) => {
    expect(hasLongWord(text)).toBe(expected)
  })
})
