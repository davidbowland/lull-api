// HAZARD: this file is hand-copied into the sibling lull-ui repo and nothing verifies the copies
// match. Keep it dependency-free -- no Node built-ins, no SDK, no imports -- so it compiles in both
// a Lambda and a Next.js bundle, and copy it and its tests over in the same sitting as any change.
//
// It lives here rather than shipping as data on the puzzle because it runs over free text the
// player invents at play time, which no generator can enumerate in advance.

// Combining marks, stripped after NFD splits an accented character into base + mark, so the accents
// a phrase corpus produces (CAFÉ, EL NIÑO, NAÏVE) fold to letters reachable from a US keyboard.
// Characters that do not decompose -- Ø, Æ, ß -- are kept out of the corpus by the generator.
//
// Inert while NOT_ALPHANUMERIC keeps only [A-Z0-9], which already drops every mark. It stays
// because widening that keep-set to admit a hyphen, apostrophe or space makes this line the thing
// that stops a-plus-mark surviving as two characters.
const COMBINING_MARKS = /[̀-ͯ]/g

const NOT_ALPHANUMERIC = /[^A-Z0-9]/g

/**
 * Canonicalizes a phrase for comparison: uppercase, unaccented, letters and digits only.
 *
 * Spacing is discarded because Missing Vowels respaces the consonant run so the word boundaries lie;
 * a player who recovers the phrase must not also reproduce the real boundaries. A leading article is
 * kept -- the displayed consonants already carry it (THE contributes TH).
 *
 * Not Phrazle's phrase comparison: Phrazle shows the true word lengths, so folding a whole phrase
 * would accept TOEHOLD for TOE HOLD. It is applied per word inside splitPhrase, which preserves
 * every boundary.
 */
export const normalizeAnswer = (input: string): string =>
  input.normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase().replace(NOT_ALPHANUMERIC, '')
