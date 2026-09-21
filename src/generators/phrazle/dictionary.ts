import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dictionaryPath } from '../../config'

// The guess dictionary, read from a Lambda LAYER rather than imported from src/.
//
// Never top-level-import a word list here: services/packs.ts imports every phrase generator at
// module scope and handlers/get-pack-by-date.ts imports packs.ts, so the bytes would land in the
// public unauthenticated GET's bundle and cold start. `await import()` does not help -- template.yaml
// builds one minified bundle with no code splitting. The list lives in a layer attached to
// CreatePhrasePuzzlesFunction and GetDictionaryFunction only, so the generator and the route read
// the same file out of the same layer version. packs-request-path.test.ts asserts that by spying
// on fs.readFileSync, since `read` below is a default parameter nothing outside can intercept.

// Additive only. Widening the floor grows the asset; narrowing it does not shrink it.
export type DictionaryVersion = 'v1'

// Generated answers are validated against this version, and every later version is a SUPERSET, so
// any client holds every word of every answer ever generated. Without that, the
// packs-first/dictionary-last prefetch order can leave a client with a v2-validated pack and a v1
// list. If it ever binds, advance it to a version older than the retention window.
export const DICTIONARY_CORE_VERSION: DictionaryVersion = 'v1'

// What a FRESH client is told to fetch.
export const DICTIONARY_VERSION: DictionaryVersion = 'v1'

// The served allow-list, at most two members: a bump keeps the previous version served for one
// retention window so a cached device keeps working, which is why DICTIONARY_PATH is a directory.
export const DICTIONARY_VERSIONS: readonly DictionaryVersion[] = Object.freeze(['v1'])

/**
 * Whether an arbitrary string is a served version. The traversal gate: the version segment is
 * checked against the frozen list above BEFORE anything is interpolated into a path.
 */
export const isDictionaryVersion = (value: string): value is DictionaryVersion =>
  (DICTIONARY_VERSIONS as readonly string[]).includes(value)

// The unit seam. DICTIONARY_PATH is the integration seam -- jest.setup-test-env.js points it at
// __tests__/fixtures, which is how suites get a dictionary when isUsablePhrase calls
// getDictionary() with no arguments.
const defaultRead = (version: DictionaryVersion): string => {
  const path = join(dictionaryPath, `${version}.txt`)
  try {
    return readFileSync(path, 'utf8')
  } catch (error: unknown) {
    // Re-thrown with the path in it: the two ways this fires -- a layer that did not attach, and an
    // unset DICTIONARY_PATH -- look identical under a bare ENOENT.
    throw new Error(`Could not read the guess dictionary at ${path}: ${String(error)}`)
  }
}

const texts = new Map<DictionaryVersion, string>()
const sets = new Map<DictionaryVersion, ReadonlySet<string>>()

/**
 * The raw list text for one version, memoized. The route needs these bytes to gzip and the
 * generator needs the Set below: two exports over one read rather than two reads.
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
 * The membership oracle for one version, memoized. The default version makes isUsablePhrase's
 * argument-free call correct; the parameter lets the route and the tests ask for another.
 *
 * Never a display corpus: it must accept OXEN whether or not any puzzle would show it.
 * nouns.ts/verbs.ts/adjectives.ts are the display corpus.
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
