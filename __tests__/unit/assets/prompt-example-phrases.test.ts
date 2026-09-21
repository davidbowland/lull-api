import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isPromptExamplePhrase, promptExamplePhrases } from '../../../src/assets/prompt-example-phrases'

// THE LIST AGAINST THE LIVE PROMPT, which is the only thing that keeps it from becoming an
// arbitrary banlist. Every entry names a phrase prompts/create-phrases.txt prints as an
// illustration, and every entry is a GOOD phrase excluded for one reason: the model was shown it in
// the same call it is answering. An entry with no example behind it is a phrase banned for nothing.
//
// Deterministic: one committed file read, no clock, no RNG.
const PROMPT_PATH = join(__dirname, '..', '..', '..', 'prompts', 'create-phrases.txt')
const prompt = readFileSync(PROMPT_PATH, 'utf8')

describe('promptExamplePhrases', () => {
  // THE DIRECTION THAT CAN BE CHECKED. It fails when an example is edited out of the prompt and
  // left here, which is the way this list rots: it grows and never shrinks, and ten releases later
  // it is banning phrases nothing ever showed the model.
  it.each([...promptExamplePhrases])('%s appears verbatim in the prompt', (phrase) => {
    expect(prompt).toContain(phrase)
  })

  // THE DIRECTION THAT CANNOT BE CHECKED, asserted as far as it goes rather than left unsaid. A
  // regex cannot separate the prompt's examples from its prose -- both are written in emphatic
  // capitals, so BITE THE BULLET and SHORT WORDS ARE WELCOME IN THEM are one shape to a matcher --
  // so a NEW example added to the prompt will not redden anything here. What this row does is pin
  // the two leaks that motivated the list, so nobody deletes them believing they were hypothetical:
  // both reached live boards, THE OLD MAN AND THE SEA as a Phrazle on 2026-09-08 and BREVITY IS THE
  // SOUL OF WIT as a Missing Vowels the same day.
  it.each(['The Old Man and the Sea', 'Brevity is the soul of wit'])('refuses %s, which shipped', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(true)
  })

  // Keyed on normalizeAnswer, so case and spacing cannot smuggle one past. It drops spacing
  // entirely rather than collapsing runs of it, which is wider than "the same phrase" and is the
  // right side to err on: a respaced copy of what the model was just shown is the same failure, and
  // TEATIME is refused as well as TEA TIME.
  it.each(['tea time', 'TEA  TIME', '  Tea   Time  ', 'TEATIME'])('refuses %s', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(true)
  })

  // The complement, and both rows matter. BARBED WIRE is a phrase this repo shipped and the prompt
  // has never printed. TOE HOLD is the sharper one: it WAS a compact example until the nine-tile
  // floor made it an illegal Phrazle, the prompt's compact line was rewritten around phrases that
  // clear the floor, and the entry came out of the list with it. That is the shrink direction the
  // row above exists to force.
  it.each(['Barbed wire', 'Toe hold'])('accepts %s, which the prompt does not print', (phrase) => {
    expect(isPromptExamplePhrase(phrase)).toBe(false)
  })
})
