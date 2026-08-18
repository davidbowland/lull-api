# Lull — Game Catalog

Status: catalog only. This document fixes *what* Lull will contain and how each game is
generated. It is not the system design — API shape, storage, prefetch, and PWA behavior come
next, in a separate spec.

## What Lull is

A PWA holding a shelf of one-to-five-minute puzzles, for waiting rooms and other dead time.

Three constraints drive every decision below:

1. **Offline first.** Waiting rooms have bad signal. Puzzles must already be on the device
   before they are wanted, so everything is generated ahead of time in a nightly batch and
   prefetched. On-demand generation is not merely expensive here — it does not work.
2. **No account, no server-side state.** Progress lives in the installed PWA's `localStorage`.
   Uninstalled, the app is stateless and that is fine.
3. **The shelf is never empty.** A generation run that fails must not produce a dead app, which
   is why the majority of types below need no model at all.

Sibling repos, to be created: `lull-ui`, `lull-infrastructure`.

## Generation tiers

Every game is classified by *who guarantees the puzzle is fair*. This is the single most
important property in the catalog — it determines cost, failure mode, and how many puzzles a
day the type can sustain.

| Tier | Meaning | Failure mode |
| --- | --- | --- |
| **A** | Code generates and proves it. No model involved, or the model supplies flavor text only. | Cannot ship a broken puzzle. |
| **B** | Model generates content, code checks it against a list or a solver. | Rare bad puzzle, usually catchable. |
| **C** | Model generates, only another model can judge it. | Wrong puzzles reach players. Needs a verify pass and retries. |

Tier A types are the floor. If a nightly run fails entirely, the shelf still fills.

## Shared corpora

Content is generated once and reused across types. This is what decouples puzzle count from
token count.

- **Phrase corpus** — short, recognizable phrases, quotes, titles, and puns. Feeds
  **Cryptogram**, **Missing Vowels**, **Phrazle**, and later **Rebus**. One nightly call, four
  games. Entries are tagged by shape: Phrazle wants two or three words with common letters,
  Missing Vowels wants recognizable titles, Cryptogram wants wit.
- **Compound-word list** — static, not generated. Feeds **Bridge Word** and **Compound Chain**.
- **Dictionary + word list** — static. Feeds **Themed Anagrams**, **Phrazle** validation,
  **Deduce the Rule**, and any future ladder game.

---

# Phase 1

The launch shelf. Eight types.

## 1. Cryptogram

Each letter maps consistently to one other letter. Restore the plaintext.

```
KVDX BZVXH ZVGX QJ QMMPU        (hint: X = E)
```

→ `TIME FLIES LIKE AN ARROW`

- **Tier:** A — code applies a random derangement to a corpus phrase.
- **Length:** 3–5 min. **Difficulty dial:** how many letters are pre-filled.
- **Per day:** as many as the phrase corpus holds.

## 2. Missing Vowels

Vowels stripped, letters respaced so word boundaries lie.

```
Film:  THMP  RSTR  KSBCK
```

→ `THE EMPIRE STRIKES BACK`

- **Tier:** A — pure string manipulation over the phrase corpus.
- **Length:** 1–2 min. **Difficulty dial:** respacing aggression, category specificity.
- **Per day:** unlimited within the corpus.

## 3. Themed Anagrams

A set of scrambled words sharing a theme.

```
Kitchen:  ROTATES · LAPTUAS · TEKLET · RECONDAL
```

→ toaster, spatula, kettle, colander

- **Tier:** A — model supplies themed word sets (cheap), code scrambles and verifies each
  scramble is not itself a word and not trivially close to the answer.
- **Length:** 1–2 min. **Difficulty dial:** word length, theme breadth.
- **Per day:** unlimited.

## 4. Bridge Word

One word completes all three.

```
____WALK      ROAD____      ____KICK
```

→ `SIDE`

- **Tier:** B — model proposes, code confirms each compound exists in the compound-word list.
- **Length:** 1–2 min. **Difficulty dial:** how common the compounds are.
- **Per day:** one.

## 5. Cryptic Clue

Definition plus wordplay, reaching the same answer from opposite directions.

```
Dance hidden in instant angora (5)
```

→ `TANGO`. "Dance" is the definition; "hidden in" signals the letters sit inside the phrase:
ins**TANGO**ra.

- **Tier:** C — highest delight, lowest pass rate. Models routinely invent wordplay that does
  not decompose. The verifier's job is to take the clue apart and confirm it actually lands on
  the answer.
- **Length:** 1–3 min. **Difficulty dial:** clue type (hidden and double-definition are gentle;
  anagram, charade, and container are harder).
- **Per day:** one. Expect retries.

## 6. Semantic Spectrum

Order items along a stated axis.

```
Smallest to largest:
GRAIN OF SAND · VIRUS · ANT · ATOM · RED BLOOD CELL · BACTERIUM
```

→ atom, virus, bacterium, red blood cell, grain of sand, ant

- **Tier:** C — needs a verify pass confirming the ordering is unambiguous and factually right.
  Prefer axes with objective ground truth (size, date, temperature) over judgment calls.
- **Length:** 2–3 min. **Difficulty dial:** item count, how close the items sit on the axis.
- **Per day:** one.

## 7. goFigure

Arrange the digit bank and operators to hit the goal.

```
Goal: 154
Bank: 6 9 7 7        Operators: + - * /

  ?  ?  ?  ?  ?  ?  ?  =  154
```

→ `6 + 9 + 7 * 7 = 154`

**Evaluation is strictly left to right — operator precedence does not apply.** 6+9=15, +7=22,
×7=154. This is the defining rule of the original TI-83 game and is confirmed by its own
screenshot, where `7 + 7 + 9 * 7` displays as 161 rather than 77. It also makes the game far
more approachable and generation trivial.

Open questions: whether each digit must be used exactly once (assumed yes), whether operators
are reusable (assumed yes, since the reference solution uses `+` twice), and how division by
zero and non-integer intermediates are handled (proposal: reject any expression with a
non-integer intermediate value, so every step stays mental-arithmetic friendly).

- **Tier:** A — no model whatsoever. Enumerate every arrangement of the bank against every
  operator triple, evaluate left to right, index targets by how many distinct expressions reach
  them.
- **Length:** 1–3 min. **Difficulty dial:** the solution count for the target. One solution is
  hard; six is a warm-up.
- **Per day:** effectively unlimited — thousands can be minted per second.

## 8. Phrazle

Wordle for phrases. Six attempts. Every guess must use real words and fill all the spaces.

Four tile states, in precedence order:

| State | Meaning |
| --- | --- |
| Green | Right letter, right position, right word |
| Yellow | Letter is in this word, wrong position |
| Purple | Letter is elsewhere in the phrase, but not in this word |
| Gray | Letter is not in the phrase at all |

Example from the reference implementation, guessing against a phrase where `HOT HAND` is the
guess: `O` green (correct spot), `T` yellow (in the first word, wrong spot), `A` purple (in the
phrase but not in the second word), `N` gray (absent entirely).

**The marking algorithm is the one real implementation hazard in this project.** Duplicate
letters make it much nastier than Wordle: if the phrase holds two E's and the guess holds four,
which two light up, and does a per-word or phrase-wide budget win? Required approach is a
multi-pass assignment — greens claim their letters first, then yellows draw from each word's
remaining pool, then purples draw from the phrase-wide leftovers. Get the ordering wrong and
the colors lie in ways players notice and tests do not. **Write the tests first.**

- **Tier:** A — code picks from the phrase corpus; the dictionary validates guesses.
- **Length:** 3–5 min. **Difficulty dial:** phrase obscurity, word count.
- **Per day:** as many as the corpus holds.

---

# Phase 2

Novel mechanics, mostly absent from the daily-puzzle landscape. Build after Phase 1 ships.

## 9. The Hinge

Two categories overlapping in exactly one member. Name it.

```
US Presidents  ∩  Vacuum cleaner brands
```

→ `HOOVER`. Also: `Chess pieces ∩ Church officials` → BISHOP.

- **Tier:** C — models are excellent at generating these, but the verify pass must confirm the
  intersection is genuinely unique. `Body parts ∩ Clock features` fails, because both HANDS and
  FACE qualify.
- **Length:** 30 sec – 1 min. **Difficulty dial:** category obscurity.
- **Per day:** several, if generation is reliable.

## 10. Deduce the Rule

Induction rather than deduction. Infer a hidden predicate from examples, then apply it.

```
These pass:  BOOKKEEPER · ADDRESS · BALLOON
These fail:  BASKET · GARDEN · MELON

Which of these pass?   COFFEE · SILENT · SUCCESS · MARBLE
```

→ the rule is "contains a double letter", so COFFEE and SUCCESS.

The Zendo/Eleusis mechanic, with no daily version in existence as far as we know. Rules are
**code predicates over a word list** — double letters, letters in alphabetical order, no letters
shared with ENGLISH, first letter equals last — so puzzles are provably correct and infinite.

- **Tier:** A — zero model involvement.
- **Length:** 1–2 min. **Difficulty dial:** predicate obscurity; also how well the failing
  examples rule out near-miss hypotheses. The generator must check that the shown examples
  eliminate every other predicate in its library, or the puzzle has multiple valid answers.
- **Per day:** unlimited.

## 11. Compound Chain

Bridge Word extended into a path. Each adjacent pair forms a compound word.

```
FIRE → ____ → ____ → ____ → PACK
```

→ FIRE·FLY·PAPER·BACK·PACK

- **Tier:** A — breadth-first search over the compound-word list, with uniqueness checked by
  confirming no other path of that length connects the endpoints.
- **Length:** 1–3 min. **Difficulty dial:** chain length. Two links are a gimme; five bite.
- **Per day:** unlimited.

## 12. Alphametics

Letters stand for digits. Each letter is one digit, each digit one letter, no leading zeros.

```
  SEND
+ MORE
------
 MONEY
```

→ 9567 + 1085 = 10652

The ideal shape for this architecture: **the model proposes, code disposes.** The model suggests
thematically cute word triples and never has to be right — code brute-forces all digit
assignments and keeps only triples with exactly one solution.

- **Tier:** A — the model's output is a suggestion, not a puzzle. Correctness is entirely
  code's.
- **Length:** 3–5 min. **Difficulty dial:** word length, letter count.
- **Per day:** unlimited from a fixed word list; more interesting with model-supplied themes.

---

# Backlog

Considered, not committed. Recorded so the reasoning is not relitigated.

## Word games

- **Mini Connections (3×3)** — nine words, three groups, with one word deliberately pulled
  toward the wrong group. Belongs to connections-ui more than here; revisit only if Lull wants a
  connections-shaped snack.
- **Clued Ladder** — a word ladder where every rung carries a one-word clue
  (`COLD → rope → playing piece → hospital section → WARM`, i.e. CORD, CARD, WARD). Tier B, and
  more interesting than a bare ladder.
- **Rebus** — typography as puzzle. `ECNALG` → backward glance; `MIND` over `MATTER`;
  `HISTORY HISTORY` → history repeats itself. Tier B, shares the phrase corpus, needs a
  rendering layer for the stacked and reversed cases.
- **Scrambled Connections** — anagrams crossed with grouping; the scrambling hides the
  categories. Tier B.
- **Mini Logic Grid** — four items across three attributes, ~5 clues. Tier A with a real solver.
  Dropped from Phase 1 for length (3–5 min at the top of the range) and grid-UI cost.

## Japanese pencil puzzles

The whole family shares one decisive property: **the generator and the solver are the same
program.** Write a solver, then generate by filling randomly, stripping clues, re-solving, and
keeping the strip only while the solution stays unique. Provable correctness, infinite supply,
zero tokens, and difficulty measurable as the deduction depth the solver needed rather than a
quality a model was asked for.

Two costs, both real. They are **language-independent and therefore have no personality** — Lull's
character comes from wordplay, and these are ballast. And **touch UI is the actual work**; take
only the tappable ones.

Tap-friendly, worth taking:

- **Skyscrapers (4×4)** — heights 1–4 once per row and column; border clues count visible
  buildings, taller hiding shorter. Tap a cell to cycle the height. ~3 min.

  ```
        3 2 1 2                  2 1 4 3
     2  · · · ·  2               3 4 1 2
     2  · · · ·  2      →        1 3 2 4
     3  · · · ·  1               4 2 3 1
     1  · · · ·  3
        1 3 2 2
  ```

- **Nonogram (5×5 to 10×10)** — run-length clues per line; the payoff is a revealed picture.
  Scales smoothly from trivial to hard. Not a Nikoli puzzle proper.
- **Kakuro (small)** — crossword with sums; digits 1–9, no repeats within an entry.

  ```
           3\    4\               1 3
    \4      ·     ·      →        2 1
    \3      ·     ·
  ```

- **Shikaku** — cut the grid into rectangles, each containing one number equal to its area.
  Tappable via corner-drag.

Drag-along-edges, avoid on mobile:

- **Slitherlink** — one closed loop on the grid lines; numbers count how many of a cell's four
  sides the loop uses.
- **Masyu** — one loop through every circle; white circles go straight through but turn
  immediately before or after, black circles turn but run straight for two cells on both sides.
- **Nurikabe**, **Hashiwokakero**, **Numberlink** — same objection.

Naming accuracy, for the record: Nikoli originated Slitherlink, Masyu, Nurikabe, Hitori,
Shikaku, Hashiwokakero, and Numberlink, and named and popularized Sudoku and Kakuro without
inventing them. Skyscrapers and Nonograms come from elsewhere.

## Rejected

- **Trivia of any kind** — factual hallucination is the worst possible failure mode for an
  unattended nightly generator. A wrong answer is worse than an empty shelf.
- **Semantle / Contexto-style semantic distance** — requires ranking arbitrary guesses against a
  target embedding, which means shipping a full vocabulary embedding to the device. Violates the
  offline constraint. Also a 10–20 minute game.
- **Impostor Definition (Balderdash)** — models write superb fake definitions, but the game is
  guessing at a 25% baseline rather than deducing.
- **Anachronism spotting** — same factual-accuracy objection as trivia.

---

# Open questions for the system design

1. **Pack shape.** Is a day's shelf one API response (`GET /packs/{date}`) or one request per
   puzzle? A single pack is one round trip and one cache entry; per-puzzle matches
   connections-ui's existing `GET /games/{id}` habit.
2. **Storage budget.** connections-ui stores a 7-day window. At roughly 1 KB per puzzle and
   ~15 puzzles a day, a 7-day Lull window is ~100 KB — comfortable inside localStorage's 5 MB,
   so no IndexedDB migration is needed. Confirm once the per-type payloads are real.
3. **Shared code with connections-ui.** `storage.ts`, `usePrefetch`, `useOnline`, and
   `useInstallPrompt` are directly reusable and contain hard-won iOS behavior (7-day eviction,
   no `appinstalled` event, the `localStorage` getter throwing `SecurityError`). Decision made:
   **copy and adapt, do not extract a shared package** — a shared library across two PWAs is a
   versioning chore for two apps with one owner.
4. **Per-type progress model.** Which types are resumable mid-puzzle, which are one-shot, and
   what "solved" means for a type with partial credit.
5. **Difficulty across the shelf.** Does a day's pack aim for a spread, or does each type pick
   independently?
