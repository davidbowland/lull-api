import { getRandomSample } from '@utils/random-sample'

describe('getRandomSample', () => {
  const pool = ['a', 'b', 'c', 'd', 'e']

  // A sequence rather than a constant, so the test pins the selection instead of merely proving
  // something was returned.
  const sequence = (values: number[]): (() => number) => {
    let index = 0
    return () => values[index++]
  }

  it('returns the requested number of items', () => {
    expect(getRandomSample(pool, 3, sequence([0, 0, 0]))).toHaveLength(3)
  })

  it('picks by the supplied random source', () => {
    expect(getRandomSample(pool, 2, sequence([0, 0]))).toEqual(['a', 'b'])
  })

  it('picks later items as the random source moves', () => {
    // 0.99 * 5 -> index 4 -> 'e', and 'a' moves into the vacated slot 4.
    // Then 1 + floor(0.99 * 4) -> index 4 again, which now holds that 'a'.
    expect(getRandomSample(pool, 2, sequence([0.99, 0.99]))).toEqual(['e', 'a'])
  })

  // The whole point is knocking the model out of a rut. A sample that repeated a word would waste
  // one of the few seed slots a prompt has room for.
  it('never repeats an item', () => {
    const sample = getRandomSample(pool, 5, sequence([0, 0, 0, 0, 0]))

    expect(new Set(sample).size).toBe(5)
  })

  it('does not mutate the source array', () => {
    const source = [...pool]

    getRandomSample(source, 3, sequence([0.9, 0.5, 0.1]))

    expect(source).toEqual(pool)
  })

  // The word lists are far larger than any sample, so this only guards a future caller that asks
  // for more seeds than a list holds -- which should return everything rather than undefined
  // padding the prompt.
  it('returns the whole pool when asked for more than it holds', () => {
    expect(getRandomSample(pool, 99, sequence([0, 0, 0, 0, 0])).sort()).toEqual(pool)
  })

  it('returns an empty array for an empty pool', () => {
    expect(getRandomSample([], 3, sequence([0]))).toEqual([])
  })

  it('defaults to Math.random', () => {
    expect(getRandomSample(pool, 2)).toHaveLength(2)
  })
})
