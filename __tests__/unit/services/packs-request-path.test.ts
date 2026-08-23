import { sep } from 'node:path'

// THE ONLY TEST PROTECTING THE CENTRAL INVARIANT of the dictionary layer: the public,
// unauthenticated GET must never read the guess dictionary. services/packs.ts imports the registry,
// the registry imports every phrase generator at module scope, and handlers/get-pack-by-date.ts
// imports packs.ts -- so esbuild cannot shake any of it out, and a module-scope read would land in
// that function's deployment package and its cold start, in a function that will never look a word
// up.
//
// IT SPIES ON fs.readFileSync, WHICH IS THE ONLY THING THAT CAN ACTUALLY READ THE FILE. An earlier
// draft of this assertion built a bare `const read = jest.fn()`, wired it into nothing, and asserted
// it was never called -- which passes unconditionally, forever, including on the day someone adds a
// module-scope readFileSync to the loader. The injection point works against that form:
// getDictionary(version, read = defaultRead) is a DEFAULT PARAMETER, so nothing constructed from
// outside can intercept it.
//
// THE SPY IS TAKEN INSIDE THE ISOLATED REGISTRY, and that is not a style choice -- it is the
// difference between an instrument and a decoration. Measured on this checkout: a spy taken on a
// top-level `import * as fs from 'node:fs'` and asserted after jest.resetModules() +
// jest.isolateModules() records ZERO calls even when the module under test really does read the file
// (0 with a reset, 0 without one, against 1 for a spy taken inside the isolated registry). The
// isolated load gets its own instance of the core module, so every negative assertion built on the
// outer binding would have been green whatever the code did. That was caught here by the liveness
// control below failing, not by reasoning.
//
// PROVED TO GO RED. Adding a module-scope `readFileSync(join(dictionaryPath, 'v1.txt'), 'utf8')` to
// src/generators/phrazle/dictionary.ts reddens all three negatives; the break was run, watched, and
// reverted.
// IT COUNTS THIS REPO'S READS, NOT EVERY READ IN THE PROCESS, and that distinction is the whole
// difference between a green suite and a green suite that means something. The spy sees `readFileSync`
// for the entire worker, and Jest's own machinery -- jest-runner, jest-circus, the source-map
// support behind every stack trace -- lazily reads its own .js and .map files during an isolated
// `require`. On a WARM module cache those internals are already loaded and the count is 0; clear the
// cache, or edit any file in the graph so the transform is recomputed, and the same unchanged source
// reads 31. Measured both ways on this checkout, and the 31 were all `.js` and `.map` under
// node_modules with nothing from src/ among them.
//
// So the unfiltered count was load-bearing on cache state, which is not a property of the code under
// test -- a test that passes today and fails tomorrow, which is the one thing CLAUDE.md forbids
// outright. It is NOT a timing flake and no timer is involved: it fails identically on an idle
// machine.
//
// THE FILTER IS `node_modules`, DELIBERATELY NOT AN ALLOW-LIST OF EXTENSIONS. `.txt` would pass the
// liveness control below and read as the right answer, while quietly excusing a module-scope read of
// a .json corpus or a .csv -- the invariant is that THIS REPO'S CODE reads nothing at import, and
// the file's extension is not what makes it a violation. Anything under node_modules is a dependency
// this repo did not write and esbuild bundles rather than reads at runtime; everything else counts.
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
  // The BUNDLE, which is what the invariant is actually about: everything esbuild reaches from this
  // entry point is in GetPackByDateFunction's artifact.
  it('never touches the filesystem when the public GET handler is imported', () => {
    expect(readsWhile((load) => load('@handlers/get-pack-by-date'))).toBe(0)
  })

  // And the registry on its own, so a failure says WHICH layer leaked rather than only that
  // something did.
  it('never touches the filesystem when the registry is imported', () => {
    expect(readsWhile((load) => load('@generators/index'))).toBe(0)
  })

  it('never touches the filesystem when the pack service is imported', () => {
    expect(readsWhile((load) => load('@services/packs'))).toBe(0)
  })

  // phrasesNeeded reads the registry, which now holds a generator whose predicate reads a
  // 51,852-word file, and it is called by the nightly handler BEFORE any model call. isComplete and
  // missingDifficulties are module-private and are covered by the handler import above, which is the
  // graph they live in.
  it('never reaches the loader from phrasesNeeded', () => {
    const calls = readsWhile((load) => {
      const { phrasesNeeded } = load('@services/packs') as { phrasesNeeded: () => number }
      phrasesNeeded()
    })

    expect(calls).toBe(0)
  })

  // THE LIVENESS CONTROL, and it is the assertion that found the bug in this file's first draft.
  // Negatives over a spy prove nothing unless something in the same run proves the spy can move.
  it('the spy is live: reading the dictionary does touch the filesystem', () => {
    const calls = readsWhile((load) => {
      const { getDictionary, resetDictionaryCache } = load('@generators/phrazle/dictionary') as Record<string, unknown>
      ;(resetDictionaryCache as () => void)()
      ;(getDictionary as () => ReadonlySet<string>)()
    })

    expect(calls).toBeGreaterThan(0)
  })
})
