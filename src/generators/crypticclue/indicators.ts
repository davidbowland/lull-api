import { CrypticDevice } from '../../types'

// Hand-authored, lowercase, whitespace-normalized. NOT in src/assets/ -- that directory holds
// vendored copies from connections-api and nothing else (src/assets/README.md), and a lull-only list
// dropped in there breaks the byte-diffability invariant silently. An asset this repo DERIVES lives
// under data/; an asset this repo AUTHORS lives beside the code that reads it, which is here.
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
    'moulded',
    'muddled',
    'organised',
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
