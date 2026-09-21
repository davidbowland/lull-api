#!/usr/bin/env ts-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sortedLetters } from '../src/generators/themedanagrams/letters'
import { chargedTerms } from '../src/utils/charged-terms'

// Derives themedanagrams/data/anagram-words.ts from the pinned ENABLE corpus. Run by hand, never
// nightly. CI runs `--check`, which re-derives in memory and exits non-zero on any difference, and
// is the only proof of recall: a word wrongly retained is not in the asset for a test to find.

const DATA_DIRECTORY = join(__dirname, 'data')

export const SOURCE_PATH = join(DATA_DIRECTORY, 'enable.txt')
export const DIGEST_PATH = join(DATA_DIRECTORY, 'enable.sha256')
export const OUTPUT_PATH = join(__dirname, '..', 'src', 'generators', 'themedanagrams', 'data', 'anagram-words.ts')

// 6-9 is what a scramble is playable at; keep the floor in step with words.ts's W3 gate. Anagrams
// share a length, so a bound is safe above the grouping: it removes whole classes, never members.
export const MIN_WORD_LENGTH = 6
export const MAX_WORD_LENGTH = 9

// Committed list size per band, not drawable supply; the generator's own caps make the pool smaller.
export const MIN_WORDS_PER_BAND = 1_000

const ENTRY_PATTERN = /^[a-z]+$/

/**
 * Anagram class keys for `chargedTerms`, never `chargedWords`: an unlisted inflection is a
 * different multiset and escapes this filter whole.
 */
const chargedKeys = (): Set<string> => new Set([...chargedTerms].map(sortedLetters))

/** The committed digest, in its own file so every reader shares one pin. `shasum -a 256` format. */
export const readPinnedDigest = (digestPath: string = DIGEST_PATH): string => {
  const [digest] = readFileSync(digestPath, 'utf8').trim().split(/\s+/)
  return digest
}

/** The corpus, digest asserted first: a different one would still yield a plausible word list. */
export const readSource = (sourcePath: string = SOURCE_PATH, digestPath: string = DIGEST_PATH): string[] => {
  const contents = readFileSync(sourcePath)
  const digest = createHash('sha256').update(contents).digest('hex')
  const pinned = readPinnedDigest(digestPath)
  if (digest !== pinned) {
    throw new Error(`${sourcePath} does not match its pin: expected ${pinned}, read ${digest}`)
  }
  return contents.toString('utf8').split('\n').filter(Boolean)
}

/**
 * Filter to the length window, group on sorted letters, keep classes of size one, and only THEN
 * drop survivors whose key matches a charged word's; sorted output keeps regeneration reviewable.
 *
 * That order is an invariant: a filter above the grouping must be anagram-invariant, or it removes
 * one member of a class and leaves the other looking unique. Hoist the blocklist as a "cheapest
 * filter first" tidy-up and NIGGER leaves a size-2 class, GINGER is admitted as unique, and a
 * scramble can land on the word the filter was for with every test green unless one plants the
 * collision (__tests__/unit/scripts/build-anagram-index.test.ts does). Matching by key rather than
 * membership also covers charged words absent from ENABLE, but this is half a defense at most --
 * scramble.ts checks the string a player actually sees at generate time.
 */
export const deriveWords = (entries: string[]): string[] => {
  const banded = entries.filter(
    (entry) => entry.length >= MIN_WORD_LENGTH && entry.length <= MAX_WORD_LENGTH && ENTRY_PATTERN.test(entry),
  )

  const classes = new Map<string, string[]>()
  for (const entry of banded) {
    const key = sortedLetters(entry)
    const existing = classes.get(key)
    if (existing === undefined) {
      classes.set(key, [entry])
      continue
    }
    existing.push(entry)
  }

  const blocked = chargedKeys()
  const unique: string[] = []
  for (const [key, members] of classes) {
    if (members.length !== 1 || blocked.has(key)) {
      continue
    }
    unique.push(members[0])
  }

  return unique.sort()
}

/** Survivors per length band, for the floor below and for the run's printed output. */
export const countByBand = (words: string[]): Record<number, number> => {
  const counts: Record<number, number> = {}
  for (let length = MIN_WORD_LENGTH; length <= MAX_WORD_LENGTH; length += 1) {
    counts[length] = 0
  }
  for (const word of words) {
    counts[word.length] += 1
  }
  return counts
}

/** Throws when any band is thinner than the floor. The generator cannot draw from a band that is not there. */
export const assertBandFloor = (counts: Record<number, number>): void => {
  const thin = Object.entries(counts).filter(([, count]) => count < MIN_WORDS_PER_BAND)
  if (thin.length > 0) {
    throw new Error(`Band supply below ${MIN_WORDS_PER_BAND}: ${JSON.stringify(Object.fromEntries(thin))}`)
  }
}

/**
 * The generated module text, byte for byte. The output directory must stay in `.prettierignore`,
 * or lint reformats the committed file and `--check` compares against the reformat.
 */
export const renderModule = (words: string[]): string =>
  [
    '// GENERATED by scripts/build-anagram-index.ts from scripts/data/enable.txt -- do not edit by hand.',
    '// Source: ENABLE, public domain; license at scripts/data/LICENSE-enable; digest pinned at',
    '// scripts/data/enable.sha256. Regenerate with `npm run build-anagram-index`; CI re-derives with',
    '// `--check` on every push.',
    '//',
    '// Every ENABLE entry of 6-9 letters, a-z only, whose letter multiset is shared by NO other ENABLE',
    "// entry, MINUS every entry whose sorted-letter key matches a charged word's. Membership proves the",
    '// two facts this type needs -- the word is a word, and nothing else anagrams to it -- and the key',
    '// filter provides the third, which membership cannot: no permutation of it is a charged word.',
    '//',
    '// IMPORTED ONLY BY src/generators/themedanagrams/lexicon.ts, which is reachable only from',
    '// src/generators/model.ts and therefore only from CreateModelPuzzlesFunction. Nothing lexical may',
    '// reach a Lambda on the read path.',
    'export const uniqueAnagramWords: string[] = [',
    ...words.map((word) => `  '${word}',`),
    ']',
    '',
  ].join('\n')

/** Derive, assert the floor, then write the module or compare it to what is committed. */
export const buildAnagramIndex = (check: boolean): Record<number, number> => {
  const words = deriveWords(readSource())
  const counts = countByBand(words)
  assertBandFloor(counts)

  const rendered = renderModule(words)
  if (check) {
    const committed = readFileSync(OUTPUT_PATH, 'utf8')
    if (committed !== rendered) {
      throw new Error(
        `${OUTPUT_PATH} is not what scripts/build-anagram-index.ts derives from scripts/data/enable.txt. Run \`npm run build-anagram-index\` and commit the result.`,
      )
    }
    return counts
  }

  writeFileSync(OUTPUT_PATH, rendered, 'utf8')
  return counts
}

if (require.main === module) {
  try {
    const check = process.argv.includes('--check')
    const counts = buildAnagramIndex(check)
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    console.log(check ? 'anagram index matches the committed file' : `wrote ${OUTPUT_PATH}`)
    console.log(`${total} words; per band ${JSON.stringify(counts)}`)
  } catch (error: unknown) {
    console.error('Could not build the anagram index', error)
    process.exit(1)
  }
}
