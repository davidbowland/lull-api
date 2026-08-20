import { goFigureGenerator } from '@generators/gofigure/generator'
import { allGenerators, phraseGenerators, selfContainedGenerators } from '@generators/index'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'

describe('generators', () => {
  // The split is by what a generator NEEDS, not by how fast it is: self-contained generators run
  // wherever a pack is built including inside a request, while phrase generators need a model call
  // first and so only ever run in the async builder.
  it('registers goFigure as self-contained and Missing Vowels as phrase-backed', () => {
    expect(selfContainedGenerators).toEqual([goFigureGenerator])
    expect(phraseGenerators).toEqual([missingVowelsGenerator])
  })

  it('exposes every generator for the completeness check', () => {
    expect(allGenerators).toEqual([goFigureGenerator, missingVowelsGenerator])
  })

  it.each(allGenerators.map((generator) => [generator.type, generator]))(
    'gives %s one difficulty per puzzle',
    (_type, generator) => {
      expect(generator.difficulties).toHaveLength(generator.countPerDay)
    },
  )

  // missingDifficulties compares a Set of present difficulties against this array, so a repeated
  // entry would make one puzzle silently unreachable -- the pack could never be completed.
  it.each(allGenerators.map((generator) => [generator.type, generator]))(
    'gives %s distinct difficulties',
    (_type, generator) => {
      expect(new Set(generator.difficulties).size).toBe(generator.difficulties.length)
    },
  )

  it('registers each type at most once', () => {
    const types = allGenerators.map((generator) => generator.type)

    expect(new Set(types).size).toBe(types.length)
  })
})
