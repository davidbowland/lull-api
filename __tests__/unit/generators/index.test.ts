import { goFigureGenerator } from '@generators/gofigure/generator'
import { generators } from '@generators/index'

describe('generators', () => {
  it('registers goFigure', () => {
    expect(generators).toEqual([goFigureGenerator])
  })

  it.each(generators.map((generator) => [generator.type, generator]))(
    'gives %s one difficulty per puzzle',
    (_type, generator) => {
      expect(generator.difficulties).toHaveLength(generator.countPerDay)
    },
  )

  it('registers each type at most once', () => {
    const types = generators.map((generator) => generator.type)

    expect(new Set(types).size).toBe(types.length)
  })
})
