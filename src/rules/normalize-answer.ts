// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. A stale copy there means the board accepts a slightly different set
// of answers than the corpus was built with -- a UX inconsistency, not a broken pack.
//
// It lives here rather than shipping as data on the puzzle because it runs over free text the
// player invents at play time, which no generator can enumerate in advance.

// Combining marks, stripped after NFD splits an accented character into base + mark. This folds
// the Latin-1 accents a phrase corpus actually produces (CAFÉ, EL NIÑO, NAÏVE) down to letters a
// player can reach from a US keyboard. Characters that do not decompose -- Ø, Æ, ß -- are not
// handled here and are instead kept out of the corpus by the generator, which is the cheaper place
// to enforce it than a lookup table every consumer has to carry.
const COMBINING_MARKS = /[̀-ͯ]/g

const NOT_ALPHANUMERIC = /[^A-Z0-9]/g

/**
 * Canonicalizes a phrase for comparison: uppercase, unaccented, letters and digits only.
 *
 * Spacing is deliberately discarded. Missing Vowels displays a consonant run respaced so the word
 * boundaries lie, so a player who recovers the phrase must not also have to reproduce the real
 * boundaries. A leading article is deliberately NOT discarded -- the displayed consonants already
 * carry it (THE contributes TH), so accepting an answer without it would contradict what the
 * player was shown.
 */
export const normalizeAnswer = (input: string): string =>
  input.normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase().replace(NOT_ALPHANUMERIC, '')
