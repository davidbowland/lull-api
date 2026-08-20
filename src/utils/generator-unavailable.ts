// Marks an error raised by a generator that cannot produce ANY puzzle right now, as distinct from
// one draw failing.
//
// The two are handled differently on purpose. `createPack` catches around each `generate` call so
// one bad draw costs one puzzle rather than the whole type -- but that rule assumes the next call
// might succeed. A generator with no corpus stored will fail identically for every difficulty, so
// running the loop anyway means `countPerDay` redundant reads and `countPerDay` ERROR log lines
// for one condition. With Missing Vowels that is four of each per request, multiplied by the eight
// dates `usePrefetch` walks.
//
// It is also not an ERROR. "No corpus has ever been stored" is a bootstrap state on a fresh stack,
// and `CreateCorpusFunction` already logs an ERROR when its own run fails -- so alarming here too
// pages twice for one cause, and pages on the consequence rather than the fault.
//
// A tagged Error rather than a subclass: eslint-plugin-functional forbids classes in this repo.
// The tag is also sturdier than `instanceof` would be, since it survives the error crossing a
// bundle boundary where two copies of a class would not compare equal.
const TAG = 'generatorUnavailable'

interface TaggedError extends Error {
  [TAG]?: true
}

export const generatorUnavailable = (message: string): TaggedError =>
  Object.assign(new Error(message), { [TAG]: true as const })

// A type predicate rather than a plain boolean, so the caller can read `.message` off the narrowed
// error without casting `unknown` at the log site.
export const isGeneratorUnavailable = (error: unknown): error is TaggedError =>
  error instanceof Error && (error as TaggedError)[TAG] === true
