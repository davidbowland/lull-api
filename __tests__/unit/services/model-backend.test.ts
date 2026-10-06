import { prompt } from '../__mocks__'
import { activeModelBackend, ModelBackend, withModelBackend } from '@services/model-backend'

describe('model-backend', () => {
  const backend: ModelBackend = { invoke: jest.fn(), loadPrompt: jest.fn().mockResolvedValue(prompt) }

  it('has no backend outside withModelBackend', () => {
    expect(activeModelBackend()).toBeUndefined()
  })

  it('exposes the backend inside withModelBackend, across awaits', async () => {
    const seen = await withModelBackend(backend, async () => {
      await Promise.resolve()
      return activeModelBackend()
    })

    expect(seen).toBe(backend)
  })

  it('scopes concurrent backends independently', async () => {
    const other: ModelBackend = { invoke: jest.fn(), loadPrompt: jest.fn() }

    const [left, right] = await Promise.all([
      withModelBackend(backend, async () => {
        await Promise.resolve()
        return activeModelBackend()
      }),
      withModelBackend(other, async () => activeModelBackend()),
    ])

    expect(left).toBe(backend)
    expect(right).toBe(other)
  })
})
