import { CrypticDevice } from '../../types'

// Hand-authored, lowercase, whitespace-normalized. NOT in src/assets/ -- that directory holds the
// corpus-wide lists every generator reads, and `jest.config.ts` exempts it from coverage with the
// REGEXP `assets/*`, which matches that substring anywhere in a path (src/assets/README.md). An
// asset this repo DERIVES lives under a generator's data/; an asset this repo AUTHORS lives beside
// the code that reads it, which is here.
//
// A closed list is right here for the INVERSE of the reason a derived list is right for the
// membership oracle: a MISSING indicator is a logged rejection -- loud, and it costs one candidate
// out of eight -- while a WRONG indicator is a shipped unsolvable clue, silent, and it costs the
// player the puzzle.
//
// Multi-word entries are matched as token SEQUENCES, never substrings -- the same rule
// assets/blocklist.ts has always used, so `part of` matches as two adjacent tokens and INSIDER does
// not match INSIDE.
//
// NO SINGLE-TOKEN ENTRY MAY BE A MEMBER OF CONNECTIVES, and indicators.test.ts asserts it. `in`,
// `part`, `some` and `held` are struck for that reason: the two sets meet the same token list from
// opposite sides -- one as a seam, one as a device signal -- and an entry on both makes one clue
// decomposable two ways. Bare `in` was unusable anyway once parts are located as token sequences.
//
// The recall cost of that is one line and it is priced: `Dance in instant angora` no longer has a
// declared indicator and rejects as `no-indicator`. The prompt carries both lists, so that is an
// INSTRUCTION-FOLLOWING failure rather than a silent one, which is this decision's whole asymmetry.
//
// THE LIST GROWS BY READING REJECTION LOGS -- every `no-indicator` line carries the offending token.
// That is a bounded, measurable operation, and it is the reason this gate is allowed to be strict.
export const crypticIndicators: Record<CrypticDevice, ReadonlySet<string>> = {
  // Roughly sixty against `hidden`'s sixteen, and the asymmetry is the subject matter rather than
  // effort: real anagram indicators are open-ended by design -- any word suggesting disorder
  // qualifies -- while containment indicators are a short closed family.
  anagram: new Set([
    'adapted',
    'adjusted',
    'altered',
    'amended',
    'arranged',
    'assembled',
    'awful',
    'awkward',
    'battered',
    'bent',
    'broken',
    'built',
    'changed',
    'chaotic',
    'churned',
    'clumsy',
    'confused',
    'cooked',
    'crushed',
    'damaged',
    'dancing',
    'disordered',
    'disturbed',
    'doctored',
    'edited',
    'engineered',
    'fashioned',
    'faulty',
    'floating',
    'flustered',
    'fluttering',
    'foolish',
    'formed',
    'grinding',
    'ground',
    'jumbled',
    'kneaded',
    'loose',
    'mangled',
    'mashed',
    'messy',
    'milled',
    'mixed',
    'modified',
    'molded',
    'muddled',
    'organized',
    'processed',
    'rebuilt',
    'redesigned',
    'reformed',
    'remade',
    'reworked',
    'ruined',
    'shaken',
    'shattered',
    'shifting',
    'shuffled',
    'shuffling',
    'sorted',
    'spoiled',
    'stirred',
    'tangled',
    'terrible',
    'tortured',
    'transformed',
    'troubled',
    'twisted',
    'unruly',
    'unsettled',
    'upset',
    'wild',
    'worked',
    'wrecked',
  ]),
  hidden: new Set([
    'amid',
    'among',
    'buried',
    'concealed',
    'contains',
    'covers',
    'found in',
    'held by',
    'hidden',
    'hidden in',
    'hiding',
    'holds',
    'inside',
    'part of',
    'some of',
    'within',
  ]),
}

// The subset of crypticIndicators whose PLAIN ENGLISH ALREADY NAMES THE DEVICE, so a device rung
// over one of them is a restatement rather than a hint. "Bird hidden in sharpen guinea" answered
// with "the wordplay is a hidden word" spends a rung and hands back a word already on the player's
// screen. hints.ts reads this to drop that rung and pull the rest of the pool up one.
//
// A SUBSET, and hints.test.ts asserts it: an entry here that is not an indicator for its device
// is a rung dropped over a token the verifier would never admit, which fails silently and forever.
//
// `anagram` IS EMPTY, and that is why this is keyed by device rather than flattened to one set. No
// anagram indicator says "anagram": `shaken` signals disorder to a solver who already reads
// cryptics and reads as pure surface to the player this ladder is for, so the anagram device rung
// earns its place on every clue. Collapsing the empty entry away to "simplify" reintroduces the bug
// this table fixes, for the device that never had it.
//
// THE FIVE HIDDEN INDICATORS DELIBERATELY LEFT OFF -- amid, among, contains, covers, holds -- read
// as ordinary prepositions and verbs. They signal containment to an experienced solver and nothing
// at all to a beginner, so the mechanism sentence is still worth a rung beside them.
//
// The complement of this rule is in hints.ts and the two are load-bearing together: the definition
// rung drops on a one-word definition, whose position the player can only infer once they have
// found the indicator. When the indicator is TELLING they have found it, so both rungs may go; when
// it is not, this rung survives and names the mechanism they need to go looking.
export const tellingIndicators: Record<CrypticDevice, ReadonlySet<string>> = {
  anagram: new Set<string>(),
  hidden: new Set([
    'buried',
    'concealed',
    'found in',
    'held by',
    'hidden',
    'hidden in',
    'hiding',
    'inside',
    'part of',
    'some of',
    'within',
  ]),
}
