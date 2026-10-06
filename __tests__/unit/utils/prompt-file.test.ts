import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { parsePromptFile, splitPromptFile } from '@utils/prompt-file'

describe('prompt-file', () => {
  const promptsDir = join(__dirname, '../../../prompts')

  it.each(readdirSync(promptsDir))('parses %s with a model and an effort', (file) => {
    const parsed = parsePromptFile(readFileSync(join(promptsDir, file), 'utf-8'))

    expect(parsed.config.model).toEqual(expect.any(String))
    expect(parsed.config.thinkingEffort).toEqual(expect.any(String))
    expect(parsed.contents.length).toBeGreaterThan(0)
  })

  it('splits the config line from the body', () => {
    expect(splitPromptFile('# {"a":1}\n\n  body text  \n')).toEqual({ config: '{"a":1}', systemPrompt: 'body text' })
  })

  it('throws on a file with no body', () => {
    expect(() => parsePromptFile('# {"a":1}')).toThrow('Malformed prompt file')
  })

  it('throws on a file with no config line', () => {
    expect(() => parsePromptFile('\n\n')).toThrow('Malformed prompt file')
  })

  it('throws on an invalid config line', () => {
    expect(() => parsePromptFile('# {not json\n\n body\n')).toThrow(SyntaxError)
  })

  it('accepts a file with no trailing newline', () => {
    expect(parsePromptFile('# {"a":1}\n\n body').contents).toBe('body')
  })
})
