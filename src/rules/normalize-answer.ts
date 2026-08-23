// Shared rule. This file is copied byte-identical into lull-ui, so it must stay pure: no AWS SDK,
// no Node built-ins, no imports at all. It compiles in a Lambda bundle and in a Next.js bundle.
//
// Nothing checks that the two copies match. Change it here, then copy this file and its tests into
// lull-ui in the same sitting. A stale copy there means the board accepts a slightly different set
// of answers than the corpus was built with -- a UX inconsistency, not a broken pack.
//
// It lives here rather than shipping as data on the puzzle because it runs over free text the
// player invents at play time, which no generator can enumerate in advance.

// Combining marks, stripped after NFD splits an accented character into base + mark, so that the
// Latin-1 accents a phrase corpus actually produces (CAFÉ, EL NIÑO, NAÏVE) fold down to letters a
// player can reach from a US keyboard. Characters that do not decompose -- Ø, Æ, ß -- are not
// handled here and are instead kept out of the corpus by the generator, which is the cheaper place
// to enforce it than a lookup table every consumer has to carry.
//
// THIS REPLACE IS INERT TODAY AND IS KEPT ANYWAY, said out loud because the paragraph above reads
// like it is what makes CAFE work and it is not. NOT_ALPHANUMERIC keeps only [A-Z0-9] and no
// combining mark is in that set, so the last replace already removes every one of them. Deleting
// this regex changes nothing: checked over the whole U+0300-U+036F block against every ASCII
// letter, 5,808 pairs, zero differences, and all 23 tests in normalize-answer.test.ts stay green.
// That is why no test below pins it, and why none can.
//
// It stays for one reason and only this one: it performs the fold at the step where the fold
// happens. Whoever widens the keep-set -- to admit a hyphen, an apostrophe, a space -- widens it in
// NOT_ALPHANUMERIC, and on that day this line becomes the thing that stops a-plus-mark from
// surviving as two characters. Belt and braces with the reason written down, rather than deleted
// and rediscovered, or left in place reading like a guard the tests defend.
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
 *
 * NOT Phrazle's comparison rule, and the qualifier matters rather than softening the rule. Phrazle
 * shows the TRUE word lengths, so applying this to a whole phrase would erase the boundaries that
 * ARE the board and would accept TOEHOLD for TOE HOLD. It IS applied per word, inside
 * is-valid-guess.ts's splitPhrase, which preserves every boundary: the prohibition is on the
 * phrase-level comparison, not on the fold. Duplicating the fold there instead would put two copies
 * of a Unicode rule in one repo, which is the drift this directory exists to bound.
 */
export const normalizeAnswer = (input: string): string =>
  input.normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase().replace(NOT_ALPHANUMERIC, '')
