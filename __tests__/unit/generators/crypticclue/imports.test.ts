import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// leaksAnswerTokens must never run over a cryptic clue, its fodder, or anything containing them: for
// `hidden`, containment IS the acceptance criterion, and for `anagram` the fodder is by construction
// a letter multiset of the answer. It shares a module, a signature and a tokenizer with
// containsAnswerToken and returns the OPPOSITE verdict, so nothing but a rule distinguishes a
// correct call from a catastrophic one.
//
// The ESLint rule catches an IMPORT. This catches a reference of any kind -- a re-export, a dynamic
// require, a string in a comment that becomes a call in the next edit -- and it is the half that
// survives someone disabling the rule inline.
describe('leaksAnswerTokens never reaches this type', () => {
  const directory = join(__dirname, '../../../../src/generators/crypticclue')
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))

  it.each(files)('%s does not reference leaksAnswerTokens', (file) => {
    expect(readFileSync(file, 'utf8').includes('leaksAnswerTokens')).toBe(false)
  })

  // THE POSITIVE CONTROL, and the whole reason this test is not vacuous. An earlier version of this
  // guard named a symbol that had been renamed away, so it asserted the non-presence of something
  // that was never there and would have passed forever over nothing.
  it('is looking for a symbol that exists', () => {
    const gates = readFileSync(join(__dirname, '../../../../src/utils/model-output-checks.ts'), 'utf8')

    expect(gates.includes('leaksAnswerTokens')).toBe(true)
  })

  it('reads at least one source file', () => {
    expect(files.length).toBeGreaterThan(0)
  })
})
