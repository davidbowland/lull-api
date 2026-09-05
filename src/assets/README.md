# Corpus-wide assets

Static data every generator may read, as opposed to an asset one puzzle type owns. A list that only
one type consults does not belong here — see [Where a new asset goes](#where-a-new-asset-goes).

| File                                    | What it is                                                             |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `blocklist.ts`                          | Charged terms, rejected in code rather than in the prompt              |
| `nouns.ts`, `verbs.ts`, `adjectives.ts` | Concreteness-weighted inspiration seeds for the corpus prompt          |
| `LICENSE-brysbaert`                     | CC BY 4.0 attribution for the dataset the three word lists derive from |

## The word lists are generated, not written

`nouns.ts`, `verbs.ts` and `adjectives.ts` are derived by `scripts/build-word-lists.ts` from the
concreteness ratings in:

    Brysbaert, M., Warriner, A.B., & Kuperman, V. (2014). Concreteness ratings for 40 thousand
    generally known English word lemmas. Behavior Research Methods, 46, 904-911.
    https://doi.org/10.3758/s13428-013-0403-5

Used and modified under CC BY 4.0 (`LICENSE-brysbaert`). The corpus is pinned by SHA-256 at
`scripts/data/concreteness-brysbaert-2014.txt`; its provenance, the CRLF footgun, and what the hash
does and does not prove are in `scripts/data/README.md`.

Regenerate with:

    npm run build-word-lists

**To remove a word, add it to `scripts/excluded-seeds.ts` and regenerate.** Editing these files by
hand is silently reverted by the next run, and by CI before that: the derivation is deterministic and
`__tests__/unit/assets/word-lists.test.ts` re-derives all three lists in memory and compares them to
what is committed, byte for byte. That test is the `--check` re-derivation the other generated assets
get from a pipeline step, and it runs in the ordinary test job.

Concreteness, not frequency, is what these are ranked on. Their job is to knock the model out of its
default attractor basins, so `blowtorch` and `stepladder` push somewhere and `way` and `thing` do
not. `scripts/build-word-lists.ts` carries the measured thresholds and the reasoning behind each.

### They are DISPLAYED, not merely prompted with

`nouns.ts` supplies Cryptic Clue's answers directly (`generators/crypticclue/answers.ts`) and seeds
the themed anagram prompt, so a word in these files is a word the game can put on a player's screen
and ask them to spell. Two consequences, both already handled in `scripts/excluded-seeds.ts`:

- American spellings win. `grey` is excluded so `gray` ships; the `TileState` union has said `'gray'`
  since it was written.
- **`greyhound` is correct and stays.** The word is from Old Norse _grey_, has nothing to do with the
  color, and `grayhound` is a misspelling in every dialect. A find-and-replace over "grey" breaks it.

## `blocklist.ts` is the safety screen, and nothing gates on it alone

It is deliberately **not** sent to the model — listing slurs in a generation prompt primes toward the
neighborhood being avoided. It is applied afterward, whole-token and case-insensitive, over every
generated phrase AND over every hint and category that reaches a player — see
`src/utils/model-output-checks.ts`. Never substring-match: ASSESS, COCKTAIL and SCUNTHORPE are
legitimate.

Its 21 entries are singular base forms and whole-token matching has no stemming by design, so on that
file alone FUCKS, BITCHES, FAGGOTS and BASTARDS were all admissible answers and ethnic and disability
slurs were absent at every inflection. **The list every gate reads is `chargedTerms` in
[`src/utils/charged-terms.ts`](../utils/charged-terms.ts)** — this file unioned with the enumerated
closure over it.

`scripts/build-word-lists.ts` screens seeds against `chargedWords` alone, and that is the one place
the narrow list is still read. It leaks: `fucking` and `horseshit` are in the committed word lists
today because neither is a listed base form. Neither can reach a player — `drawAnswers` screens with
`containsChargedWord` and every generated string is checked against `chargedTerms` — but both are
sampled into the inspiration prompt. The fix is a widened filter and a regeneration of two lists, not
a hand edit here.

## Where a new asset goes

Not here, unless every generator can read it.

- An asset this repo **derives** lives at `src/generators/<type>/data/<name>.ts`, with a generated
  header naming its producing script, its source and its license, and a pipeline step re-deriving it
  with `--check`. `src/generators/themedanagrams/data/anagram-words.ts` is the model.
- An asset this repo **authors by hand** lives beside the code that reads it —
  `src/generators/crypticclue/indicators.ts`.
- A build **input** that nothing under `src/` imports lives in `scripts/data/`.

`data/`, never `assets/`, and that is not a style preference. `jest.config.ts` carries `'assets/*'` in
`coveragePathIgnorePatterns`, which is a **regexp, not a glob**: it matches the substring `assets`
anywhere in a path, so `src/generators/<type>/assets/words.ts` would inherit the coverage exemption
silently while `src/generators/<type>/data/words.ts` does not. Naming a directory `assets` anywhere
under `src/` opts out of coverage without a line of config changing.

Coverage is not what protects a derived asset anyway — a committed test proving its contents and a
re-derivation from the pinned source are. Keeping it out of the exempt directory just stops that
argument from being made by accident.
