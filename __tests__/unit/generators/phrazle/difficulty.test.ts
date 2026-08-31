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

  // CONSCIOUSNESS is thirteen letters, over the per-word cap of eleven.
  it('rejects a word above the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Consciousness matters'))).toBe(false)
  })

  it('accepts a word sitting exactly on the per-word cap', () => {
    expect(meetsStructuralFloor(phraseOf('Complicated plan'))).toBe(true)
  })

  // Three words of eleven letters each is 33, over the total cap of 30, with every other clause
  // clear.
  it('rejects a phrase over the total-letter cap', () => {
    expect(meetsStructuralFloor(phraseOf('Complicated exhausting frustrated'))).toBe(false)
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
// REBUILT WITH THE FLOOR, and the rebuild is the point rather than bookkeeping. The old table was
// fifteen two-word phrases graded 2 to 5, which was the entire supply the old bounds admitted -- and
// under the new curve all fifteen sit at 1 or 2, because a two-word phrase of nine letters is no
// longer a hard board when the floor admits six words of thirty. A table that cannot reach 5 cannot
// show band 5 is fillable, which is the one thing it exists to show.
//
// So the long phrases the widened floor was FOR are in it, and the histogram below spans 1 to 5.
const DERIVATIONS: [string, number][] = [
  ['Deep end', 1],
  ['Toe hold', 1],
  ['Hot hand', 1],
  ['Bear hug', 1],
  ['Cold call', 1],
  ['Snake eyes', 1],
  ['Loose ends', 1],
  ['Last straw', 1],
  ['Free fall', 2],
  ['Chip shot', 2],
  ['High noon', 2],
  ['Short fuse', 2],
  ['Blind spot', 2],
  ['Split second', 2],
  ['Back seat driver', 2],
  ['Under the weather', 2],
  ['Out of the blue', 3],
  ['Cut to the chase', 3],
  ['Back to the wall', 3],
  ['Speak of the devil', 4],
  ['Piece of the action', 4],
  ['Knock your socks off', 4],
  ['Jump on the bandwagon', 4],
  ['Let the good times roll', 5],
  ['The proof of the pudding', 5],
  ['Curiosity killed the cat', 5],
  ['Brevity is the soul of wit', 5],
  ['Hit the nail on the head', 5],
  ['Too many cooks spoil the broth', 5],
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

  // The distribution the bands are declared against, asserted rather than described. Every one of
  // the five is populated, so no declared band is empty by construction -- which is what isComplete
  // would otherwise turn into a permanently incomplete pack.
  //
  // THE OLD TABLE COULD NOT DO THIS. It ran {2:1, 3:7, 4:5, 5:2} over fifteen two-word phrases, and
  // its band-5 cell held SPLIT SECOND and BACK SEAT DRIVER -- both of which now derive to 2. Band 5
  // is reached here by phrases of four to six words, which is what a hard board on this game
  // actually is.
  it('populates every band from one to five', () => {
    const histogram = DERIVATIONS.reduce<Record<number, number>>((counts, [text]) => {
      const derived = derivedDifficulty(phraseOf(text))
      return { ...counts, [derived]: (counts[derived] ?? 0) + 1 }
    }, {})

    expect(histogram).toStrictEqual({ 1: 8, 2: 8, 3: 3, 4: 4, 5: 6 })
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
