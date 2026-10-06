import { AsyncLocalStorage } from 'node:async_hooks'

import { Prompt, PromptId, ToolSchema } from '../types'

// Replaces the Bedrock call and the prompts-table read for whatever runs inside withModelBackend.
// Scoped to the async call chain, like utils/usage.ts's tracker, because the model calls sit under
// generators, batch helpers and reviewers that share no signature. Nothing in a Lambda installs one.
export interface ModelBackend {
  // Returns the tool input, before decodeStringifiedArguments and schema validation.
  invoke: (prompt: Prompt, tool: ToolSchema, contents: string) => Promise<unknown>
  loadPrompt: (promptId: PromptId) => Promise<Prompt>
}

// A backend for one local chain attempt. `failures` exists because reviewPhrases, reviewClues and
// generatePhrases swallow a failed call and return their input, so the caller cannot see the throw.
export interface LocalModelBackend extends ModelBackend {
  calls: () => number
  failures: () => string[]
}

const activeBackend = new AsyncLocalStorage<ModelBackend>()

export const withModelBackend = <T>(backend: ModelBackend, work: () => Promise<T>): Promise<T> =>
  activeBackend.run(backend, work)

export const activeModelBackend = (): ModelBackend | undefined => activeBackend.getStore()
