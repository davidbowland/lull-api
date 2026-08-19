import { goFigureGenerator } from '@generators/gofigure/generator'
import { generators } from '@generators/index'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'

describe('generators', () => {
  it('registers goFigure and Missing Vowels', () => {
    expect(generators).toEqual([goFigureGenerator, missingVowelsGenerator])
  })

  it.each(generators.map((generator) => [generator.type, generator]))(
    'gives %s one difficulty per puzzle',
    (_type, generator) => {
      expect(generator.difficulties).toHaveLength(generator.countPerDay)
    },
  )

  // missingDifficulties compares a Set of present difficulties against this array, so a repeated
  // entry would make one puzzle silently unreachable -- the pack could never be completed.
  it.each(generators.map((generator) => [generator.type, generator]))(
    'gives %s distinct difficulties',
    (_type, generator) => {
      expect(new Set(generator.difficulties).size).toBe(generator.difficulties.length)
    },
  )

  it('registers each type at most once', () => {
    const types = generators.map((generator) => generator.type)

    expect(new Set(types).size).toBe(types.length)
  })
})
