import {
  MAX_ANSWER_LENGTH,
  exceedsApostrophes,
  hasApostrophe,
  hasLongWord,
  meetsAuthorFloor,
  meetsSentenceFloor,
  renderAnswer,
  stripAuthor,
} from '@generators/cryptogram/sentence'

describe('meetsSentenceFloor', () => {
  it.each([
    'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES.',
    "I CAN'T GIVE YOU A SENTENCE, BUT I CAN GIVE YOU A LINE.",
    'WHAT IS THE USE OF A HOUSE IF YOU HAVE NO PLANET TO PUT IT ON?',
    'BE YOURSELF; EVERYONE ELSE IS ALREADY TAKEN BY SOMEONE!',
    // Nine is the hard ceiling, and it is legal.
    'NECESSITY IS THE MOTHER OF EVERY GOOD IDEA WE HAVE.',
    // A trailing comma is not a letter, so TOMORROW stays at eight.
    'DO NOT PUT OFF UNTIL TOMORROW, WHAT YOU CAN DO TODAY.',
  ])('accepts %s', (text) => {
    expect(meetsSentenceFloor(text)).toBe(true)
  })

  it.each([
    ['too few words', 'THE EARLY BIRD CATCHES WORMS.'],
    ['too many words', `${'AN '.repeat(17).trim()}.`],
    ['too few letters', 'IT IS WHAT IT IS NOW.'],
    ['too many letters', `${'ABCDEFGHI '.repeat(9)}A.`],
    ['a word over nine letters', 'THE COMMERCIAL BREAK RAN LONG AGAIN TONIGHT.'],
    ['no closing mark', 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES'],
    ['a closing comma', 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES,'],
    ['two apostrophes', "DON'T COUNT YOUR CHICKENS BEFORE THEY'RE HATCHED."],
    ['a hyphen', 'A WELL-KNOWN FOOL AND HIS MONEY ARE SOON PARTED.'],
    ['a quotation mark', 'HE SAID "PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT."'],
    ['a leading apostrophe', "'TIS BETTER TO HAVE LOVED AND LOST THAN NEVER AT ALL."],
    ['a trailing possessive', "THE BOYS' TOYS WERE LEFT OUT IN THE RAIN ALL NIGHT."],
    ['a doubled mark', 'PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES..'],
    ['a mark before a space', 'PEOPLE WHO LIVE IN GLASS HOUSES , SHOULD NOT THROW STONES.'],
    ['a mark with no space after it', 'PEOPLE WHO LIVE IN GLASS,HOUSES SHOULD NOT THROW STONES.'],
    ['lower case', 'People who live in glass houses should not throw stones.'],
    ['a digit', 'THE 2 OF US WALKED TO THE RIVER AND BACK.'],
    ['more characters than the cap', `IT IS NOT ENOUGH TO BE BUSY SO ARE THE ANTS${' '.repeat(70)}.`],
  ])('rejects %s', (_name, text) => {
    expect(meetsSentenceFloor(text)).toBe(false)
  })
})

describe('meetsAuthorFloor', () => {
  it.each(['MARK TWAIN', 'H. G. WELLS', "FLANNERY O'CONNOR", 'AESOP'])('accepts %s', (author) => {
    expect(meetsAuthorFloor(author)).toBe(true)
  })

  it.each([
    ['lower case', 'Mark Twain'],
    ['over thirty characters', 'A'.repeat(31)],
    ['five words', 'A B C D E'],
    ['a trailing space', 'MARK TWAIN '],
    ['a doubled space', 'MARK  TWAIN'],
    ['a hyphen', 'JEAN-PAUL SARTRE'],
    ['a leading period', '.MARK TWAIN'],
    ['the empty string', ''],
  ])('rejects %s', (_name, author) => {
    expect(meetsAuthorFloor(author)).toBe(false)
  })
})

describe('renderAnswer', () => {
  it('appends the speaker after the separator', () => {
    expect(renderAnswer('IT IS A START.', 'MARK TWAIN')).toEqual('IT IS A START. - MARK TWAIN')
  })

  it('leaves a proverb alone', () => {
    expect(renderAnswer('IT IS A START.', null)).toEqual('IT IS A START.')
  })

  it('fits the longest quote and the longest author inside the answer cap', () => {
    expect(renderAnswer('Q'.repeat(110), 'A'.repeat(30))).toHaveLength(MAX_ANSWER_LENGTH)
  })
})

describe('stripAuthor', () => {
  it.each([
    ['IT IS A START. - MARK TWAIN', 'IT IS A START.'],
    ['IT IS A START.', 'IT IS A START.'],
    // Answers stored before quotes keep working.
    ['A STITCH IN TIME SAVES NINE', 'A STITCH IN TIME SAVES NINE'],
  ])('reads %s as %s', (answer, quote) => {
    expect(stripAuthor(answer)).toEqual(quote)
  })
})

describe('apostrophes', () => {
  it.each([
    ["IT'S A START.", true, false],
    ["IT'S A START. - FLANNERY O'CONNOR", true, true],
    ['IT IS A START. - MARK TWAIN', false, false],
  ])('reads %s', (answer, has, exceeds) => {
    expect(hasApostrophe(answer)).toBe(has)
    expect(exceedsApostrophes(answer)).toBe(exceeds)
  })
})

describe('hasLongWord', () => {
  it.each([
    ['PEOPLE WHO LIVE IN GLASS HOUSES SHOULD NOT THROW STONES.', false],
    // SQUEAKY is seven letters, the comfortable ceiling itself.
    ['THE SQUEAKY WHEEL GETS THE GREASE EVERY TIME.', false],
    // Seven letters and a comma.
    ['THE SQUEAKY, WHEEL GETS THE GREASE EVERY TIME.', false],
    ['A STRANGER IS A FRIEND YOU HAVE NOT MET.', true],
  ])('reads %s as %p', (text, expected) => {
    expect(hasLongWord(text)).toBe(expected)
  })
})
