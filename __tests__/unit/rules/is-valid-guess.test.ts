import { everyWordInDictionary, isValidGuess, splitPhrase } from '@rules/is-valid-guess'

const dictionary: ReadonlySet<string> = new Set(['BEAR', 'CAFE', 'HOLD', 'HUG', 'TOE', 'WRAP'])

describe('splitPhrase', () => {
  // The canonical form is uppercase A-Z words separated by single spaces.
  it('uppercases and splits on single spaces', () => {
    expect(splitPhrase('toe hold')).toStrictEqual(['TOE', 'HOLD'])
  })

  // It splits on RUNS of whitespace, and drops words that normalize to nothing.
  it('collapses runs of whitespace and trims', () => {
    expect(splitPhrase('  toe \t\n  hold  ')).toStrictEqual(['TOE', 'HOLD'])
  })

  it('drops a word that normalizes to nothing', () => {
    expect(splitPhrase('toe -- hold')).toStrictEqual(['TOE', 'HOLD'])
  })

  // normalizeAnswer applied PER WORD, which is the whole reason it is safe to reuse here: the fold
  // is applied inside the split, so every word boundary survives it.
  it('folds accents per word', () => {
    expect(splitPhrase('café au lait')).toStrictEqual(['CAFE', 'AU', 'LAIT'])
  })

  // normalizeAnswer keeps digits (its NOT_ALPHANUMERIC is /[^A-Z0-9]/g), so splitPhrase does too.
  // The structural floor is what rejects a digit-bearing phrase, not this splitter.
  it('keeps digits, because normalizeAnswer does', () => {
    expect(splitPhrase('Catch-22')).toStrictEqual(['CATCH22'])
  })

  it('returns an empty array for an empty input', () => {
    expect(splitPhrase('   ')).toStrictEqual([])
  })
})

describe('everyWordInDictionary', () => {
  it('accepts when every word is a member', () => {
    expect(everyWordInDictionary(['TOE', 'HOLD'], dictionary)).toBe(true)
  })

  it('rejects when one word is missing', () => {
    expect(everyWordInDictionary(['TOE', 'GATSBY'], dictionary)).toBe(false)
  })

  // Case-sensitive and expecting canonical words. The committed slice is uppercase ^[A-Z]+$, and a
  // lookup that lowercased first would be a SECOND normalization rule.
  it('is case-sensitive', () => {
    expect(everyWordInDictionary(['toe'], dictionary)).toBe(false)
  })

  // Array.every is vacuously true on an empty array, so the length check is load-bearing rather
  // than defensive: without it a phrase that split to nothing would clear the dictionary clause.
  it('rejects an empty word list', () => {
    expect(everyWordInDictionary([], dictionary)).toBe(false)
  })
})

// The four conjuncts, each failing INDEPENDENTLY. Clauses 1 and 2 are what make markGuess's step-0
// throw unreachable from a player.
describe('isValidGuess', () => {
  it('accepts a well-formed guess', () => {
    expect(isValidGuess(['TOE', 'HOLD'], [3, 4], dictionary)).toBe(true)
  })

  it('rejects the wrong word count', () => {
    expect(isValidGuess(['TOE'], [3, 4], dictionary)).toBe(false)
  })

  it('rejects a word of the wrong length', () => {
    expect(isValidGuess(['TOE', 'HUG'], [3, 4], dictionary)).toBe(false)
  })

  // Re-checked here even though splitPhrase guarantees it, because this function's contract must
  // not depend on its caller having called the right splitter. The dictionary is stubbed to HOLD
  // the malformed word, so the only clause that can reject it is the charset one.
  it('rejects a word that is not A-Z', () => {
    expect(isValidGuess(['TO3', 'HOLD'], [3, 4], new Set(['TO3', 'HOLD']))).toBe(false)
  })

  it('rejects a word the dictionary lacks', () => {
    expect(isValidGuess(['TOE', 'HOLE'], [3, 4], dictionary)).toBe(false)
  })

  it('rejects everything against an empty dictionary', () => {
    expect(isValidGuess(['TOE', 'HOLD'], [3, 4], new Set())).toBe(false)
  })

  // The degenerate shape the generator's self-check would hit if a phrase split to nothing.
  it('rejects an empty guess against no lengths', () => {
    expect(isValidGuess([], [], dictionary)).toBe(false)
  })
})
