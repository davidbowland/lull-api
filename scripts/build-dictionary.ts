#!/usr/bin/env ts-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_WORD_LETTERS, MIN_WORD_LETTERS } from '../src/generators/phrazle/difficulty'

// Derives layers/dictionary/dictionary/v1.txt -- Phrazle's guess dictionary -- from the pinned
// ENABLE corpus.
//
// RUN BY HAND, never on the nightly path, in the mold of scripts/build-anagram-index.ts: it reads
// its own files, it fails loudly, and nothing in src/ imports it. `--check` re-derives in memory,
// compares against the committed file, writes nothing and exits non-zero on any difference. CI runs
// the `--check` form as a STEP of the existing test job.
//
// THE FILTER IS PROVABLY LOSSLESS, which is what distinguishes it from a "trimmed common words" list
// that would reject real words. A guess word must match one of the answer's per-word lengths, and
// the structural floor caps an answer word at MIN_WORD_LETTERS..MAX_WORD_LETTERS -- so a word
// outside that range can never appear in a valid guess. The bounds are IMPORTED from the predicate
// module rather than restated, so the derivation and the floor cannot drift.
//
// THE DIGEST HAS ONE HOME AND IT IS NOT THIS SCRIPT. enable.txt is asserted against the committed
// scripts/data/enable.sha256, exactly as build-anagram-index.ts does it. Two pins that can disagree
// is the same defect as two splitters.

const DATA_DIRECTORY = join(__dirname, 'data')

export const SOURCE_PATH = join(DATA_DIRECTORY, 'enable.txt')
export const DIGEST_PATH = join(DATA_DIRECTORY, 'enable.sha256')
export const OUTPUT_PATH = join(__dirname, '..', 'layers', 'dictionary', 'dictionary', 'v1.txt')

// A floor on COMMITTED SLICE SIZE PER BAND. A band with nothing in it is a board on which no guess
// of that word length can be typed, which presents to the player as the keyboard refusing every
// word. A floor that is not asserted is a floor nobody checks after the first run.
export const MIN_WORDS_PER_BAND = 500

const ENTRY_PATTERN = /^[a-z]+$/

/**
 * The committed digest, read from its own file rather than held as a literal here.
 *
 * The file's format is `shasum -a 256` output: the digest, whitespace, the filename.
 */
export const readPinnedDigest = (digestPath: string = DIGEST_PATH): string => {
  const [digest] = readFileSync(digestPath, 'utf8').trim().split(/\s+/)
  return digest
}

/**
 * The source corpus, one entry per line, with its digest asserted BEFORE anything reads it.
 *
 * THROWS on a mismatch -- never warns, never continues. Everything downstream is a claim about one
 * specific 172,823-entry list; against a different list the claims are unfalsifiable rather than
 * merely wrong, and the output would still look like a word list.
 */
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
 * Length- and charset-filtered, uppercased, deduped, sorted.
 *
 * UPPERCASE because everyWordInDictionary is case-sensitive and expects canonical words: the lookup
 * side is splitPhrase's output, and a loader that lowercased first would be a second normalization
 * rule. SORTED so a regeneration is a reviewable diff rather than a reshuffle -- and sorted AFTER
 * uppercasing, so the committed order is the order of the strings actually stored.
 *
 * NO BLOCKLIST FILTER, and that is deliberate rather than an oversight. This list is a MEMBERSHIP
 * ORACLE, never a display corpus: nothing in it is ever shown to a player, and it must accept a word
 * the player types whether or not any puzzle would show it. What reaches a player is the answer --
 * gated upstream by services/phrases.ts, and re-gated on the composed canonical form by the
 * generator -- and the hint letters, which are single characters. Filtering the oracle would only
 * make the board reject words a player legitimately typed.
 */
export const deriveWords = (entries: string[]): string[] =>
  [
    ...new Set(
      entries
        .filter(
          (entry) => entry.length >= MIN_WORD_LETTERS && entry.length <= MAX_WORD_LETTERS && ENTRY_PATTERN.test(entry),
        )
        .map((entry) => entry.toUpperCase()),
    ),
  ].sort()

/** Survivors per length band, for the floor below and for the run's own printed output. */
export const countByBand = (words: string[]): Record<number, number> => {
  const counts: Record<number, number> = {}
  for (let length = MIN_WORD_LETTERS; length <= MAX_WORD_LETTERS; length += 1) {
    counts[length] = 0
  }
  for (const word of words) {
    counts[word.length] += 1
  }
  return counts
}

/** Throws when any band is thinner than the floor. */
export const assertBandFloor = (counts: Record<number, number>): void => {
  const thin = Object.entries(counts).filter(([, count]) => count < MIN_WORDS_PER_BAND)
  if (thin.length > 0) {
    throw new Error(`Band supply below ${MIN_WORDS_PER_BAND}: ${JSON.stringify(Object.fromEntries(thin))}`)
  }
}

/**
 * One word per line, trailing newline.
 *
 * PLAIN TEXT is what is committed, not gzip: it keeps the asset diffable in review and hashable
 * without decompressing it, and the route gzips at first use and memoizes. `.prettierignore` carries
 * `layers/`, so `npm run lint` cannot reformat what `--check` then compares against.
 */
export const renderList = (words: string[]): string => `${words.join('\n')}\n`

/**
 * Derive, assert the floor, then either write the list or compare it to what is committed.
 *
 * Returns the per-band counts so a caller -- the CLI below, or a test -- can print or assert them.
 */
export const buildDictionary = (check: boolean): Record<number, number> => {
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
  // Loudly and non-zero, at the entry point rather than inside the body, so every exported function
  // above propagates and stays testable.
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
