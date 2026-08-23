import { MAX_PHRAZLE_RUNG_LENGTH, buildHints } from '@generators/phrazle/hints'

describe('buildHints', () => {
  // Two words: word 0 / word 1 / word 0, and the third rung takes word 0's SECOND letter because the
  // first is already spent. Rungs are strictly increasing in what they reveal.
  it('walks word 0, word 1, then back to word 0 for a two-word answer', () => {
    expect(buildHints('TOE HOLD')).toStrictEqual([
      { metadata: { kind: 'phrazle-reveal', letter: 'T', position: 0, word: 0 }, text: 'Letter 1 of word 1 is T.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'H', position: 0, word: 1 }, text: 'Letter 1 of word 2 is H.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'O', position: 1, word: 0 }, text: 'Letter 2 of word 1 is O.' },
    ])
  })

  // Three words: one rung each, so `k mod wordCount` never repeats a word.
  it('gives one rung to each word of a three-word answer', () => {
    expect(buildHints('BITE THE BULLET')).toStrictEqual([
      { metadata: { kind: 'phrazle-reveal', letter: 'B', position: 0, word: 0 }, text: 'Letter 1 of word 1 is B.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'T', position: 0, word: 1 }, text: 'Letter 1 of word 2 is T.' },
      { metadata: { kind: 'phrazle-reveal', letter: 'B', position: 0, word: 2 }, text: 'Letter 1 of word 3 is B.' },
    ])
  })

  it('builds exactly three rungs', () => {
    expect(buildHints('TOE HOLD')).toHaveLength(3)
  })

  it('tags every rung phrazle-reveal', () => {
    expect(buildHints('BITE THE BULLET').map((hint) => hint.metadata.kind)).toStrictEqual([
      'phrazle-reveal',
      'phrazle-reveal',
      'phrazle-reveal',
    ])
  })

  // THE 1-BASED / 0-BASED RELATION, asserted rather than described, and asserted as the RESTATEMENT
  // rule the HintMetadata union carries: `metadata` says exactly what `text` says and never more. A
  // client treating `word` as 1-based highlights the wrong row while printing the right sentence.
  it.each(['TOE HOLD', 'BITE THE BULLET', 'SPLIT SECOND'])('restates each rung of %s exactly', (answer) => {
    const mismatched = buildHints(answer).filter(
      ({ metadata, text }) =>
        text !== `Letter ${metadata.position + 1} of word ${metadata.word + 1} is ${metadata.letter}.`,
    )

    expect(mismatched).toStrictEqual([])
  })

  // The letter named is the letter AT that position of the canonical answer -- not a letter from
  // somewhere else that happens to match.
  it.each(['TOE HOLD', 'BITE THE BULLET', 'SPLIT SECOND'])(
    'names the letter actually at that position of %s',
    (answer) => {
      const words = answer.split(' ')
      const wrong = buildHints(answer).filter(
        ({ metadata }) => words[metadata.word][metadata.position] !== metadata.letter,
      )

      expect(wrong).toStrictEqual([])
    },
  )

  // No rung repeats a position, so three rungs reveal three distinct tiles.
  it('never reveals the same tile twice', () => {
    const keys = buildHints('TOE HOLD').map(({ metadata }) => `${metadata.word}:${metadata.position}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  // It splits with the ONE splitter, so an answer handed to it in non-canonical form still names the
  // positions the board paints. The generator always hands it the canonical form; this pins that the
  // ladder does not quietly depend on that.
  it('splits with the one splitter', () => {
    expect(buildHints('  toe   hold ')).toStrictEqual(buildHints('TOE HOLD'))
  })

  // The cap this type declares, asserted over the widest board the structural floor admits: three
  // words of seven letters. It is not enforced in the composer -- a fixed template cannot reach
  // anything unbounded -- so this is what makes the 80 in worst-case.ts a fact rather than a hope.
  it('keeps every rung inside the cap this type declares', () => {
    const widest = buildHints('PANTHER LEOPARD CHEETA')

    expect(widest.filter((hint) => hint.text.length > MAX_PHRAZLE_RUNG_LENGTH)).toStrictEqual([])
    expect(MAX_PHRAZLE_RUNG_LENGTH).toBeLessThan(200)
  })
})
