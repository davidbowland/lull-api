import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { prompt, toolSchema } from '../__mocks__'
import {
  CALL_TIMEOUT_MS,
  childEnv,
  claudeArgs,
  createClaudeBackend,
  MAX_CALL_ATTEMPTS,
  ProcessResult,
  runProcess,
  SYSTEM_PROMPT,
} from '@services/claude-cli'
import { Prompt } from '@types'
import { logWarning } from '@utils/logging'

jest.mock('@utils/logging')

describe('claude-cli', () => {
  const scratch = join(tmpdir(), `claude-cli-test-${process.pid}`)
  const promptsDir = join(scratch, 'prompts')
  const workRoot = join(scratch, 'work')
  const sonnetPrompt: Prompt = {
    config: { ...prompt.config, model: 'us.anthropic.claude-sonnet-5-5', thinkingEffort: 'low' },
    contents: prompt.contents,
  }
  const payload = { phrases: ['a', 'b'] }
  const succeeded: ProcessResult = { exitCode: 0, stderr: '', stdout: JSON.stringify({ structured_output: payload }) }
  const noStructuredOutput: ProcessResult = { exitCode: 0, stderr: '', stdout: JSON.stringify({ result: 'hi' }) }
  const crashed: ProcessResult = { exitCode: 1, stderr: 'boom', stdout: '' }
  const mockRunProcess = jest.fn()

  // Each test gets its own work directory so file assertions never see another test's output.
  const backendIn = (name: string, isAborted?: () => boolean) => {
    const workDir = join(workRoot, name)
    return {
      backend: createClaudeBackend({ env: {}, isAborted, promptsDir, runProcess: mockRunProcess, workDir }),
      workDir,
    }
  }

  beforeAll(() => {
    mkdirSync(promptsDir, { recursive: true })
    writeFileSync(
      join(promptsDir, 'create-x.txt'),
      '# {"anthropicVersion":"v","maxTokens":10,"model":"us.anthropic.claude-sonnet-5-5","thinkingEffort":"low"}\n\nDo it: ${context}\n',
    )
    writeFileSync(join(promptsDir, 'broken.txt'), '# {"a":1}')
    writeFileSync(join(promptsDir, 'no-effort.txt'), '# {"model":"m"}\n\nDo it.\n')
    mockRunProcess.mockResolvedValue(succeeded)
  })

  afterAll(() => {
    rmSync(scratch, { force: true, recursive: true })
  })

  describe('claudeArgs', () => {
    it('uses the base model id, the prompt effort, no tools and the tool schema', () => {
      expect(claudeArgs(sonnetPrompt, toolSchema, {})).toEqual([
        '-p',
        '--model',
        'claude-sonnet-5-5',
        '--effort',
        'low',
        '--tools',
        '',
        '--no-session-persistence',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--system-prompt',
        `${SYSTEM_PROMPT}\n\nThe tool is submit_data: Submit the data.`,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify({ ...toolSchema.input_schema, description: 'Submit the data.' }),
      ])
    })

    it('lets the environment override the model and effort', () => {
      const args = claudeArgs(sonnetPrompt, toolSchema, { CLAUDE_EFFORT: 'high', CLAUDE_MODEL: 'opus' })
      expect(args.slice(1, 5)).toEqual(['--model', 'opus', '--effort', 'high'])
    })

    it('treats an empty override as unset', () => {
      const args = claudeArgs(sonnetPrompt, toolSchema, { CLAUDE_EFFORT: '', CLAUDE_MODEL: '' })
      expect(args.slice(1, 5)).toEqual(['--model', 'claude-sonnet-5-5', '--effort', 'low'])
    })
  })

  describe('invoke', () => {
    it('returns structured_output from a fresh temp dir that is removed afterwards', async () => {
      const cwdExistedDuringCall: boolean[] = []
      mockRunProcess.mockImplementationOnce(async (_command, _args, options) => {
        cwdExistedDuringCall.push(existsSync(options.cwd))
        return succeeded
      })
      const { backend, workDir } = backendIn('success')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'the contents')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(1)
      expect(mockRunProcess).toHaveBeenCalledWith('claude', claudeArgs(sonnetPrompt, toolSchema, {}), {
        cwd: expect.stringContaining('lull-claude-'),
        input: 'the contents',
        timeoutMs: CALL_TIMEOUT_MS,
      })
      expect(cwdExistedDuringCall).toEqual([true])
      expect(existsSync(mockRunProcess.mock.calls[0][2].cwd)).toBe(false)
      expect(readFileSync(join(workDir, '1-submit_data-try-1.prompt.txt'), 'utf-8')).toBe('the contents')
      expect(readFileSync(join(workDir, '1-submit_data-try-1.response.json'), 'utf-8')).toBe(succeeded.stdout)
      expect(backend.calls()).toBe(1)
      expect(backend.failures()).toEqual([])
    })

    it('retries a non-zero exit and records the failure in the work file', async () => {
      mockRunProcess.mockResolvedValueOnce(crashed)
      const { backend, workDir } = backendIn('retry')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(2)
      expect(JSON.parse(readFileSync(join(workDir, '1-submit_data-try-1.response.json'), 'utf-8'))).toEqual({
        error: 'claude -p exited with 1',
        stderr: 'boom',
        stdout: '',
      })
      expect(existsSync(join(workDir, '1-submit_data-try-2.response.json'))).toBe(true)
      expect(logWarning).toHaveBeenCalledWith('claude -p try failed', {
        error: 'claude -p exited with 1',
        toolName: 'submit_data',
        try: 1,
      })
      expect(existsSync(mockRunProcess.mock.calls[0][2].cwd)).toBe(false)
      expect(backend.calls()).toBe(1)
      expect(backend.failures()).toEqual([])
    })

    it('names the signal when the child is killed', async () => {
      mockRunProcess.mockResolvedValueOnce({ exitCode: null, signal: 'SIGTERM', stderr: '', stdout: '' })
      const { backend } = backendIn('signal')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(logWarning).toHaveBeenCalledWith('claude -p try failed', {
        error: 'claude -p exited with signal SIGTERM',
        toolName: 'submit_data',
        try: 1,
      })
    })

    it('counts a result claude flags as an error as a failed try', async () => {
      const flagged = { is_error: true, result: 'overloaded', structured_output: payload }
      mockRunProcess.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: JSON.stringify(flagged) })
      const { backend } = backendIn('is-error')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(2)
    })

    it('returns a valid answer even when its work file cannot be written', async () => {
      const { backend, workDir } = backendIn('unwritable')
      mkdirSync(join(workDir, '1-submit_data-try-1.response.json'), { recursive: true })

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(1)
    })

    it('fails after three tries with no structured_output', async () => {
      mockRunProcess
        .mockResolvedValueOnce(noStructuredOutput)
        .mockResolvedValueOnce(noStructuredOutput)
        .mockResolvedValueOnce(noStructuredOutput)
      const { backend } = backendIn('no-structured-output')

      await expect(backend.invoke(sonnetPrompt, toolSchema, 'c')).rejects.toThrow(
        'claude -p failed 3 times for submit_data: claude -p returned no structured_output',
      )
      expect(mockRunProcess).toHaveBeenCalledTimes(MAX_CALL_ATTEMPTS)
      expect(backend.failures()).toEqual([expect.stringMatching(/^submit_data \(.+\)$/)])
    })

    it('counts a schema-invalid structured_output as a failed try', async () => {
      const invalid = { exitCode: 0, stderr: '', stdout: JSON.stringify({ structured_output: { nope: 1 } }) }
      mockRunProcess.mockResolvedValueOnce(invalid)
      const { backend, workDir } = backendIn('schema-invalid')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(2)
      expect(readFileSync(join(workDir, '1-submit_data-try-1.response.json'), 'utf-8')).toContain(
        'failed schema validation',
      )
    })

    it('counts stdout that is not JSON as a failed try', async () => {
      mockRunProcess.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'not json' })
      const { backend } = backendIn('not-json')

      expect(await backend.invoke(sonnetPrompt, toolSchema, 'c')).toEqual(payload)
      expect(mockRunProcess).toHaveBeenCalledTimes(2)
    })

    it('fails after three rejected runs and records the tool', async () => {
      const timedOut = new Error(`claude -p timed out after ${CALL_TIMEOUT_MS}ms`)
      mockRunProcess.mockRejectedValueOnce(timedOut).mockRejectedValueOnce(timedOut).mockRejectedValueOnce(timedOut)
      const { backend, workDir } = backendIn('timeout')

      await expect(backend.invoke(sonnetPrompt, toolSchema, 'c')).rejects.toThrow('timed out')
      expect(mockRunProcess).toHaveBeenCalledTimes(MAX_CALL_ATTEMPTS)
      expect(backend.failures()).toEqual([expect.stringMatching(/^submit_data \(.+\)$/)])
      expect(JSON.parse(readFileSync(join(workDir, '1-submit_data-try-3.response.json'), 'utf-8'))).toEqual({
        error: timedOut.message,
        stderr: '',
        stdout: '',
      })
    })

    it('numbers each invoke on the same backend', async () => {
      const { backend, workDir } = backendIn('sequence')

      await backend.invoke(sonnetPrompt, toolSchema, 'first')
      await backend.invoke(sonnetPrompt, toolSchema, 'second')
      expect(readFileSync(join(workDir, '2-submit_data-try-1.prompt.txt'), 'utf-8')).toBe('second')
      expect(backend.calls()).toBe(2)
    })

    it('starts no further try once the run is aborted', async () => {
      mockRunProcess.mockResolvedValueOnce(crashed)
      const isAborted = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
      const { backend } = backendIn('aborted-mid', isAborted)

      await expect(backend.invoke(sonnetPrompt, toolSchema, 'c')).rejects.toThrow('Run aborted')
      expect(mockRunProcess).toHaveBeenCalledTimes(1)
      expect(backend.failures()).toEqual([expect.stringMatching(/^submit_data \(.+\)$/)])
    })

    it('spawns nothing when the run is already aborted', async () => {
      const { backend } = backendIn('aborted-up-front', () => true)

      await expect(backend.invoke(sonnetPrompt, toolSchema, 'c')).rejects.toThrow('Run aborted')
      expect(mockRunProcess).not.toHaveBeenCalled()
      expect(backend.calls()).toBe(1)
      expect(backend.failures()).toEqual([expect.stringMatching(/^submit_data \(.+\)$/)])
    })
  })

  describe('loadPrompt', () => {
    it('reads and parses the prompt file', async () => {
      const { backend } = backendIn('load')

      expect(await backend.loadPrompt('create-x')).toEqual({
        config: {
          anthropicVersion: 'v',
          maxTokens: 10,
          model: 'us.anthropic.claude-sonnet-5-5',
          thinkingEffort: 'low',
        },
        contents: 'Do it: ${context}',
      })
      expect(backend.failures()).toEqual([])
    })

    it.each([
      ['../etc', 'Invalid prompt id'],
      ['broken', 'Malformed prompt file'],
      ['missing', 'ENOENT'],
      ['no-effort', 'names no model or thinkingEffort'],
    ])('records a loadPrompt failure for %s', async (promptId, message) => {
      const { backend } = backendIn(`load-${promptId}`)

      await expect(backend.loadPrompt(promptId)).rejects.toThrow(message)
      expect(backend.failures()).toEqual([expect.stringContaining(`prompt:${promptId} (`)])
    })
  })

  describe('childEnv', () => {
    it('drops AWS credentials and provider switches and keeps everything else', () => {
      expect(
        childEnv({
          AWS_ACCESS_KEY_ID: 'a',
          AWS_PROFILE: 'p',
          AWS_REGION: 'us-east-1',
          AWS_SECRET_ACCESS_KEY: 's',
          AWS_SESSION_TOKEN: 't',
          CLAUDE_CODE_USE_BEDROCK: '1',
          CLAUDE_CODE_USE_VERTEX: '1',
          HOME: '/home/dev',
          PATH: '/bin',
        }),
      ).toEqual({ AWS_REGION: 'us-east-1', HOME: '/home/dev', PATH: '/bin' })
    })
  })

  describe('runProcess', () => {
    it('passes stdin to the child and returns its stdout', async () => {
      expect(
        await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
          cwd: tmpdir(),
          input: 'hi',
          timeoutMs: 10_000,
        }),
      ).toEqual({ exitCode: 0, signal: null, stderr: '', stdout: 'hi' })
    })

    it('rejects when the command does not exist', async () => {
      await expect(
        runProcess('definitely-not-a-command-lull', [], { cwd: tmpdir(), input: '', timeoutMs: 10_000 }),
      ).rejects.toThrow('ENOENT')
    })

    it('kills a child that outlives the timeout', async () => {
      await expect(
        runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
          cwd: tmpdir(),
          input: '',
          timeoutMs: 50,
        }),
      ).rejects.toThrow('claude -p timed out after 50ms')
    })
  })
})
