import { splitPhrase } from '@rules/is-valid-guess'

import { derivedDifficulty, meetsStructuralFloor, sharedLetterCount, wordsOf } from '@generators/phrazle/difficulty'
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

// Each clause failing INDEPENDENTLY: every phrase below clears the other three.
describe('meetsStructuralFloor', () => {
  it('accepts a two-word compact', () => {
    expect(meetsStructuralFloor(phraseOf('Toe hold'))).toBe(true)
  })

  it('accepts a three-word compact', () => {
    expect(meetsStructuralFloor(phraseOf('Bite the bullet'))).toBe(true)
  })

  // THE HEADSTONE OF THE DELETED CROSS-WORD-SHARING CLAUSE. An earlier draft rejected this phrase on
  // the ground that "below this no purple tile can ever appear", which is false: purple depends on
  // the GUESS, and mark-guess.test.ts ships GRAB HUE against it producing two purples. This row goes
  // red if anyone re-adds the clause.
  it('accepts an answer whose words share no letter', () => {
    expect(meetsStructuralFloor(phraseOf('Bear hug'))).toBe(true)
  })

  it('rejects a single word', () => {
    expect(meetsStructuralFloor(phraseOf('Toehold'))).toBe(false)
  })

  it('rejects four words', () => {
    expect(meetsStructuralFloor(phraseOf('One two three four'))).toBe(false)
  })

  it('rejects a word below the per-word floor', () => {
    expect(meetsStructuralFloor(phraseOf('An eagle'))).toBe(false)
  })

  // PREJUDICE is nine letters, over the per-word cap. Eight or more will not fit beside a second
  // word on a 320 viewport.
  it('rejects a word above the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Pride prejudice'))).toBe(false)
  })

  // Three words of seven letters each is 21, over the total cap, with every other clause clear.
  it('rejects a phrase over the total-letter cap', () => {
    expect(meetsStructuralFloor(phraseOf('Panther leopard cheetah'))).toBe(false)
  })

  // The canonicality clause. IT'S A WRAP canonicalizes to ITS A WRAP, whose first word is three
  // letters rather than four -- a difference that would put the shipped board out of step with what
  // the floor measured. Rejected rather than silently stripped, so code never composes a
  // player-visible string the upstream content gates did not see.
  it('rejects a phrase whose text is not already canonical', () => {
    expect(meetsStructuralFloor(phraseOf('Catch-22 rules'))).toBe(false)
  })

  it('accepts a phrase whose only non-canonical feature is spacing and case', () => {
    expect(meetsStructuralFloor(phraseOf('  toe   hold '))).toBe(true)
  })

  it('rejects an empty phrase', () => {
    expect(meetsStructuralFloor(phraseOf('   '))).toBe(false)
  })
})

// The reachability check made a rule, run and reported. Both declared bands must be reachable from
// the prompt's own compact examples, or packs.ts's isComplete turns a permanently incomplete pack.
//
// Under DIFFICULTY_TOLERANCE = 1: band 3 takes 13 of these 15, band 5 takes 7 of 15, and two derive
// to 5 exactly -- so bestFitIndex spends the narrow ones where they are the only option.
const DERIVATIONS: [string, number][] = [
  ['Deep end', 2],
  ['Toe hold', 3],
  ['Hot hand', 3],
  ['Bear hug', 3],
  ['Cold call', 3],
  ['Snake eyes', 3],
  ['Loose ends', 3],
  ['Last straw', 3],
  ['Free fall', 4],
  ['Chip shot', 4],
  ['High noon', 4],
  ['Short fuse', 4],
  ['Blind spot', 4],
  ['Split second', 5],
  ['Back seat driver', 5],
]

describe('derivedDifficulty', () => {
  it.each(DERIVATIONS)('derives %s to %i', (text, difficulty) => {
    expect(derivedDifficulty(phraseOf(text))).toBe(difficulty)
  })

  // Every one of the fifteen clears the floor. That is the supply the deleted sharing clause was
  // taking a fifth out of, and two of the three it rejected derive to 4 -- inside band 5's window.
  it('clears the structural floor for every row of the derivation table', () => {
    expect(DERIVATIONS.filter(([text]) => !meetsStructuralFloor(phraseOf(text)))).toStrictEqual([])
  })

  // The distribution the bands are declared against, asserted rather than described. Under
  // DIFFICULTY_TOLERANCE = 1 band 3 reaches 13 of the 15 and band 5 reaches 7, so neither declared
  // band is empty by construction -- which is what isComplete would otherwise turn into a
  // permanently incomplete pack.
  it('puts both declared bands within reach of the table', () => {
    const histogram = DERIVATIONS.reduce<Record<number, number>>((counts, [text]) => {
      const derived = derivedDifficulty(phraseOf(text))
      return { ...counts, [derived]: (counts[derived] ?? 0) + 1 }
    }, {})

    expect(histogram).toStrictEqual({ 2: 1, 3: 7, 4: 5, 5: 2 })
  })

  // The clamp at the top end: three words, thirteen letters, nothing shared -> 5 + 1 - 0 = 6.
  it('clamps above five', () => {
    expect(derivedDifficulty(phraseOf('Rhythm gulp fix'))).toBe(5)
  })

  // Familiarity is REJECTED as a dial and this is what pins it: the same text at familiarity 1 and 5
  // derives identically. A dial computed from `text` survives a night the review call fails, which
  // an obscurity dial does not -- reviewPhrases catches its own errors and returns its input
  // unchanged, so familiarity would default to 3 across the whole batch and one band would starve.
  it('ignores familiarity', () => {
    expect(derivedDifficulty(phraseOf('Toe hold', 'compact', 1))).toBe(
      derivedDifficulty(phraseOf('Toe hold', 'compact', 5)),
    )
  })

  // `phrase.shape` is LOGGED AND NEVER GATED, so a structurally compact title is accepted and a
  // mis-tagged compact is not silently starved. The tag is model-authored; gating on it is a gate the
  // model controls.
  it('ignores the shape tag', () => {
    expect(meetsStructuralFloor(phraseOf('Toe hold', 'title'))).toBe(true)
    expect(derivedDifficulty(phraseOf('Toe hold', 'title'))).toBe(derivedDifficulty(phraseOf('Toe hold', 'idiom')))
  })
})
