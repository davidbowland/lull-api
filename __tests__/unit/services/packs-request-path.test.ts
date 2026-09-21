import { sep } from 'node:path'

// The central invariant of the dictionary layer: the public, unauthenticated GET must never read
// the guess dictionary. get-pack-by-date.ts imports packs.ts, which imports the registry, which
// imports every phrase generator at module scope, so esbuild cannot shake any of it out and a
// module-scope read would land in that function's package and cold start.
//
// The spy is on fs.readFileSync because that is the only thing that can read the file, and it is
// taken INSIDE the isolated registry: the isolated load gets its own instance of the core module,
// so a spy on a top-level `import * as fs` records zero calls even when the code does read it.
// The liveness control at the bottom of the file is what catches that.
//
// The node_modules filter keeps this counting THIS REPO'S reads: Jest's own machinery lazily
// reads .js and .map files during an isolated require (0 warm, 31 cold), so an unfiltered count
// depends on cache state. Not an extension allow-list, because a module-scope read of a .json or
// .csv corpus is the same violation.
const IGNORED = `${sep}node_modules${sep}`

const readsWhile = (act: (load: (modulePath: string) => unknown) => void): number => {
  jest.resetModules()
  let calls = 0
  jest.isolateModules(() => {
    const fs = require('node:fs')
    const readFileSync = jest.spyOn(fs, 'readFileSync')
    act((modulePath: string) => require(modulePath))
    calls = readFileSync.mock.calls.filter(([path]) => !String(path).includes(IGNORED)).length
    readFileSync.mockRestore()
  })
  return calls
}

describe('the request path', () => {
  // The bundle: everything esbuild reaches from this entry point is in GetPackByDateFunction's
  // artifact.
  it('never touches the filesystem when the public GET handler is imported', () => {
    expect(readsWhile((load) => load('@handlers/get-pack-by-date'))).toBe(0)
  })

  // The registry on its own, so a failure says which layer leaked.
  it('never touches the filesystem when the registry is imported', () => {
    expect(readsWhile((load) => load('@generators/index'))).toBe(0)
  })

  it('never touches the filesystem when the pack service is imported', () => {
    expect(readsWhile((load) => load('@services/packs'))).toBe(0)
  })

  // phrasesNeeded reads the registry, which holds a generator whose predicate reads the
  // dictionary, and the nightly handler calls it before any model call.
  it('never reaches the loader from phrasesNeeded', () => {
    const calls = readsWhile((load) => {
      const { phrasesNeeded } = load('@services/packs') as { phrasesNeeded: () => number }
      phrasesNeeded()
    })

    expect(calls).toBe(0)
  })

  // The liveness control. Negatives over a spy prove nothing unless something in the same run
  // proves the spy can move.
  it('the spy is live: reading the dictionary does touch the filesystem', () => {
    const calls = readsWhile((load) => {
      const { getDictionary, resetDictionaryCache } = load('@generators/phrazle/dictionary') as Record<string, unknown>
      ;(resetDictionaryCache as () => void)()
      ;(getDictionary as () => ReadonlySet<string>)()
    })

    expect(calls).toBeGreaterThan(0)
  })
})
