import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Prompt, PromptId, ToolSchema } from '../types'
import { logWarning } from '../utils/logging'
import { parsePromptFile } from '../utils/prompt-file'
import { baseModelId } from '../utils/usage'
import { parseToolPayload } from './bedrock'
import { LocalModelBackend } from './model-backend'

export const MAX_CALL_ATTEMPTS = 3
export const CALL_TIMEOUT_MS = 1_200_000

// The prompt file's own system prompt reaches claude as `contents` on stdin, so this one only
// tells claude to answer through the schema.
export const SYSTEM_PROMPT =
  'Follow the instructions in the user message. Your reply is the input to the tool it names.'

// The tool's description goes with it, as it does on Bedrock: every schema here keeps its elements
// opaque (`items: {}`), so the description is the model's only statement of each element's keys.
export const systemPromptFor = (tool: ToolSchema): string =>
  `${SYSTEM_PROMPT}\n\nThe tool is ${tool.name}: ${tool.description}`

const PROMPT_ID = /^[a-z0-9-]+$/

// Each failure carries its cause, because the progress line is the only place a developer sees it
// without opening the run log.
const MAX_REASON_LENGTH = 200

const failureOf = (name: string, reason: string): string => `${name} (${reason.slice(0, MAX_REASON_LENGTH)})`

export interface ProcessResult {
  exitCode: number | null
  signal?: NodeJS.Signals | null
  stderr: string
  stdout: string
}

export type RunProcess = (
  command: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number },
) => Promise<ProcessResult>

export interface ClaudeEnv {
  CLAUDE_EFFORT?: string
  CLAUDE_MODEL?: string
}

export interface ClaudeBackendOptions {
  env?: ClaudeEnv
  // Returning true stops invoke from starting another try.
  isAborted?: () => boolean
  promptsDir: string
  runProcess?: RunProcess
  workDir: string
}

// `||` rather than `??`: an empty override in .env.local means unset.
export const claudeArgs = (prompt: Prompt, tool: ToolSchema, env: ClaudeEnv): string[] => [
  '-p',
  '--model',
  env.CLAUDE_MODEL || baseModelId(prompt.config.model),
  '--effort',
  env.CLAUDE_EFFORT || prompt.config.thinkingEffort,
  '--tools',
  '',
  '--no-session-persistence',
  // Without these three, every call carries the developer's own CLAUDE.md, hooks, skills and MCP
  // servers into what should be a bare model call. --bare would also drop them but requires an API key.
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--system-prompt',
  systemPromptFor(tool),
  '--output-format',
  'json',
  '--json-schema',
  JSON.stringify({ ...tool.input_schema, description: tool.description }),
]

// The developer's shell carries AWS credentials for the packs table, and may carry a provider switch.
// Either one lets claude reach Bedrock on the developer role, which is the cost this backend replaces.
export const STRIPPED_ENV = [
  'AWS_ACCESS_KEY_ID',
  'AWS_PROFILE',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]

export const childEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !STRIPPED_ENV.includes(name)))

export const runProcess: RunProcess = (command, args, { cwd, input, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      resolve({ exitCode, signal, stderr: Buffer.concat(stderr).toString(), stdout: Buffer.concat(stdout).toString() })
    })
    // A child that exits without reading stdin makes the write fail with EPIPE; 'close' still reports it.
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

const structuredOutput = (tool: ToolSchema, result: ProcessResult): unknown => {
  if (result.exitCode !== 0) {
    throw new Error(`claude -p exited with ${result.signal ? `signal ${result.signal}` : result.exitCode}`)
  }
  const parsed = JSON.parse(result.stdout)
  if (parsed.is_error === true) {
    throw new Error(`claude -p reported an error: ${String(parsed.result).slice(0, 300)}`)
  }
  const structured = parsed.structured_output
  if (structured === undefined) {
    throw new Error('claude -p returned no structured_output')
  }
  parseToolPayload(tool, structured)
  return structured
}

export const createClaudeBackend = ({
  env = process.env,
  isAborted = () => false,
  promptsDir,
  runProcess: run = runProcess,
  workDir,
}: ClaudeBackendOptions): LocalModelBackend => {
  const failures: string[] = []
  let calls = 0

  const runTry = async (prompt: Prompt, tool: ToolSchema, contents: string, base: string): Promise<unknown> => {
    await mkdir(workDir, { recursive: true })
    await writeFile(`${base}.prompt.txt`, contents).catch(() => undefined)
    const cwd = await mkdtemp(join(tmpdir(), 'lull-claude-'))
    let result: ProcessResult = { exitCode: null, stderr: '', stdout: '' }
    let output: unknown
    try {
      result = await run('claude', claudeArgs(prompt, tool, env), { cwd, input: contents, timeoutMs: CALL_TIMEOUT_MS })
      output = structuredOutput(tool, result)
    } catch (error) {
      const failure = { error: (error as Error).message, stderr: result.stderr, stdout: result.stdout }
      // A work file is a debugging aid: failing to write one must not replace the real cause.
      await writeFile(`${base}.response.json`, JSON.stringify(failure, null, 2)).catch(() => undefined)
      throw error
    } finally {
      // A leftover empty directory must not turn a valid answer into another paid call.
      await rm(cwd, { force: true, recursive: true }).catch(() => undefined)
    }
    // Outside the try, so a failed write cannot turn a valid answer into another paid call.
    await writeFile(`${base}.response.json`, result.stdout).catch(() => undefined)
    return output
  }

  const invoke = async (prompt: Prompt, tool: ToolSchema, contents: string): Promise<unknown> => {
    calls += 1
    const sequence = calls
    let lastReason = ''
    for (let attempt = 1; attempt <= MAX_CALL_ATTEMPTS; attempt++) {
      if (isAborted()) {
        failures.push(failureOf(tool.name, 'Run aborted'))
        throw new Error('Run aborted')
      }
      try {
        return await runTry(prompt, tool, contents, join(workDir, `${sequence}-${tool.name}-try-${attempt}`))
      } catch (error) {
        lastReason = (error as Error).message
        logWarning('claude -p try failed', { error: lastReason, toolName: tool.name, try: attempt })
      }
    }
    failures.push(failureOf(tool.name, lastReason))
    throw new Error(`claude -p failed ${MAX_CALL_ATTEMPTS} times for ${tool.name}: ${lastReason}`)
  }

  // Every caller of getPromptById on the review and phrase paths swallows a throw, so the failure is
  // recorded before it is rethrown.
  const loadPrompt = async (promptId: PromptId): Promise<Prompt> => {
    try {
      if (!PROMPT_ID.test(promptId)) {
        throw new Error(`Invalid prompt id: ${promptId}`)
      }
      const prompt = parsePromptFile(await readFile(join(promptsDir, `${promptId}.txt`), 'utf-8'))
      if (typeof prompt.config.model !== 'string' || typeof prompt.config.thinkingEffort !== 'string') {
        throw new Error(`Prompt ${promptId} names no model or thinkingEffort`)
      }
      return prompt
    } catch (error) {
      failures.push(failureOf(`prompt:${promptId}`, (error as Error).message))
      throw error
    }
  }

  return { calls: () => calls, failures: () => [...failures], invoke, loadPrompt }
}
