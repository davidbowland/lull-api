#!/usr/bin/env ts-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chargedTerms } from '../src/utils/charged-terms'

// Derives src/generators/crypticclue/data/known-words.ts from the pinned ENABLE corpus.
//
// THE SECOND READER OF ONE PINNED CORPUS, AND IT CREATES NO SECOND COPY. One lexicon, one owner:
// scripts/data/enable.txt, its licence and its digest are committed once and this script joins
// scripts/build-anagram-index.ts against them. The two derive different slices for different jobs --
// that one asks "does any other word share these letters", this one asks "is this fodder token a
// word" -- and neither is the other's superset.
//
// RUN BY HAND, never on the nightly path, in the mould of scripts/audit-hints.ts: it reads its own
// files, it fails loudly, and nothing in src/ imports it. `--check` re-derives in memory, compares
// against the committed file, writes nothing and throws on any difference. CI runs the `--check`
// form as a STEP of the existing test job, and that step is the only proof of this asset's RECALL:
// the committed asset's own test can prove no entry is wrongly PRESENT, and cannot see an entry
// wrongly MISSING, because a missing entry is by definition not in the list.
//
// EVERYTHING IS AN EXPORTED PURE FUNCTION and main() is guarded, because a script that only has a
// main() can only be tested by running it against a 172,823-line file.

const DATA_DIRECTORY = join(__dirname, 'data')

export const SOURCE_PATH = join(DATA_DIRECTORY, 'enable.txt')
export const DIGEST_PATH = join(DATA_DIRECTORY, 'enable.sha256')
export const OUTPUT_PATH = join(__dirname, '..', 'src', 'generators', 'crypticclue', 'data', 'known-words.ts')

// The membership oracle's band. A cryptic FODDER token is an ordinary short word -- `an`, `of`, `to`
// -- so the floor is 2 and NOT the answer band's 4. The recall cost of the floor is named rather
// than discovered: a one-letter fodder token, a bare `a`, is not in ENABLE at all and rejects as
// `unknown-fodder-word`. That is a real clue shape lost, it reads in the log rather than vanishing,
// and it is cheaper than widening an oracle to admit a single character.
//
// The ceiling is 12 because a fodder token longer than that is not a fodder token; it is a runaway
// generation the clue length cap already refuses.
export const MIN_LENGTH = 2
export const MAX_LENGTH = 12

// A floor on the committed list's size, asserted so it stays measured. It is an ORACLE rather than a
// sample: a list that lost most of its entries would reject most fair clues as unknown-fodder-word,
// which reads in the log exactly like a bad model night.
export const MIN_ENTRIES = 100_000

const ENTRY_PATTERN = /^[a-z]+$/

/**
 * The committed digest, read from its own file rather than held as a literal in this script.
 *
 * TWO scripts read this corpus and a literal duplicated into each is two pins that can disagree.
 * The file's format is `shasum -a 256` output: the digest, whitespace, the filename.
 */
export const readPinnedDigest = (digestPath: string = DIGEST_PATH): string => {
  const [digest] = readFileSync(digestPath, 'utf8').trim().split(/\s+/)
  return digest
}

/**
 * The source corpus, one entry per line, with its digest asserted BEFORE anything reads it.
 *
 * THROWS on a mismatch -- never warns, never continues. Everything downstream of this line is a
 * claim about a specific 172,823-entry list; against a different list the claims are unfalsifiable
 * rather than merely wrong, and the output would still look like a word list.
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
 * The derivation: lowercase a-z entries of 2-12 letters, minus every entry that IS a charged term.
 *
 * `chargedTerms`, NEVER the vendored `chargedWords` alone. That list is 21 singular base forms and
 * this filter is exact-token, so on it alone every inflection escapes whole -- the same gap that put
 * a slur on a board once already. utils/charged-terms.ts is the union every gate in this repo reads.
 *
 * WHOLE-TOKEN, never substring -- the rule blocklist.ts has always used, so SCUNTHORPE survives.
 *
 * THERE IS NO SORTED-KEY FILTER HERE AND THAT IS NOT AN OMISSION. Themed Anagrams needs one because
 * the string a player sees is a PERMUTATION its code invents at generate time. This list is read
 * only to answer "is this fodder token a word", and the string a player sees is the clue the model
 * wrote, which is gated as a whole by G4 on its own. A permutation of an entry here never reaches
 * anybody.
 *
 * Sorted and deduped, so a regeneration is a reviewable diff rather than a reshuffle.
 */
export const deriveWords = (entries: string[]): string[] => {
  const charged = new Set([...chargedTerms].map((term) => term.toLowerCase()))
  const kept = entries.filter(
    (entry) =>
      ENTRY_PATTERN.test(entry) && entry.length >= MIN_LENGTH && entry.length <= MAX_LENGTH && !charged.has(entry),
  )
  return [...new Set(kept)].sort()
}

/** Throws when the derived list is too small to be an oracle. */
export const assertEntryFloor = (words: string[]): void => {
  if (words.length < MIN_ENTRIES) {
    throw new Error(`Derived ${words.length} entries, below the ${MIN_ENTRIES} floor`)
  }
}

/**
 * The generated module text, byte for byte.
 *
 * `.prettierignore` carries this directory, so the format below is the script's and stays the
 * script's -- without that entry `npm run lint` would run `prettier --write` over the output and
 * `--check` would then be comparing the file against something that reformatted it.
 */
export const renderModule = (words: string[]): string =>
  [
    '// GENERATED by scripts/build-cryptic-words.ts from scripts/data/enable.txt -- do not edit by hand.',
    '// Source: ENABLE, public domain; licence at scripts/data/LICENSE-enable; digest pinned at',
    '// scripts/data/enable.sha256. Regenerate with `npm run build-cryptic-words`; CI re-derives with',
    '// `--check` on every push.',
    '//',
    '// Every ENABLE entry of 2-12 lowercase letters, minus every entry that IS a charged term. It',
    '// answers ONE question -- is this fodder token a word -- and it is imported by',
    '// src/generators/crypticclue/generator.ts and by nothing else, so nothing lexical is reachable',
    '// from GetPackByDateFunction.',
    'export const knownWords: string[] = [',
    ...words.map((word) => `  '${word}',`),
    ']',
    '',
  ].join('\n')

/**
 * Derive, assert the floor, then either write the module or compare it to what is committed.
 *
 * Returns the derived entry count so a caller -- the CLI below, or a test -- can print or assert it.
 */
export const buildCrypticWords = (check: boolean): number => {
  const words = deriveWords(readSource())
  assertEntryFloor(words)

  const rendered = renderModule(words)
  if (check) {
    const committed = readFileSync(OUTPUT_PATH, 'utf8')
    if (committed !== rendered) {
      throw new Error(
        `${OUTPUT_PATH} is not what scripts/build-cryptic-words.ts derives from scripts/data/enable.txt. Run \`npm run build-cryptic-words\` and commit the result.`,
      )
    }
    return words.length
  }

  writeFileSync(OUTPUT_PATH, rendered, 'utf8')
  return words.length
}

if (require.main === module) {
  // Loudly and non-zero, at the entry point rather than inside the body, so every exported function
  // above propagates and stays testable.
  try {
    const check = process.argv.includes('--check')
    const count = buildCrypticWords(check)
    console.log(check ? 'cryptic word list matches the committed file' : `wrote ${OUTPUT_PATH}`)
    console.log(`${count} entries`)
  } catch (error: unknown) {
    console.error('Could not build the cryptic word list', error)
    process.exit(1)
  }
}
