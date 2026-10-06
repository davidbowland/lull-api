import { Prompt } from '../types'

// A prompt file is a `#`-prefixed JSON config line, then the system prompt. scripts/deploy-prompts.ts
// uploads these files and the local claude backend reads them directly, so both parse through here.
const PROMPT_FILE = /^[\s#]*(?<config>[^\n]+)\s*\n\s+(?<systemPrompt>.*?)\s*$/s

export const splitPromptFile = (content: string): { config?: string; systemPrompt?: string } =>
  PROMPT_FILE.exec(content)?.groups ?? {}

export const parsePromptFile = (content: string): Prompt => {
  const { config, systemPrompt } = splitPromptFile(content)
  if (!config || !systemPrompt) {
    throw new Error('Malformed prompt file: expected a config line followed by the system prompt')
  }
  return { config: JSON.parse(config), contents: systemPrompt }
}
