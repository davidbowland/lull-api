#!/usr/bin/env ts-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_WORD_LETTERS, MIN_WORD_LETTERS } from '../src/generators/phrazle/difficulty'

// Derives layers/dictionary/dictionary/v1.txt -- Phrazle's guess dictionary -- from scripts/data/enable.txt,
// pinned by the committed scripts/data/enable.sha256. Run by hand; `--check` re-derives in memory and
// exits non-zero when the committed file differs.
//
// The filter is lossless: a guess word must match one of the answer's per-word lengths, and the structural
// floor caps an answer word at MIN_WORD_LETTERS..MAX_WORD_LETTERS. v1.txt is served, frozen and additive,
// so narrowing that floor must not re-derive a narrower file and delete words cached clients already hold.

const DATA_DIRECTORY = join(__dirname, 'data')

export const SOURCE_PATH = join(DATA_DIRECTORY, 'enable.txt')
export const DIGEST_PATH = join(DATA_DIRECTORY, 'enable.sha256')
export const OUTPUT_PATH = join(__dirname, '..', 'layers', 'dictionary', 'dictionary', 'v1.txt')

// A floor on committed slice size per band; an empty band is a board that refuses every guess of that
// word length. 90 rather than a rounder number because ENABLE holds only 96 two-letter words in total.
export const MIN_WORDS_PER_BAND = 90

// The committed slice's own length bounds. These must CONTAIN the structural floor's, and may be wider.
export const DICTIONARY_MIN_WORD_LETTERS = 2
export const DICTIONARY_MAX_WORD_LETTERS = 11

const ENTRY_PATTERN = /^[a-z]+$/

/** Throws when the floor has outgrown the committed slice: a board that rejects the player's own answer. */
export const assertContainsFloor = (): void => {
  if (MIN_WORD_LETTERS < DICTIONARY_MIN_WORD_LETTERS || MAX_WORD_LETTERS > DICTIONARY_MAX_WORD_LETTERS) {
    throw new Error(
      `The structural floor (${MIN_WORD_LETTERS}-${MAX_WORD_LETTERS}) is not contained by the committed dictionary ` +
        `(${DICTIONARY_MIN_WORD_LETTERS}-${DICTIONARY_MAX_WORD_LETTERS}). Widen the dictionary bounds and rebuild.`,
    )
  }
}

/** The committed digest. The file's format is `shasum -a 256` output: digest, whitespace, filename. */
export const readPinnedDigest = (digestPath: string = DIGEST_PATH): string => {
  const [digest] = readFileSync(digestPath, 'utf8').trim().split(/\s+/)
  return digest
}

/** The source corpus, one entry per line. Throws -- never warns -- when the digest does not match its pin. */
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
 * Uppercased because everyWordInDictionary is case-sensitive and matches splitPhrase's output; sorted after
 * uppercasing, so the committed order is the order stored. No blocklist filter: this is a membership oracle
 * that must accept any word a player types, and answers are gated upstream by services/phrases.ts.
 */
export const deriveWords = (entries: string[]): string[] =>
  [
    ...new Set(
      entries
        .filter(
          (entry) =>
            entry.length >= DICTIONARY_MIN_WORD_LETTERS &&
            entry.length <= DICTIONARY_MAX_WORD_LETTERS &&
            ENTRY_PATTERN.test(entry),
        )
        .map((entry) => entry.toUpperCase()),
    ),
  ].sort()

export const countByBand = (words: string[]): Record<number, number> => {
  const counts: Record<number, number> = {}
  for (let length = DICTIONARY_MIN_WORD_LETTERS; length <= DICTIONARY_MAX_WORD_LETTERS; length += 1) {
    counts[length] = 0
  }
  for (const word of words) {
    counts[word.length] += 1
  }
  return counts
}

export const assertBandFloor = (counts: Record<number, number>): void => {
  const thin = Object.entries(counts).filter(([, count]) => count < MIN_WORDS_PER_BAND)
  if (thin.length > 0) {
    throw new Error(`Band supply below ${MIN_WORDS_PER_BAND}: ${JSON.stringify(Object.fromEntries(thin))}`)
  }
}

/**
 * Plain text rather than gzip keeps the asset diffable and hashable; the route gzips at first use.
 * `.prettierignore` carries `layers/`, so `npm run lint` cannot reformat what `--check` compares against.
 */
export const renderList = (words: string[]): string => `${words.join('\n')}\n`

export const buildDictionary = (check: boolean): Record<number, number> => {
  assertContainsFloor()
  const words = deriveWords(readSource())
  const counts = countByBand(words)
  assertBandFloor(counts)

  const rendered = renderList(words)
  if (check) {
    const committed = readFileSync(OUTPUT_PATH, 'utf8')
    if (committed !== rendered) {
      throw new Error(
        `${OUTPUT_PATH} is not what scripts/build-dictionary.ts derives from scripts/data/enable.txt. Run \`npm run build-dictionary\` and commit the result.`,
      )
    }
    return counts
  }

  writeFileSync(OUTPUT_PATH, rendered, 'utf8')
  return counts
}

if (require.main === module) {
  // Exit non-zero here rather than inside the body, so every exported function above propagates instead.
  try {
    const check = process.argv.includes('--check')
    const counts = buildDictionary(check)
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    console.log(check ? 'dictionary matches the committed file' : `wrote ${OUTPUT_PATH}`)
    console.log(`${total} words; per band ${JSON.stringify(counts)}`)
  } catch (error: unknown) {
    console.error('Could not build the dictionary', error)
    process.exit(1)
  }
}
