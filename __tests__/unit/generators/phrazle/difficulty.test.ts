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

// THE ONE SPLITTER, asserted by identity rather than by behavior. A behavioral comparison passes
// over two implementations that agree on the cases someone thought to write down; identity is what
// makes "two splitters over one phrase" unrepresentable.
describe('wordsOf', () => {
  it('is splitPhrase itself', () => {
    expect(wordsOf).toBe(splitPhrase)
  })
})

// THE WEAKER HALF OF A PIN THAT NO LONGER EXISTS, and it is worth knowing exactly how much weaker.
//
// The phrazle rung builder caps its longest rung by hand, and the arithmetic behind that cap starts
// from this constant. The builder used to live in src/rules/hint-phrazle.ts with its test beside it;
// the test restated 11 as a local literal because `@generators/...` resolves in only one of the two
// repos, and __tests__/unit/rules/hint-sweep.test.ts -- which did not travel -- READ THAT TEST'S
// SOURCE TEXT and asserted the restated literal equal to the constant below. That row was written as
// a post-mortem: the rung cap had been derived from a MAX_WORD_LETTERS of 7, four below the real
// gate, and no version of this repo has ever held a 7.
//
// The builder now lives in lull-ui as src/components/phrazle/rungs.ts, so there is no vendored test
// left to read and the pin is gone. What is here instead is this row and a matching comment on
// lull-ui's restatement. IT IS STRICTLY WEAKER: it fails if the constant moves HERE without someone
// noticing, which is the direction the old row also caught, but it says nothing about the literal
// over there. Editing lull-ui's copy leaves both suites green, which is precisely the failure the
// source-reading version existed to make impossible. Nothing available in one repo can restore it.
//
// IT IS NOW 9, DOWN FROM 11, AND THE DIRECTION IS WHY THIS ROW CAN BE LEFT AS THE ONLY GUARD. The
// number over there caps a rung's rendered length, so lull-ui's stale 11 is an over-estimate of a
// maximum: every ladder this repo can now produce is shorter than the cap it is measured against.
// A stale literal in the other direction -- the 7 the post-mortem above is about -- is the one that
// ships a truncated hint, and this change cannot create one.
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

  // Within-word repeats are NOT sharing. HIGH NOON has 1.60 tiles per distinct letter and still
  // takes no discount, because the term counts cross-word sharing only.
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

  // THE HEADSTONE OF THE DELETED CROSS-WORD-SHARING CLAUSE. An earlier draft rejected a phrase whose
  // words share nothing on the ground that "below this no purple tile can ever appear", which is
  // false: purple depends on the GUESS, and mark-guess.test.ts ships GRAB HUE against BEAR HUG
  // producing two purples. This row goes red if anyone re-adds the clause.
  //
  // IT IS BIG CHEESE AND NOT BEAR HUG ANY MORE, and the swap is not a weakening of the headstone. It
  // is the nine-tile floor: BEAR HUG is seven tiles and is now rejected for its SIZE, which would
  // have left this row passing for the wrong reason and unable to fail if the sharing clause came
  // back. BIG CHEESE shares nothing either and clears every other bound.
  it('accepts an answer whose words share no letter', () => {
    expect(meetsStructuralFloor(phraseOf('Big cheese'))).toBe(true)
  })

  // Nine letters, so it clears the tile floor and fails on the word count alone.
  it('rejects a single word', () => {
    expect(meetsStructuralFloor(phraseOf('Wonderful'))).toBe(false)
  })

  // FOUR WORDS IS NOW ACCEPTED, and this row is the inversion of one that asserted the opposite.
  // The 2-3 word bound is what made every easy Phrazle a 3+3 or a 3+4 -- two words of three or more
  // letters inside seven total has no other arrangement -- and it excluded the whole class of phrase
  // this game is best on. KNOCK YOUR SOCKS OFF cleared every other clause and was rejected for its
  // word count alone.
  it('accepts four words', () => {
    expect(meetsStructuralFloor(phraseOf('Knock your socks off'))).toBe(true)
  })

  it('accepts six words', () => {
    expect(meetsStructuralFloor(phraseOf('Too many cooks spoil the broth'))).toBe(true)
  })

  it('rejects seven words', () => {
    expect(meetsStructuralFloor(phraseOf('Bite off more than you can chew'))).toBe(false)
  })

  // TWO-LETTER WORDS ARE NOW ACCEPTED and ONE-LETTER WORDS ARE STILL OUT, which is the line the
  // floor draws rather than an accident. English idiom of four or more words is built on
  // of/in/it/to/up/on/at, so excluding them made the long class unreachable; a single letter really
  // is a free tile, so A PIECE OF THE ACTION ships as PIECE OF THE ACTION or not at all.
  it('accepts a two-letter word', () => {
    expect(meetsStructuralFloor(phraseOf('Out of the blue'))).toBe(true)
  })

  it('rejects a one-letter word', () => {
    expect(meetsStructuralFloor(phraseOf('A piece of the action'))).toBe(false)
  })

  // COMMERCIAL is ten letters, one over the per-word cap. It is the real case rather than a
  // synthetic one: COMMERCIAL BREAK shipped as a Phrazle on 2026-09-21, and a ten-letter row is a
  // ten-letter word the player has to invent before the board takes a tile.
  it('rejects a word above the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Commercial break'))).toBe(false)
  })

  it('accepts a word sitting exactly on the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Groundhog day'))).toBe(true)
  })

  // THE TILE FLOOR, and it is the clause this whole change turns on. SEE RED is six tiles across two
  // three-letter rows and was shipping as the day's EASY Phrazle. Six tiles of feedback per guess is
  // not an easy board, and it is not a hard one either -- see the floor's docblock for why this is a
  // bound rather than a re-grade.
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

  // The canonicality clause. IT'S A WRAP canonicalizes to ITS A WRAP, whose first word is three
  // letters rather than four -- a difference that would put the shipped board out of step with what
  // the floor measured. Rejected rather than silently stripped, so code never composes a
  // player-visible string the upstream content gates did not see.
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

// The reachability check made a rule, run and reported. Both declared bands must be reachable from
// the prompt's own compact examples, or packs.ts's isComplete turns a permanently incomplete pack.
//
// REBUILT A SECOND TIME, AND EVERY ROW IS A PHRASE THIS REPO ACTUALLY SHIPPED. The previous table
// was written by hand against the curve it was testing, which is the failure mode a derivation table
// has: it agreed with the code because both came out of the same sitting. These 30 rows are read off
// 52 live packs fetched from the public API, so the histogram below is a claim about the supply the
// nightly builder really sees rather than about phrases someone thought of.
//
// WHAT THE ROWS ARE FOR. Derived 1 is the cell no other declared band can reach, so it is what the
// day's EASY Phrazle is drawn from -- and it used to be reachable only by a 3+3 or a 3+4, which is
// the whole bug. It is now 9 to 14 tiles of short words that share letters. Derived 5 is 19 tiles
// and up across four to six rows.
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

  // Every row clears the floor, which is what makes the histogram below a statement about SUPPLY
  // rather than about arithmetic. A row that derived correctly and could never be selected would
  // still pass the rows above it.
  it('clears the structural floor for every row of the derivation table', () => {
    expect(DERIVATIONS.filter(([text]) => !meetsStructuralFloor(phraseOf(text)))).toStrictEqual([])
  })

  // The distribution the bands are declared against, asserted rather than described. Every one of
  // the five is populated, so no declared band is empty by construction -- which is what isComplete
  // would otherwise turn into a permanently incomplete pack.
  //
  // MEASURED OVER THE WHOLE CORPUS AND NOT ONLY THIS TABLE, which is what the row is worth: across
  // the 140 shipped answers that clear the new floor the derivation runs {1: 52, 2: 30, 3: 14,
  // 4: 17, 5: 27}, so under DIFFICULTY_TOLERANCE = 1 band 2 can use 69% of the pool, band 3 44% and
  // band 5 31%. Band 5 is the thin one and it is thin on purpose -- it is the only band that can
  // take a derived 5, so bestFitIndex protects it.
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

  // Familiarity is REJECTED as a dial and this is what pins it: the same text at familiarity 1 and 5
  // derives identically. A dial computed from `text` survives a night the review call fails, which
  // an obscurity dial does not -- reviewPhrases catches its own errors and returns its input
  // unchanged, so familiarity would default to 3 across the whole batch and one band would starve.
  it('ignores familiarity', () => {
    expect(derivedDifficulty(phraseOf('Snake eyes', 'compact', 1))).toBe(
      derivedDifficulty(phraseOf('Snake eyes', 'compact', 5)),
    )
  })

  // `phrase.shape` is LOGGED AND NEVER GATED, so a structurally compact title is accepted and a
  // mis-tagged compact is not silently starved. The tag is model-authored; gating on it is a gate the
  // model controls.
  it('ignores the shape tag', () => {
    expect(meetsStructuralFloor(phraseOf('Snake eyes', 'title'))).toBe(true)
    expect(derivedDifficulty(phraseOf('Snake eyes', 'title'))).toBe(derivedDifficulty(phraseOf('Snake eyes', 'idiom')))
  })
})
