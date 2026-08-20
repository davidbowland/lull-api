import { normalizeAnswer } from '@rules/normalize-answer'

describe('normalizeAnswer', () => {
  it('folds case', () => {
    expect(normalizeAnswer('The Empire Strikes Back')).toBe('THEEMPIRESTRIKESBACK')
  })

  // The whole point of Missing Vowels is that the displayed spacing lies, so a player who
  // recovers the phrase must not also have to guess where the boundaries really were.
  it.each([
    ['internal spaces', 'TIME FLIES'],
    ['leading and trailing space', '  TIME FLIES  '],
    ['runs of whitespace', 'TIME   FLIES'],
    ['tabs and newlines', 'TIME\tFLIES\n'],
    ['no spaces at all', 'TIMEFLIES'],
  ])('drops %s', (_description, value) => {
    expect(normalizeAnswer(value)).toBe('TIMEFLIES')
  })

  it.each([
    ['an apostrophe', "DON'T LOOK NOW", 'DONTLOOKNOW'],
    ['a hyphen', 'SPIDER-MAN', 'SPIDERMAN'],
    ['an ampersand', 'ROCK & ROLL', 'ROCKROLL'],
    ['terminal punctuation', 'WHO ARE YOU?!', 'WHOAREYOU'],
    ['a colon', 'ALIEN: RESURRECTION', 'ALIENRESURRECTION'],
    ['an underscore', 'SOME_TITLE', 'SOMETITLE'],
    ['an emoji', 'ROCK 🎸 ROLL', 'ROCKROLL'],
  ])('drops %s', (_description, value, expected) => {
    expect(normalizeAnswer(value)).toBe(expected)
  })

  // A phrase corpus will produce accented titles, and a player on a US keyboard cannot type them.
  it.each([
    ['an acute accent', 'CAFÉ SOCIETY', 'CAFESOCIETY'],
    ['a diaeresis', 'NAÏVE', 'NAIVE'],
    ['a tilde', 'EL NIÑO', 'ELNINO'],
    ['a lowercase accent', 'café', 'CAFE'],
  ])('folds %s', (_description, value, expected) => {
    expect(normalizeAnswer(value)).toBe(expected)
  })

  it('keeps digits', () => {
    expect(normalizeAnswer('Ocean’s 11')).toBe('OCEANS11')
  })

  // The displayed consonant string carries the article's letters (THE contributes TH), so the
  // player can see the article is part of the phrase. Stripping it here would accept an answer
  // inconsistent with what they were shown.
  it('keeps a leading article, which the displayed consonants already reveal', () => {
    expect(normalizeAnswer('The Empire Strikes Back')).not.toBe(normalizeAnswer('Empire Strikes Back'))
  })

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['only punctuation', '-.,!?'],
  ])('returns an empty string for %s', (_description, value) => {
    expect(normalizeAnswer(value)).toBe('')
  })

  it('is idempotent', () => {
    const once = normalizeAnswer('The Empire Strikes Back!')
    expect(normalizeAnswer(once)).toBe(once)
  })
})
