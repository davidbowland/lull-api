# Lull — System Design

Scope: the first four puzzle types — **goFigure, Missing Vowels, Cryptogram, Phrazle** — and the
shell that carries them. Type definitions live in
[2026-08-17-lull-game-catalog.md](./2026-08-17-lull-game-catalog.md); this document covers
architecture. Later types plug into the contract defined here without changing it.

## Principles

1. **Offline first.** Waiting rooms have bad signal. Everything is generated nightly in batch and
   on the device before it is wanted. On-demand generation is not merely expensive here — it does
   not work.
2. **The UI is a display-only representation of what the backend controls.** No game rule is
   authored in `lull-ui`. Content, difficulty, selection, and answers all come from the backend.
   The single exception is enumerated in [Shared rules](#shared-rules) and enforced in CI.
3. **No account, no server-side player state.** Progress lives in the installed PWA. Uninstalled,
   the app is stateless.
4. **The shelf is never empty.** Per-type generation failures are isolated. Tier A types need no
   model and cannot fail for content reasons.

A consequence to accept up front: **offline means the answer is on the device.** Anti-cheat is not
achievable and is not designed for. This is already true of connections-ui, where the full grid
sits in `localStorage`.

## Repos

| Repo | Contents |
| --- | --- |
| `lull-api` | SAM. Nightly generators, pack API, dictionary endpoint, `src/rules/` (source of truth) |
| `lull-ui` | Next.js + HeroUI PWA. Shell, per-type components, vendored `src/rules/` |
| `lull-infrastructure` | Deployment bucket, IAM roles, mirroring `connections-infrastructure` |

Build order is goFigure → Missing Vowels → Cryptogram → Phrazle. Each step adds exactly one new
thing: goFigure proves the pipeline with no dependencies, Missing Vowels introduces the phrase
corpus against the simplest possible consumer, Cryptogram reuses that corpus with a harder UI, and
Phrazle adds the dictionary and the only on-device algorithm.

---

## Generation pipeline

### Taken from connections-api

**Verbatim:**

- `src/assets/blocklist.ts` — charged terms, whole-token case-insensitive matching, deliberately
  **not** sent to the model (listing slurs in a generation prompt primes toward the neighborhood
  being avoided). Never substring-match: ASSESS, COCKTAIL, and SCUNTHORPE are legitimate.
- `src/services/bedrock.ts` — one schema object drives both the tool definition sent to the model
  and the ajv validation of the response, compiled once and cached per schema in a `WeakMap`.
  Includes XML-escaping untrusted context before it enters the `${context}` slot and the
  replacer-function form of `String.replace` so `$&` in a context value is not read as a
  substitution pattern.
- The **prompt-in-DynamoDB** pattern. Prompt text and config (model, `maxTokens`,
  `thinkingEffort`) live in a table, fetched by id, deployed from `prompts/*.txt` by a
  `deploy-prompts` script on every pipeline run. Tuning a prompt is not a code change.

**Repurposed:** `getRandomSample` and the inspiration-seeding idea from `getModelContext` — sample
random words into the generation context so the model does not settle into a rut. This matters
more for Lull than for connections, because one prompt is asked for many phrases a night and an
unseeded model returns the same idioms every time.

**Left behind:** `constraints.ts` is entirely connections-specific.

### The word lists need replacing, not copying

connections-api's `nouns.ts` / `verbs.ts` / `adjectives.ts` are mechanically clean — 1,982 / 989 /
494 entries, no duplicates within a list, no whitespace or casing defects, no blocklist hits — but
they are the wrong tool for inspiration seeding, for four reasons in ascending importance:

1. **Junk entries.** `p`, `tv`, `pc`, `cm`, `ms` in nouns; `ok` in adjectives.
2. **Lowercased proper nouns.** `english`, `german`, `american`, `french`, `christian` in nouns;
   `french`, `spanish` in adjectives. `christian` as a random seed can nudge generation toward
   religious content, and nothing downstream flags it because it is not charged.
3. **Cross-list overlap.** 307 words appear in both nouns and verbs, 24 in nouns and adjectives,
   28 in verbs and adjectives, and four (`light`, `sound`, `round`, `cross`) in all three. With
   sample counts of 10/8/5 a word occupies two inspiration slots in roughly one context in sixty.
4. **They are frequency-ranked, which is backwards.** The top of a frequency list is abstract and
   functional by construction — `way`, `thing`, `case`, `part`, `point`, `fact`. Those seed
   nothing. Concreteness *rises* as frequency falls: around index 900 the list reaches `beach`,
   `iron`, `milk`, `nose`, `roof`, `shoe`, `soil`, `tank`. The list is therefore sorted in the
   wrong direction for this purpose and truncated at the wrong end.

**Lull builds a concreteness-weighted list instead**, filtered from the Brysbaert concreteness
norms (~40k English lemmas rated 1–5, freely available) to ratings above ~4, with proper nouns and
abbreviations stripped. Worth backporting to connections-api afterward.

### Phrase corpus

One nightly Bedrock call produces the shared phrase corpus feeding **Missing Vowels**,
**Cryptogram**, and **Phrazle** (and later Rebus). This is what decouples puzzle count from token
count: one call, three games, many puzzles each.

Entries are tagged by shape, because the consumers want different things — Phrazle wants two or
three short words with common letters, Missing Vowels wants recognizable titles, Cryptogram wants
wit. The tool schema requires the tag, and ajv rejects responses missing it.

The blocklist is a hard gate applied after generation, whole-token, over every phrase.

---

## The type contract

The shell — shelf, routing, progress persistence, solved marking, archive, prefetch — is entirely
type-agnostic. Adding a type touches three places and nothing else.

### Backend

```ts
interface Generator<T> {
  type: PuzzleType
  countPerDay: number
  generate(date: string, index: number): Promise<Puzzle<T>>
}
```

The nightly handler loops the registered generators and **catches per generator**, so a failure is
isolated to its own type and the pack ships without it. `countPerDay` is where the supply thesis
lives: goFigure returns twelve, Cryptic Clue (later) returns one.

### Shared

`src/rules/`, vendored — see [Shared rules](#shared-rules). Only Phrazle needs it.

### UI

```ts
registry[type] = {
  Component,   // ({ puzzle, progress, onProgress, onSolved })
  label,
  icon,
}
```

A component receives its puzzle and reports progress and completion. **It never touches storage,
routing, or the network** — the shell owns all three. This is principle 2 made structural rather
than aspirational: a type's component has no way to reach a backend even if it wanted one.

---

## API

| Route | Returns |
| --- | --- |
| `GET /packs/{date}` | the day's `Pack` |
| `GET /packs` | available dates |
| `GET /dictionary/v1` | gzipped word list |

Available dates are computed arithmetically rather than queried, as `get-game-ids` does today.

### Pack shape

```ts
interface Pack {
  date: string          // YYYY-MM-DD
  complete: boolean     // did every generator succeed?
  puzzles: Puzzle[]
}

interface Puzzle<T = unknown> {
  id: string            // `${date}:${type}:${index}`
  type: PuzzleType
  difficulty: 1 | 2 | 3 | 4 | 5
  estimatedSeconds: number
  data: T               // type-specific, opaque to the shell
}
```

**One pack per date, not one request per puzzle.** The deciding number is the install fill: seven
days at fifteen puzzles is 105 round trips against 7. On a waiting-room connection that is the
difference between a working app and a spinner. A pack is ~15KB, so a week is ~105KB.

**A pack is served as soon as it holds anything, with `complete` telling the truth.** Connections
can be atomic because it is one puzzle; a pack cannot, or one flaky generation kills a day that
had twelve good goFigures in it. Clients cache incomplete packs and refetch them while they are
still incomplete and the device is online. Because Tier A types cannot fail, a pack is never empty.

### Dictionary

Served by a Lambda on the existing `HttpApi`, with the word list bundled into the deployment
package. **No new bucket and no CloudFront** — `lull-infrastructure`'s only bucket is the private
SAM artifacts bucket with all four public-access flags set, and the API is
`AWS::Serverless::HttpApi` with a REGIONAL custom domain, so there is no distribution to put an
origin behind.

Lambda serving is right here because the dictionary is fetched **once per install, not once per
session** — a handful of invocations a month, where a cold start adds a second to a background
prefetch nobody is watching.

**HTTP API v2 does not compress responses** (`MinimumCompressionSize` is a REST API v1 feature),
so the file is committed pre-gzipped and returned as binary:

```ts
{
  isBase64Encoded: true,
  headers: {
    'cache-control': 'public, max-age=31536000, immutable',
    'content-encoding': 'gzip',
    'content-type': 'text/plain',
  },
  body: gzippedDictionaryBase64,
}
```

~480KB on the wire against a 6MB Lambda response cap and a 10MB HTTP API cap. `immutable` is safe
because the version is in the URL — `/dictionary/v2` is a different resource, not a cache-busting
problem. Updating the list requires a deploy, which is a push to master, and matches how prompts
already work.

Source must be a permissively licensed list — ENABLE (public domain), SCOWL, or
dwyl/english-words. Confirm the license before committing the file.

---

## Client storage

```
lull:pack:{YYYY-MM-DD}     the day's pack
lull:progress:{puzzleId}   in-flight state for a resumable puzzle
lull:meta                  version, installDismissed, solved ids
```

Mirrors connections-ui's `ct:` conventions, including **deriving the cached-pack index from the
keys** rather than storing one — a stored index drifts, and the keys cannot lie.

The dictionary goes in the **Cache API, not localStorage**: localStorage's ~5MB budget is shared
with packs, and synchronous reads of a 500KB string block the main thread. `caches` is available
from the window, so the prefetch hook populates and reads it directly with no service worker
involvement.

### Eviction

**Lull needs eviction and connections does not.** Connections accumulates ~1KB a day and is under
a megabyte after two years. Lull at ~15KB a day reaches 5.5MB in a year, which blows the budget.

The rule: **keep the record, drop the content.** Solved ids stay in `lull:meta` — a few bytes each,
so history survives indefinitely — while pack payloads and progress entries outside the retained
window are pruned on each prefetch run. An old solved puzzle shows as solved in the archive and
re-downloads if opened.

### Progress

New relative to connections, which only needed solved-or-not. Progress is written by the shell
from what a type's component reports, and is opaque to the shell.

| Type | Progress |
| --- | --- |
| goFigure | current expression |
| Missing Vowels | current text input |
| Cryptogram | partial cipher→plain mapping |
| Phrazle | guesses so far |

---

## Prefetch

`usePrefetch` is copied from connections-ui and keeps its structure: the three triggers (mount,
`online`, `appinstalled`), the `inFlight` guard against flapping connections, the `abandoned` ref,
the `navigator.onLine === false` early return, and `isInstalled()` checked on **every open** rather
than latched at install — iOS fires no `appinstalled` event at all.

Four changes:

1. Fetch packs for the window **first**, dictionary **last**. Packs are ~1KB each and cover three
   of the four games; the dictionary is ~500KB and covers one. If the connection dies partway
   through, puzzles matter more than a word list.
2. The dictionary presence check is `await caches.match()`, so `run()` gains one await.
3. Refetch any cached pack still marked `complete: false`.
4. Prune packs and progress outside the window.

**Gate the dictionary on installed**, exactly as the 7-day window is gated. A non-installed visitor
gets one pack and no dictionary — half a megabyte is a rude thing to spend on a casual visit — and
fetches it lazily if they open a Phrazle, which they can, because they are online by definition.

**Check presence, never a "downloaded once" flag.** Apple has stated home-screen web apps are
exempt from Safari's 7-day cap on script-writable storage, but Cache API entries can still go under
disk pressure, and a latched flag in localStorage would survive an eviction that took the
dictionary with it. Since the URL is versioned, the check is "is `/dictionary/v1` cached", which
also gives the cleanup rule: on a version bump, delete anything that is not current.

Request `navigator.storage.persist()` on install. It is a hint, not a guarantee, but it moves the
app out of the first tier evicted under pressure.

**The user-visible consequence:** if the dictionary is absent and the device is offline, Phrazle
renders **disabled on the shelf** with "needs a connection to set up" — never enabled and then
broken when tapped.

---

## Shared rules

`lull-api` owns `src/rules/`: pure functions only, no AWS SDK, no Node built-ins, nothing
environment-specific, so the same files compile in a Lambda bundle and a Next.js bundle.
`lull-ui` carries a byte-identical copy, and CI makes divergence impossible:

```yaml
- name: Verify rules match lull-api
  run: |
    git clone --depth 1 https://github.com/dbowland1/lull-api /tmp/lull-api
    diff -r /tmp/lull-api/src/rules src/rules
```

Drift fails the build with a diff naming exactly what moved. `npm run sync-rules` in `lull-ui`
re-copies the directory. Optionally, a workflow in `lull-api` opens a PR against `lull-ui` when
`src/rules/` changes on master, making propagation automatic and reviewable.

**Vendor the tests too.** They are pure-function tests with no infrastructure, so `lull-ui`'s own
Jest run proves its copy behaves rather than merely matching a hash.

The surface is deliberately tiny:

| Function | Used by | Why it cannot be data |
| --- | --- | --- |
| `markGuess(guess, answer)` | Phrazle | Four-state marking over arbitrary input |
| `isValidGuess(guess, dict)` | Phrazle | Dictionary lookup over arbitrary input |
| `normalizeAnswer(input)` | Missing Vowels, Cryptogram | UI must normalize as the backend did |
| `canonicalize(expression)` | goFigure | Compare tapped input to shipped solutions |

**Tripwire:** if this surface grows past a few hundred lines or acquires dependencies, replace
vendoring with a published package. If we ever want to change game logic without a UI deploy,
revisit WebAssembly. Neither applies today.

---

## Type specifications

### goFigure

```ts
interface GoFigureData {
  goal: number
  bank: number[]              // each digit used exactly once
  operators: Operator[]       // reusable
  acceptedSolutions: string[] // canonical form
}
```

**Evaluation is strictly left to right; operator precedence does not apply.** `6 + 9 + 7 * 7 = 154`
because 6+9=15, +7=22, ×7=154. This is the defining rule of the original and is confirmed by its
own screenshot, where `7 + 7 + 9 * 7` displays 161 rather than 77.

Generation is pure enumeration — every arrangement of the bank against every operator triple,
evaluated left to right, targets indexed by how many distinct expressions reach them. No model, no
corpus, no dictionary. Difficulty is the solution count: one is hard, six is a warm-up.

Expressions with a non-integer intermediate are rejected, so every step stays mental arithmetic.
Division by zero is likewise rejected.

The UI never evaluates arithmetic. It canonicalizes what was tapped and looks for it in
`acceptedSolutions`.

### Missing Vowels

```ts
interface MissingVowelsData {
  category: string
  displayed: string   // respaced consonant string
  answer: string
}
```

Pure string manipulation over the phrase corpus. Difficulty is respacing aggression and category
specificity. The UI compares `normalizeAnswer(input)` to `normalizeAnswer(answer)`.

### Cryptogram

```ts
interface CryptogramData {
  ciphertext: string
  revealed: Record<string, string>  // cipher letter → plain letter
  plaintext: string
}
```

A random derangement over a corpus phrase — no letter may map to itself. Difficulty is how many
letters are pre-filled in `revealed`. The UI's only logic is propagating a chosen assignment across
every occurrence and comparing the result.

### Phrazle

```ts
interface PhrazleData {
  wordLengths: number[]
  answer: string
  maxGuesses: number   // 6
}
```

Four tile states, in precedence order: **green** (right letter, right position, right word),
**yellow** (in this word, wrong position), **purple** (elsewhere in the phrase, not in this word),
**gray** (absent).

**The marking algorithm is the main implementation hazard in this project.** Duplicate letters make
it far nastier than Wordle: if the phrase holds two E's and the guess holds four, which two light
up, and does a per-word or phrase-wide budget win? Required approach is a multi-pass assignment:

1. Greens claim their letters first.
2. Yellows draw from each word's remaining pool.
3. Purples draw from the phrase-wide leftovers.
4. Everything else is gray.

Get the ordering wrong and the colors lie in ways players notice and tests do not. **Write the
tests first**, covering at minimum: repeated letters within one word, the same letter in two
different words, a guess with more copies of a letter than the answer holds, and a fully correct
guess.

`markGuess` is not puzzle-specific — it is byte-identical on day 1 and day 1000, which is why it
belongs in vendored shared rules rather than being served dynamically.

---

## Decisions and rejected alternatives

**Separate project rather than folding into connections-ui.** Costs a second home-screen icon and
a copy of the offline machinery; buys a clean separation between a daily-streak ritual and a shelf
of disposable snacks.

**Copy `storage.ts` / `usePrefetch` / `useOnline` / `useInstallPrompt`, do not extract a shared
package.** They contain hard-won iOS behavior; a shared library across two PWAs owned by one person
is a versioning chore with no offsetting benefit.

**Rules vendored, not published.** A published package fights the pipeline's `npm version minor`
on every master push: a rules change would ship as a minor bump and `lull-ui`'s `^` range would
pick up a game-behavior change nobody decided on. Registry auth, a publish job, and a two-repo
release dance is heavy ceremony for ~60 lines.

**Rejected: shipping executable rules from the API.** `eval`/`new Function` needs `unsafe-eval` in
the CSP, weakening XSS protection app-wide and creating a remote-code path into the browser. A Blob
Worker is better but still remote code. WebAssembly is genuinely sandboxed but means authoring the
marker in Rust or AssemblyScript to avoid copying 60 lines of TypeScript. A bounded DSL is the most
defensible version and still means building a small language. All four share a fatal flaw: **code
that has not downloaded cannot run**, and a cold install in a waiting room has no rules yet.

**Rejected: git dependency on `lull-api`.** Drags the SAM dependency tree into a Next.js build and
needs committed `dist/`.

**Rejected: dictionary in an S3 bucket.** No suitable bucket exists and no CloudFront distribution
exists to front one.

**Rejected: trimmed "common words" dictionary.** Smaller, but rejects legitimate guesses, and
nothing sours a Wordle-like faster than being told a real word is not one. A Bloom filter (~300KB
at 0.1% false positives) is the fallback if 480KB ever hurts — its failure mode, occasionally
accepting a non-word, is far friendlier.

---

## Open questions

1. **Retention window length.** Connections keeps 7 days. Lull's packs are ~15× larger per day;
   7 days may still be right, but confirm once real payload sizes exist.
2. **Shelf sort.** Proposed: sort by `estimatedSeconds`, show `difficulty` as a marker, and do not
   curate a difficulty spread across the pack — "I have four minutes" is the question actually
   being asked.
3. **Resume semantics per type.** Whether an abandoned Phrazle counts its used guesses on return,
   and whether Cryptogram progress survives a pack refetch.
4. **Naming and iconography** for `lull-ui`, including the maskable 512 icon required for Firefox
   for Android installability (see `~/Projects/pwa-requirements.md`).
