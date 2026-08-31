import {
  chooseCryptogramRung,
  CryptogramSpentRung,
  cryptogramHintFor,
  MAX_CRYPTOGRAM_RUNG_LENGTH,
} from '@rules/hint-cryptogram'
import {
  choosePhrazleRung,
  MAX_PHRAZLE_RUNG_LENGTH,
  phrazleHintFor,
  PhrazleSpentRung,
  seededRandom,
} from '@rules/hint-phrazle'
import {
  chooseThemedAnagramsRung,
  MAX_ANAGRAM_RUNG_LENGTH,
  themedAnagramsHintFor,
  ThemedAnagramsSpentRung,
} from '@rules/hint-themed-anagrams'

// THE SWEEP IS WHY THESE RULES MAY LIVE IN src/rules AT ALL. lull-api ships none of these hints, so
// nothing else here executes these files; the directory's condition is that this repo runs them.
// It is a TEST rather than a gate in the generators: a hint that does not ship must never be able to
// cost a player a puzzle, and a redraw triggered by an unhappy hint would do exactly that.

const foldCryptogram = (data: { answer: string; ciphertext: string }): string[] => {
  const spent: CryptogramSpentRung[] = []
  for (let rung = 0; rung < 3; rung += 1) {
    const next = chooseCryptogramRung(data, { mapping: {} }, spent)
    if (next === null) break
    spent.push(next)
  }
  return spent.map((rung) => cryptogramHintFor(data, rung).text)
}

const foldPhrazle = (answer: string): string[] => {
  const random = seededRandom(answer)
  const spent: PhrazleSpentRung[] = []
  for (let rung = 0; rung < 3; rung += 1) {
    const next = choosePhrazleRung({ answer }, { guesses: [] }, spent, random)
    if (next === null) break
    spent.push(next)
  }
  return spent.map((rung) => phrazleHintFor({ answer }, rung).text)
}

const foldAnagrams = (answers: string[]): string[] => {
  const entries = answers.map((answer) => ({ answer }))
  const state = { solved: answers.map(() => false) }
  const spent: ThemedAnagramsSpentRung[] = []
  for (let rung = 0; rung < 3; rung += 1) {
    const next = chooseThemedAnagramsRung(entries, state, spent)
    if (next === null) break
    spent.push(next)
  }
  return spent.map((rung) => themedAnagramsHintFor(entries, rung).text)
}

describe('cryptogram sweep', () => {
  // The structural floor and ceiling of a cryptogram phrase, plus a shape with heavy repetition and
  // one with a single word.
  it.each([
    ['short phrase', 'ONE TWO', 'XKA GBH'],
    ['long phrase', 'THE QUICK BROWN FOX JUMPS OVER IT', 'GBS JYRDF NPHZK OHM WYVUL HTSP RG'],
    ['heavy repetition', 'BANANA BANDANA', 'QXKXKX QXKAXKX'],
    ['one word', 'ARROW', 'BEEUZ'],
  ])('builds three capped rungs for a %s', (_case, answer, ciphertext) => {
    const texts = foldCryptogram({ answer, ciphertext })
    expect(texts).toHaveLength(3)
    texts.forEach((text) => {
      expect(text.length).toBeGreaterThan(0)
      expect(text.length).toBeLessThanOrEqual(MAX_CRYPTOGRAM_RUNG_LENGTH)
    })
  })
})

describe('phrazle sweep', () => {
  it.each([
    ['the structural floor', 'ONE TWO'],
    ['a three-word phrase', 'TOP OF THE'],
    ['the long end', 'EXTRAORDINARY THING'],
    ['heavy repetition', 'BANANA STAND'],
    // Chosen to starve rung 2: its letters are almost all common, so the weakest present letters
    // are still fairly strong and the pool is thin.
    ['common letters only', 'RATIO SENATE'],
  ])('builds three capped rungs for %s', (_case, answer) => {
    const texts = foldPhrazle(answer)
    expect(texts).toHaveLength(3)
    texts.forEach((text) => {
      expect(text.length).toBeGreaterThan(0)
      expect(text.length).toBeLessThanOrEqual(MAX_PHRAZLE_RUNG_LENGTH)
    })
  })

  it('draws the same ladder twice from one seed', () => {
    expect(foldPhrazle('TOE HOLD')).toStrictEqual(foldPhrazle('TOE HOLD'))
  })
})

describe('themed anagrams sweep', () => {
  it.each([
    ['the shortest answers', ['KETTLE', 'SKILLET', 'GRATER', 'LADLE']],
    ['the longest answers', ['COLANDER', 'SAUCEPAN', 'SPATULA', 'TOASTER']],
    ['the worst-case shape', ['AAAAAAAAA', 'BBBBBBBBB', 'CCCCCCCCC', 'DDDDDDDDD']],
    ['mixed lengths', ['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA']],
  ])('builds three capped rungs for %s', (_case, answers) => {
    const texts = foldAnagrams(answers as string[])
    expect(texts).toHaveLength(3)
    texts.forEach((text) => {
      expect(text.length).toBeGreaterThan(0)
      expect(text.length).toBeLessThanOrEqual(MAX_ANAGRAM_RUNG_LENGTH)
    })
  })

  it('spreads three rungs across three entries when all four are unsolved', () => {
    const entries = ['KETTLE', 'COLANDER', 'TOASTER', 'SPATULA'].map((answer) => ({ answer }))
    const state = { solved: [false, false, false, false] }
    const spent: ThemedAnagramsSpentRung[] = []
    for (let rung = 0; rung < 3; rung += 1) {
      spent.push(chooseThemedAnagramsRung(entries, state, spent) as ThemedAnagramsSpentRung)
    }
    expect(new Set(spent.map((rung) => rung.entryIndex)).size).toBe(3)
  })
})
