import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isPromptExamplePhrase, promptExamplePhrases } from '../../../src/assets/prompt-example-phrases'

// Checked against the LIVE prompt, which keeps the list from becoming an arbitrary banlist: every
// entry is a good phrase excluded only because create-phrases.txt shows it to the model.
const PROMPT_PATH = join(__dirname, '..', '..', '..', 'prompts', 'create-phrases.txt')
const prompt = readFileSync(PROMPT_PATH, 'utf8')

describe('promptExamplePhrases', () => {
  // The shrink direction: it fails when an example is edited out of the prompt and left here.
  it.each([...promptExamplePhrases])('%s appears verbatim in the prompt', (phrase) => {
    expect(prompt).toContain(phrase)
  })

  // The grow direction cannot be checked: a regex cannot separate the prompt's examples from its
  // prose, both being emphatic capitals. These two are the leaks that motivated the list.
  it.each(['The Old Man and the Sea', 'Brevity is the soul of wit'])('refuses %s, which shipped', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(true)
  })

  // Keyed on normalizeAnswer, which drops spacing entirely rather than collapsing runs of it, so
  // TEATIME is refused as well as TEA TIME.
  it.each(['tea time', 'TEA  TIME', '  Tea   Time  ', 'TEATIME'])('refuses %s', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(true)
  })

  // The complement. TOE HOLD is the sharper: it left the list when the nine-tile floor made it an
  // illegal Phrazle and the prompt's compact line was rewritten around it.
  it.each(['Barbed wire', 'Toe hold'])('accepts %s, which the prompt does not print', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(false)
  })
})
