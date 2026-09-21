import { splitPhrase } from '@rules/is-valid-guess'

import {
  MAX_WORD_LETTERS,
  derivedDifficulty,
  meetsStructuralFloor,
  sharedLetterCount,
  wordsOf,
} from '@generators/phrazle/difficulty'
import { Familiarity, Phrase, PhraseShape } from '@types'

const phraseOf = (text: string, shape: PhraseShape = 'compact', familiarity: Familiarity = 3): Phrase => ({
  category: 'Thing',
  familiarity,
  hints: ['One', 'Two', 'Three'],
  shape,
  text,
})

// Identity rather than behavior: a behavioral comparison passes over two implementations that agree on the cases
// someone thought to write down. Identity makes "two splitters over one phrase" unrepresentable.
describe('wordsOf', () => {
  it('is splitPhrase itself', () => {
    expect(wordsOf).toBe(splitPhrase)
  })
})

// lull-ui's src/components/phrazle/rungs.ts restates this number as a local literal to cap a rung's rendered
// length, and no test spans both repos. This row only catches the constant moving here; editing lull-ui's copy
// leaves both suites green.
describe('MAX_WORD_LETTERS', () => {
  it('is 9, the number lull-ui restates as a literal', () => {
    expect(MAX_WORD_LETTERS).toBe(9)
  })
})

describe('sharedLetterCount', () => {
  it('counts distinct letters appearing in two or more words', () => {
    expect(sharedLetterCount(['TOE', 'HOLD'])).toBe(1)
  })

  it('counts a letter shared by three words once', () => {
    expect(sharedLetterCount(['BITE', 'THE', 'BULLET'])).toBe(3)
  })

  // Within-word repeats are not sharing: HIGH NOON has 1.60 tiles per distinct letter and still takes no
  // discount, because the term counts cross-word sharing only.
  it('ignores letters repeated inside one word', () => {
    expect(sharedLetterCount(['HIGH', 'NOON'])).toBe(0)
  })

  it('returns zero for words that share nothing', () => {
    expect(sharedLetterCount(['BEAR', 'HUG'])).toBe(0)
  })
})

// Each clause failing INDEPENDENTLY: every phrase below clears the other four.
describe('meetsStructuralFloor', () => {
  it('accepts a two-word compact', () => {
    expect(meetsStructuralFloor(phraseOf('Snake eyes'))).toBe(true)
  })

  it('accepts a three-word compact', () => {
    expect(meetsStructuralFloor(phraseOf('Bite the bullet'))).toBe(true)
  })

  // Cross-word sharing is not a floor clause: purple depends on the guess, not the answer. BIG CHEESE shares
  // nothing and clears every other bound, including the nine-tile floor, so it can only fail on sharing.
  it('accepts an answer whose words share no letter', () => {
    expect(meetsStructuralFloor(phraseOf('Big cheese'))).toBe(true)
  })

  // Nine letters, so it clears the tile floor and fails on the word count alone.
  it('rejects a single word', () => {
    expect(meetsStructuralFloor(phraseOf('Wonderful'))).toBe(false)
  })

  it('accepts four words', () => {
    expect(meetsStructuralFloor(phraseOf('Knock your socks off'))).toBe(true)
  })

  it('accepts six words', () => {
    expect(meetsStructuralFloor(phraseOf('Too many cooks spoil the broth'))).toBe(true)
  })

  it('rejects seven words', () => {
    expect(meetsStructuralFloor(phraseOf('Bite off more than you can chew'))).toBe(false)
  })

  // Two letters in, one letter out. Long English idiom is built on of/in/it/to/up/on/at, so excluding them makes
  // the long class unreachable; a single letter really is a free tile.
  it('accepts a two-letter word', () => {
    expect(meetsStructuralFloor(phraseOf('Out of the blue'))).toBe(true)
  })

  it('rejects a one-letter word', () => {
    expect(meetsStructuralFloor(phraseOf('A piece of the action'))).toBe(false)
  })

  // COMMERCIAL is ten letters, one over the per-word cap, and clears every other clause.
  it('rejects a word above the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Commercial break'))).toBe(false)
  })

  it('accepts a word sitting exactly on the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Groundhog day'))).toBe(true)
  })

  // The tile floor. Six tiles of feedback per guess is not a board at any band; see the floor's docblock for why
  // this is a bound rather than a re-grade.
  it.each([
    ['See red', 6],
    ['Wing it', 6],
    ['Cash cow', 7],
    ['Swap meet', 8],
  ])('rejects %s, which is only %i tiles', (text) => {
    expect(meetsStructuralFloor(phraseOf(text))).toBe(false)
  })

  it('accepts a phrase sitting exactly on the tile floor', () => {
    expect(meetsStructuralFloor(phraseOf('Quick draw'))).toBe(true)
  })

  // Four words of nine, nine, nine and seven letters is 34, over the total cap of 30, with every
  // other clause clear -- including the per-word cap, so this fails on the total alone.
  it('rejects a phrase over the total-letter cap', () => {
    expect(meetsStructuralFloor(phraseOf('Wonderful beautiful marvelous elegant'))).toBe(false)
  })

  // The canonicality clause: canonicalizing changes what the floor measured. Rejected rather than silently
  // stripped, so code never composes a player-visible string the upstream content gates did not see.
  it('rejects a phrase whose text is not already canonical', () => {
    expect(meetsStructuralFloor(phraseOf('Catch-22 rules'))).toBe(false)
  })

  it('accepts a phrase whose only non-canonical feature is spacing and case', () => {
    expect(meetsStructuralFloor(phraseOf('  close   shave '))).toBe(true)
  })

  it('rejects an empty phrase', () => {
    expect(meetsStructuralFloor(phraseOf('   '))).toBe(false)
  })
})

// Every row is a phrase this repo actually shipped, read off 52 live packs from the public API, so the histogram
// below is a claim about the supply the nightly builder sees rather than about phrases someone thought of. A
// table written by hand against the curve it tests agrees with the code because both came out of one sitting.
const DERIVATIONS: [string, number][] = [
  ['Quick draw', 1],
  ['Snake eyes', 1],
  ['Close shave', 1],
  ['Ivory tower', 1],
  ['Pearly gates', 1],
  ['The big chill', 1],
  ['Walk the plank', 1],
  ['Out of the blue', 1],
  ['Back seat driver', 1],
  ['Groundhog day', 2],
  ['Fall on deaf ears', 2],
  ['Let them eat cake', 2],
  ['Knuckle sandwich', 2],
  ['Salt of the earth', 2],
  ['The sound of music', 2],
  ['Graveyard shift', 3],
  ['Yellow submarine', 3],
  ['Knowledge is power', 3],
  ['Add insult to injury', 3],
  ['Blow up in your face', 4],
  ['Chip off the old block', 4],
  ['Air your dirty laundry', 4],
  ['Dead men tell no tales', 4],
  ['The dark side of the moon', 5],
  ['Round up the usual suspects', 5],
  ['Strike while the iron is hot', 5],
  ['We must cultivate our garden', 5],
  ['Scrape the bottom of the barrel', 5],
  ['Too many cooks spoil the broth', 5],
]

describe('derivedDifficulty', () => {
  it.each(DERIVATIONS)('derives %s to %i', (text, difficulty) => {
    expect(derivedDifficulty(phraseOf(text))).toBe(difficulty)
  })

  // Makes the histogram below a statement about supply rather than arithmetic: a row that derives correctly but
  // could never be selected still passes every row above.
  it('clears the structural floor for every row of the derivation table', () => {
    expect(DERIVATIONS.filter(([text]) => !meetsStructuralFloor(phraseOf(text)))).toStrictEqual([])
  })

  // No declared band is empty by construction, which isComplete would otherwise turn into a permanently
  // incomplete pack. Over the 140 shipped answers clearing the floor the derivation runs {1: 52, 2: 30, 3: 14,
  // 4: 17, 5: 27}; band 5 is thin on purpose, being the only band that can take a derived 5.
  it('populates every band from one to five', () => {
    const histogram = DERIVATIONS.reduce<Record<number, number>>((counts, [text]) => {
      const derived = derivedDifficulty(phraseOf(text))
      return { ...counts, [derived]: (counts[derived] ?? 0) + 1 }
    }, {})

    expect(histogram).toStrictEqual({ 1: 9, 2: 6, 3: 4, 4: 4, 5: 6 })
  })

  // The clamp at the top end: six words, twenty-nine letters, nothing shared -> 5 + 2 - 0 = 7.
  it('clamps above five', () => {
    expect(derivedDifficulty(phraseOf('Quick brown foxes jumped over lazy'))).toBe(5)
  })

  // Familiarity is rejected as a dial: reviewPhrases catches its own errors and returns its input unchanged, so
  // on a night the review call fails familiarity defaults to 3 across the whole batch and one band starves.
  it('ignores familiarity', () => {
    expect(derivedDifficulty(phraseOf('Snake eyes', 'compact', 1))).toBe(
      derivedDifficulty(phraseOf('Snake eyes', 'compact', 5)),
    )
  })

  // `phrase.shape` is model-authored, so it is logged and never gated: a mis-tagged compact is not silently
  // starved.
  it('ignores the shape tag', () => {
    expect(meetsStructuralFloor(phraseOf('Snake eyes', 'title'))).toBe(true)
    expect(derivedDifficulty(phraseOf('Snake eyes', 'title'))).toBe(derivedDifficulty(phraseOf('Snake eyes', 'idiom')))
  })
})
