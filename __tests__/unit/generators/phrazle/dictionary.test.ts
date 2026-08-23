import {
  DICTIONARY_CORE_VERSION,
  DICTIONARY_VERSION,
  DICTIONARY_VERSIONS,
  DictionaryVersion,
  getDictionary,
  isDictionaryVersion,
  readDictionary,
  resetDictionaryCache,
} from '@generators/phrazle/dictionary'

const mockRead = jest.fn()

describe('the dictionary version constants', () => {
  // THE ASSERTION THAT CATCHES A BUMP THAT FORGOT ONE OF THE THREE. Three constants with three jobs
  // -- what the generator validates against, what a fresh client is told to fetch, and what the route
  // will serve -- and the superset invariant is what links them. A core or a client version outside
  // the allow-list is a version the route 400s while the generator still validates against it.
  it('serves both the core version and the version a fresh client fetches', () => {
    expect(DICTIONARY_VERSIONS).toContain(DICTIONARY_CORE_VERSION)
    expect(DICTIONARY_VERSIONS).toContain(DICTIONARY_VERSION)
  })

  // At most two: the previous version stays committed and served for one retention window on a bump,
  // and no longer.
  it('serves at most two versions', () => {
    expect(DICTIONARY_VERSIONS.length).toBeLessThanOrEqual(2)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(DICTIONARY_VERSIONS)).toBe(true)
  })
})

describe('isDictionaryVersion', () => {
  it('accepts a served version', () => {
    expect(isDictionaryVersion('v1')).toBe(true)
  })

  it('rejects an unserved version', () => {
    expect(isDictionaryVersion('v9')).toBe(false)
  })

  // THE TRAVERSAL GATE, at the only place that can hold it. The handler compares against this before
  // anything is interpolated into a path.
  it.each(['../../etc/passwd', '../v1', 'v1/../../../etc/passwd', 'v1.txt', ''])('rejects %s', (value) => {
    expect(isDictionaryVersion(value)).toBe(false)
  })
})

describe('readDictionary', () => {
  const setup = (): void => {
    resetDictionaryCache()
    mockRead.mockReturnValue('ALPHA\nBETA\n')
  }

  it('reads the list through the injected reader', () => {
    setup()

    expect(readDictionary('v1', mockRead)).toEqual('ALPHA\nBETA\n')
  })

  // Once per version, and the whole point of it: the route gzips these bytes on a cold start and the
  // predicate builds a Set from them, and neither should pay the read twice.
  it('memoizes the read per version', () => {
    setup()

    readDictionary('v1', mockRead)
    readDictionary('v1', mockRead)

    expect(mockRead).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure from the injected reader', () => {
    resetDictionaryCache()
    mockRead.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(() => readDictionary('v1', mockRead)).toThrow('ENOENT')
  })

  // THE REAL READER'S ERROR PATH, exercised through the default parameter rather than the injected
  // stub -- which is the only way to reach it, and the path that actually fires in production. The
  // message must name the PATH: a bare ENOENT names a file nobody chose by hand, and the two ways
  // this fires -- a layer that did not attach, and an unset DICTIONARY_PATH -- look identical
  // without it. The version is cast because the allow-list is what stops an unserved one reaching
  // here at all; this reaches past that gate deliberately.
  it('names the path it could not read', () => {
    resetDictionaryCache()

    expect(() => readDictionary('v99' as DictionaryVersion)).toThrow(
      /Could not read the guess dictionary at .*fixtures.v99\.txt/,
    )
  })
})

describe('getDictionary', () => {
  const setup = (): void => {
    resetDictionaryCache()
    mockRead.mockReturnValue('ALPHA\nBETA\n')
  }

  it('builds a membership set from the list', () => {
    setup()

    const dictionary = getDictionary('v1', mockRead)

    expect(dictionary.has('ALPHA')).toBe(true)
    expect(dictionary.has('GAMMA')).toBe(false)
  })

  // A trailing newline would otherwise put the empty string in the set, which everyWordInDictionary
  // would then accept as a word.
  it('drops the trailing empty line', () => {
    setup()

    expect(getDictionary('v1', mockRead).has('')).toBe(false)
  })

  it('memoizes the set per version', () => {
    setup()

    const first = getDictionary('v1', mockRead)
    const second = getDictionary('v1', mockRead)

    expect(second).toBe(first)
    expect(mockRead).toHaveBeenCalledTimes(1)
  })

  // The argument-free call site is the predicate's, and the default is what makes it correct.
  it('defaults to the core version', () => {
    setup()

    getDictionary(undefined, mockRead)

    expect(mockRead).toHaveBeenCalledWith(DICTIONARY_CORE_VERSION)
  })

  // Against the real committed fixture list, through the real reader, which is what proves
  // DICTIONARY_PATH is wired at all. Nothing here injects anything.
  it('reads the fixture list DICTIONARY_PATH points at', () => {
    resetDictionaryCache()

    const dictionary = getDictionary()

    expect(dictionary.has('TOE')).toBe(true)
    expect(dictionary.has('HOLD')).toBe(true)
    // Case-sensitive, expecting canonical words. A lookup that lowercased first would be a second
    // normalization rule.
    expect(dictionary.has('toe')).toBe(false)
  })
})
