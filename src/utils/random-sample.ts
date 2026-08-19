// Repurposed from connections-api's getRandomSample. Rewritten as an iterative partial
// Fisher-Yates over a copy: the original recurses and mutates its argument, which every caller
// there works around by passing a spread copy. Same selection behavior, one fewer trap.
//
// Its job is seeding the corpus prompt so the model does not settle into a rut. That matters more
// here than in connections, because one prompt supplies a whole night of phrases for three puzzle
// types and an unseeded model returns the same idioms every night.
export const getRandomSample = <T>(array: T[], count: number, random: () => number = Math.random): T[] => {
  const pool = [...array]
  const size = Math.min(count, pool.length)
  const sample: T[] = []

  for (let index = 0; index < size; index++) {
    // Draw from the untouched remainder only, so nothing is picked twice.
    const pick = index + Math.floor(random() * (pool.length - index))
    const value = pool[pick]
    pool[pick] = pool[index]
    sample.push(value)
  }

  return sample
}
