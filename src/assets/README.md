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
only mechanism holding the two copies together — there is no CI pin here, unlike `src/rules/`,
because these are static data rather than behavior and a drifted word list produces a duller
prompt rather than a wrong puzzle.

The generated headers say "do not edit by hand" and name `scripts/build-word-lists.ts`. **That
script lives in `connections-api` and is not vendored here**, along with the ~4MB Brysbaert source
file and the `excluded-seeds.ts` denylist it reads. To change a list: change it there, regenerate
there, and re-copy. Editing these files in place puts the two repos out of sync silently.

`blocklist.ts` is deliberately **not** sent to the model — listing slurs in a generation prompt
primes toward the neighborhood being avoided. It is applied afterward, whole-token and
case-insensitive, over every phrase in the corpus. Never substring-match: ASSESS, COCKTAIL, and
SCUNTHORPE are legitimate.
