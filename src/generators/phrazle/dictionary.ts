import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dictionaryPath } from '../../config'

// The guess dictionary, read from a Lambda LAYER rather than imported from src/.
//
// WHY A LAYER AND NOT A MODULE. services/packs.ts imports generators/index.ts, which imports every
// phrase generator at module scope, and handlers/get-pack-by-date.ts imports packs.ts -- so a
// generator that top-level-imported a word list would ship it into the public, unauthenticated GET's
// deployment package and its cold start, in a function that will never look a word up. `await
// import()` does not save it either: template.yaml builds a single minified bundle with no code
// splitting, so a dynamic import is inlined and the cost is paid anyway. The bytes therefore live in
// a layer attached to CreatePhrasePuzzlesFunction and GetDictionaryFunction and to nothing else, and
// what reaches the GET's bundle is this file: a lazy memoized loader that does no I/O until called.
//
// __tests__/unit/services/packs-request-path.test.ts is the assertion, and it spies on
// fs.readFileSync rather than on an injected stub -- `read` below is a DEFAULT PARAMETER, so nothing
// a test constructs from outside can intercept it, and an assertion over an unwired jest.fn() would
// pass forever.
//
// THE LAYER IS ALSO WHAT MAKES THE LOCKSTEP STRUCTURAL. The generator and the route read the same
// file out of the same layer version, so "the generator validated against a different list than the
// device holds" is not a mistake anyone can make in this repo.

// Closed here, and additive only. Widening the floor grows the asset; narrowing it does not shrink
// it, because the list is append-only.
export type DictionaryVersion = 'v1'

// THREE CONSTANTS WITH THREE JOBS, and one constant read by both cannot survive v2 existing: the
// route serves what a client asks for and the generator validates against the core, which are
// different questions the moment there is more than one file.
//
// A FROZEN CORE. Generated answers are validated against the v1 word set and every later version is
// a SUPERSET, so any client on any version holds every word of every answer ever generated. Without
// that, the packs-first/dictionary-last prefetch order genuinely can leave a client with a
// v2-validated pack and a v1 list. If the core ever binds -- it will not, since answer phrases are
// already restricted to what an ordinary adult recognizes and ENABLE is not the limiting factor --
// the fix is to advance the core to a version older than the retention window.
export const DICTIONARY_CORE_VERSION: DictionaryVersion = 'v1'

// What a FRESH client is told to fetch.
export const DICTIONARY_VERSION: DictionaryVersion = 'v1'

// THE SERVED ALLOW-LIST, and the traversal gate. At most two members: a bump keeps the previous
// version committed and served for one full retention window, so a device cached on v1 keeps working
// while its app updates, and DICTIONARY_PATH is therefore a DIRECTORY rather than a file.
export const DICTIONARY_VERSIONS: readonly DictionaryVersion[] = Object.freeze(['v1'])

/**
 * Whether an arbitrary string is a served version.
 *
 * THE TRAVERSAL GATE. A path parameter reaching a file read unvalidated is an unbounded path, and
 * this one would be a traversal -- so the version segment is compared against the frozen list above
 * BEFORE anything is interpolated into a path, and `../../etc/passwd` never reaches the filesystem.
 */
export const isDictionaryVersion = (value: string): value is DictionaryVersion =>
  (DICTIONARY_VERSIONS as readonly string[]).includes(value)

// The unit seam. DICTIONARY_PATH is the INTEGRATION seam -- jest.setup-test-env.js points it at
// __tests__/fixtures, which is how packs-integration.test.ts and the generator suite get a
// dictionary at all, since isUsablePhrase calls getDictionary() with no arguments and there is no
// injection point between it and bestFitIndex. Both are named so nobody reaches for the wrong one.
const defaultRead = (version: DictionaryVersion): string => {
  const path = join(dictionaryPath, `${version}.txt`)
  try {
    return readFileSync(path, 'utf8')
  } catch (error: unknown) {
    // Re-thrown with the path in it. The bare ENOENT names a file nobody chose by hand, and the two
    // ways this fires -- a layer that did not attach, and a DICTIONARY_PATH that is unset -- look
    // identical without it.
    throw new Error(`Could not read the guess dictionary at ${path}: ${String(error)}`)
  }
}

const texts = new Map<DictionaryVersion, string>()
const sets = new Map<DictionaryVersion, ReadonlySet<string>>()

/**
 * The raw list text for one version, memoized.
 *
 * The ROUTE needs these bytes to gzip and cannot use the Set; the generator needs the Set and cannot
 * use the bytes. Two exports over one read rather than two reads.
 */
export const readDictionary = (version: DictionaryVersion, read: typeof defaultRead = defaultRead): string => {
  const cached = texts.get(version)
  if (cached !== undefined) {
    return cached
  }
  const contents = read(version)
  texts.set(version, contents)
  return contents
}

/**
 * The membership oracle for one version, memoized.
 *
 * The default version is what makes the predicate's argument-free call site correct; the parameter
 * is what makes the route and the tests able to ask for something else.
 *
 * A MEMBERSHIP ORACLE AND NEVER A DISPLAY CORPUS. It must accept OXEN whether or not any puzzle
 * would ever show it. nouns.ts/verbs.ts/adjectives.ts are the display corpus; two lexicons, one job
 * each.
 */
export const getDictionary = (
  version: DictionaryVersion = DICTIONARY_CORE_VERSION,
  read: typeof defaultRead = defaultRead,
): ReadonlySet<string> => {
  const cached = sets.get(version)
  if (cached !== undefined) {
    return cached
  }
  const built: ReadonlySet<string> = new Set(readDictionary(version, read).split('\n').filter(Boolean))
  sets.set(version, built)
  return built
}

/** Drops both memos. For tests; nothing in src/ calls it. */
export const resetDictionaryCache = (): void => {
  texts.clear()
  sets.clear()
}
