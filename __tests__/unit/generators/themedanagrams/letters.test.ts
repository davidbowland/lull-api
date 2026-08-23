import {
  agreements,
  distinctPermutations,
  longestSharedRun,
  maxLetterCount,
  sortedLetters,
} from '@generators/themedanagrams/letters'

describe('sortedLetters', () => {
  it('keys a word on its letters in order', () => {
    expect(sortedLetters('KETTLE')).toEqual('EEKLTT')
  })

  // THE CASE CONTRACT, and it is the reason this function uppercases rather than trusting its
  // caller. The committed list is a-z and every runtime gate in this type runs on toUpperCase(), so
  // a key function that preserved case would put the build script's keys and the generator's keys in
  // disjoint alphabets -- and every lookup would miss, silently, on every word.
  it('gives a word and its uppercase the same key', () => {
    expect(sortedLetters('ginger')).toEqual(sortedLetters('GINGER'))
  })

  // The collision the whole content-safety gate is about, asserted here so the arithmetic behind it
  // is visible in one line rather than only as a consequence three files away.
  it('gives GINGER and NIGGER the same key', () => {
    expect(sortedLetters('GINGER')).toEqual(sortedLetters('NIGGER'))
  })

  it('keys anagrams together and non-anagrams apart', () => {
    expect(sortedLetters('SPATULA')).toEqual(sortedLetters('AUPLATS'))
    expect(sortedLetters('SPATULA')).not.toEqual(sortedLetters('SKILLET'))
  })
})

describe('agreements', () => {
  it('counts positions still holding the answer letter', () => {
    expect(agreements('KETTLE', 'KETTLE')).toEqual(6)
    expect(agreements('KETTLE', 'LTEEKT')).toEqual(0)
  })

  // One transposition of an N-letter word leaves N - 2 agreements, which is the arithmetic that lets
  // the agreement ceiling subsume the catalog's transposition rule.
  it('reads one transposition as length minus two', () => {
    expect(agreements('SPATULA', 'PSATULA')).toEqual(5)
  })

  // THE REASON THIS IS OVER THE STRINGS AND NOT OVER THE PERMUTATION. Exchanging KETTLE's two Ts is
  // a permutation of Cayley distance 1 that produces a string identical to the answer, so a gate
  // keyed on permutation distance is keyed on something no observer can see.
  it('sees a repeated-letter swap as no change at all', () => {
    expect(agreements('KETTLE', 'KETTLE')).toEqual('KETTLE'.length)
  })
})

describe('longestSharedRun', () => {
  it('finds a run at a shifted offset, which agreements cannot see', () => {
    expect(agreements('TOASTER', 'ERTOAST')).toEqual(0)
    expect(longestSharedRun('TOASTER', 'ERTOAST')).toEqual(5)
  })

  it('is 1 when no bigram survives', () => {
    expect(longestSharedRun('KETTLE', 'LTEEKT')).toEqual(1)
  })

  it('is the whole word against itself', () => {
    expect(longestSharedRun('WHISK', 'WHISK')).toEqual(5)
  })
})

describe('distinctPermutations', () => {
  it('divides out repeated letters', () => {
    expect(distinctPermutations('KETTLE')).toEqual(180)
    expect(distinctPermutations('SPATULA')).toEqual(2_520)
    expect(distinctPermutations('WHISK')).toEqual(120)
  })

  // The floor case: 60 is exactly what a five-letter word with one repeated pair can spell, and a
  // five-letter word with TWO repeated pairs has 30 and is rejected.
  it('puts ROBOT at the floor and a two-pair five-letter word below it', () => {
    expect(distinctPermutations('ROBOT')).toEqual(60)
    expect(distinctPermutations('LEVEL')).toEqual(30)
  })

  it('takes any case', () => {
    expect(distinctPermutations('kettle')).toEqual(distinctPermutations('KETTLE'))
  })
})

describe('maxLetterCount', () => {
  it('admits a word with two of a letter and names three of one', () => {
    expect(maxLetterCount('KETTLE')).toEqual(2)
    expect(maxLetterCount('BANANA')).toEqual(3)
    expect(maxLetterCount('WHISK')).toEqual(1)
  })
})
