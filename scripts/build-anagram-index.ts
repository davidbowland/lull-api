#!/usr/bin/env ts-node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sortedLetters } from '../src/generators/themedanagrams/letters'
import { chargedTerms } from '../src/utils/charged-terms'

// Derives src/generators/themedanagrams/data/anagram-words.ts from the pinned ENABLE corpus.
//
// RUN BY HAND, never on the nightly path, in the mold of scripts/audit-hints.ts: it reads its own
// files, it fails loudly, and nothing in src/ imports it. `--check` re-derives in memory, compares
// against the committed file, writes nothing and exits non-zero on any difference. CI runs the
// `--check` form as a STEP of the existing test job, and that step is the only proof of this type's
// RECALL: the committed asset's own test can prove no entry is wrongly PRESENT, but a word wrongly
// RETAINED because its anagram was dropped by a build bug is by definition not in the list, so an
// intra-list test cannot see it. Precision fails closed; recall fails open. Only re-derivation from
// the source closes the second one.

const DATA_DIRECTORY = join(__dirname, 'data')

export const SOURCE_PATH = join(DATA_DIRECTORY, 'enable.txt')
export const DIGEST_PATH = join(DATA_DIRECTORY, 'enable.sha256')
export const OUTPUT_PATH = join(__dirname, '..', 'src', 'generators', 'themedanagrams', 'data', 'anagram-words.ts')

// The window this type takes onto the oracle, NOT a bound on the oracle. ENABLE covers every length
// and every part of speech; 5-9 is what a scramble is playable at, and the generator's own W3 gate
// restates the same two numbers over the words a model proposes.
export const MIN_WORD_LENGTH = 5
export const MAX_WORD_LENGTH = 9

// A floor on COMMITTED LIST SIZE PER BAND, and deliberately not on drawable supply: the generator
// additionally applies a letter-multiplicity cap and a distinct-permutation floor that this script
// does not, so the real drawable pool at length 5 is smaller than the number asserted here. Stated
// that way because the two diverge exactly where supply is thinnest. A floor that is not asserted is
// a floor nobody checks after the first run.
export const MIN_WORDS_PER_BAND = 1_000

const ENTRY_PATTERN = /^[a-z]+$/

/**
 * Every charged term's anagram class key. Computed once; see the step-4 comment below.
 *
 * `chargedTerms`, never `chargedWords` alone: this filter keys on the EXACT letter
 * multiset of a listed form, so every unlisted inflection is a different key and escapes it whole.
 * NIGGER was listed and NIGGA was not, which is how AGING -- a word that clears every admissibility
 * gate -- shipped its one band-4 acceptable scramble.
 */
const chargedKeys = (): Set<string> => new Set([...chargedTerms].map(sortedLetters))

/**
 * The committed digest, read from its own file rather than held as a literal in this script.
 *
 * Two scripts will read this corpus, and a literal duplicated into each is two pins that can
 * disagree. The file's format is `shasum -a 256` output: the digest, whitespace, the filename.
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
 * The derivation. THE STEP ORDER IS AN INVARIANT, NOT A PREFERENCE.
 *
 * 1. keep entries of 5-9 `a-z` characters -- ANAGRAM-INVARIANT;
 * 2. group on sorted letters and keep classes of size exactly one;
 * 3. THEN drop survivors whose sorted key matches a charged word's, and survivors that are charged
 *    words;
 * 4. return a sorted array, so a regeneration is a reviewable diff rather than a reshuffle.
 *
 * THE BLOCKLIST FILTER RUNS AFTER CLASS SELECTION, NEVER BEFORE. Every filter applied BEFORE
 * grouping must be anagram-invariant, or it can remove one member of a class and leave the other
 * looking unique. Length and charset are anagram-invariant -- anagrams share both -- so they are
 * safe above the grouping. The blocklist is not. Move it up to step 1, the obvious "cheapest filter
 * first" tidy-up, and NIGGER is dropped from a size-2 class, GINGER is then admitted as unique, and
 * a scramble of an admitted answer can land on the word the filter was for. THE REORDER BREAKS THIS
 * TYPE'S CONTENT-SAFETY PROPERTY WITH EVERY TEST STILL GREEN unless one of them plants the
 * collision, which __tests__/unit/scripts/build-anagram-index.test.ts does.
 *
 * Step 3 is BY KEY rather than by membership, and that is what makes it hold whatever the corpus
 * happens to contain. Class-size-one proves no OTHER ENABLE ENTRY shares an admitted word's letters;
 * it proves nothing about a charged word that is absent from ENABLE, which is invisible to a filter
 * that only counts entries. Dropping the whole class makes the letters unreachable rather than the
 * word, so no permutation of an admitted answer can be a charged word.
 *
 * IT IS STILL NOT THE ONLY DEFENSE, AND MUST NEVER BE TREATED AS ONE. This filter covers exactly the
 * forms someone wrote down, in exactly the inflection they wrote. The string a player sees is
 * invented by scramble.ts at generate time out of an answer's letters, so it is checked THERE too --
 * see the charged-scramble gate in src/generators/themedanagrams/scramble.ts. A key filter is a
 * list-completeness bet; a generate-time check is a check. This one earns its place by making the
 * letters unreachable at all, which keeps a doomed word out of the pool instead of burning its
 * attempt budget every night, but it is the cheaper half of a pair.
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

/** Survivors per length band, for the floor below and for the run's own printed output. */
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
 * The generated module text, byte for byte.
 *
 * `.prettierignore` carries this directory, so the format below is the script's and stays the
 * script's -- without that entry `npm run lint` would run `prettier --write` over the output and
 * `--check` would then be comparing the file against something that reformatted it.
 */
export const renderModule = (words: string[]): string =>
  [
    '// GENERATED by scripts/build-anagram-index.ts from scripts/data/enable.txt -- do not edit by hand.',
    '// Source: ENABLE, public domain; license at scripts/data/LICENSE-enable; digest pinned at',
    '// scripts/data/enable.sha256. Regenerate with `npm run build-anagram-index`; CI re-derives with',
    '// `--check` on every push.',
    '//',
    '// Every ENABLE entry of 5-9 letters, a-z only, whose letter multiset is shared by NO other ENABLE',
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

/**
 * Derive, assert the floor, then either write the module or compare it to what is committed.
 *
 * Returns the per-band counts so a caller -- the CLI below, or a test -- can print or assert them.
 */
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
  // Loudly and non-zero, at the entry point rather than inside the body, so every exported function
  // above propagates and stays testable.
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
