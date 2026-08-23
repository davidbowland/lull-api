# Vendored assets

These files are **copies from `connections-api`, not originals**. Both projects share them the way
the system design describes: "whichever project builds it first shares the output with the other,
the same way both share `blocklist.ts`."

| File                                    | Source of truth                                          | Purpose                                                       |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `blocklist.ts`                          | `connections-api/src/assets/blocklist.ts`                | Charged terms, rejected in code rather than in the prompt     |
| `nouns.ts`, `verbs.ts`, `adjectives.ts` | `connections-api/src/assets/{nouns,verbs,adjectives}.ts` | Concreteness-weighted inspiration seeds for the corpus prompt |
| `LICENSE-brysbaert`                     | `connections-api/scripts/data/LICENSE`                   | CC BY 4.0 attribution anchor for the word lists               |

**Copied byte-identical, deliberately.** Keeping them diffable against `connections-api` is the
only mechanism holding the two copies together. Nothing in CI pins them — and nothing pins
`src/rules/` either, whatever an earlier version of this sentence claimed: see
`src/rules/normalize-answer.ts`, which says so about its own lull-ui copy in its own words. What
differs is the cost of drift, not the guard: these are static data rather than behavior, and a
drifted word list produces a duller prompt rather than a wrong puzzle.

The generated headers say "do not edit by hand" and name `scripts/build-word-lists.ts`. **That
script lives in `connections-api` and is not vendored here**, along with the ~4MB Brysbaert source
file and the `excluded-seeds.ts` denylist it reads. To change a list: change it there, regenerate
there, and re-copy. Editing these files in place puts the two repos out of sync silently.

## Known drift: American spellings

Two entries were changed here rather than upstream, so this directory is **no longer byte-identical
to `connections-api`** and a naive re-copy will silently revert them:

| File            | `connections-api` | here      |
| --------------- | ----------------- | --------- |
| `adjectives.ts` | `grey`            | `gray`    |
| `nouns.ts`      | `whisky`          | `whiskey` |

These are not decoration. `nouns.ts` and `adjectives.ts` are the **display** corpus — `nouns.ts`
supplies Cryptic Clue's answers directly (`generators/crypticclue/answers.ts`) and seeds the themed
anagram prompt — so `GREY` was a word this game showed a player and asked them to spell. Lull ships
American English; the `TileState` union has said `'gray'` since it was written.

`gray` also moved one line up: these lists are sorted, and `gray` sorts before `greasy` where `grey`
sorted after `green`.

**`greyhound` in `nouns.ts` is correct and was deliberately left alone.** It is the American
spelling too — the word is from Old Norse _grey_, has nothing to do with the color, and
`grayhound` is a misspelling in every dialect. The bus company is American and spells it
`Greyhound`. A find-and-replace over "grey" breaks this word; do not let one run unattended here.

**The real fix is upstream.** Change these in `connections-api`, regenerate, re-copy, and delete
this section.

`blocklist.ts` is deliberately **not** sent to the model — listing slurs in a generation prompt
primes toward the neighborhood being avoided. It is applied afterward, whole-token and
case-insensitive, over every generated phrase AND over every hint and category that reaches a
player -- see `src/utils/model-output-checks.ts`. Never substring-match: ASSESS, COCKTAIL, and
SCUNTHORPE are legitimate.

**Nothing gates on `blocklist.ts` directly any more, and nothing should.** Its 21 entries are singular
base forms, and whole-token matching has no stemming by design — so on that file alone FUCKS,
BITCHES, FAGGOTS and BASTARDS were all admissible answers, and ethnic and disability slurs were
absent at every inflection. The list every gate reads is `chargedTerms` in
[`src/utils/charged-terms.ts`](../utils/charged-terms.ts): this file unioned with the inflections and
categories it never carried, kept **outside** this directory precisely because of the rule below.
When `connections-api` adopts those terms, add them there, regenerate, re-copy, and delete the
duplicates from `charged-terms.ts` — do not widen the copy here.

## This directory is closed to originals

These files are copies from `connections-api`, and that sentence is a universal claim about the
directory rather than a description of what happens to be in it. A lull-original here does not merely
add a row: it falsifies the sentence that gives every _other_ file its integrity story.
"Byte-identical to `connections-api`" and "regenerate with `--check` in CI" are two different
integrity mechanisms, and a directory that claims both has neither.

**An asset this repo derives lives beside the code that reads it** — `src/generators/<type>/data/<name>.ts`
— with a generated header naming its producing script, its source and its license. Build _inputs_ that
are never imported from `src/` live in `scripts/data/`.

The first such asset is `src/generators/themedanagrams/data/anagram-words.ts`, derived by
`scripts/build-anagram-index.ts` from `scripts/data/enable.txt` — the public-domain ENABLE word list,
license at `scripts/data/LICENSE-enable` and SHA-256 pinned at `scripts/data/enable.sha256`. CI
re-derives it with `npm run build-anagram-index -- --check` on every push, which is the mechanism a
locally-derived file has in place of "byte-identical to `connections-api`".

`data/`, never `assets/`, and that is not a style preference. `jest.config.ts` carries `'assets/*'` in
`coveragePathIgnorePatterns`, which is a **regexp, not a glob**: it matches the substring `assets`
anywhere in a path, so `src/generators/<type>/assets/words.ts` would inherit the coverage exemption
silently while `src/generators/<type>/data/words.ts` does not. Naming a directory `assets` anywhere
under `src/` opts out of coverage without a line of config changing.

Coverage is not what protects a derived asset anyway — a committed test proving its contents and a CI
`--check` re-derivation are. Keeping it out of the exempt directory just stops that argument from
being made by accident.
