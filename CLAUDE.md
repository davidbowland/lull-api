# Project Guidelines

**Always commit changes** after completing work unless explicitly told not to.

## Lull-specific rules

**The backend decides; the UI displays.** No game rule is authored in `lull-ui`. Content,
difficulty, selection, and answers all come from here. The only exception is `src/rules/` — pure
functions copied by hand into `lull-ui`, with nothing verifying the copies match. Adding a function
there is a decision, not a convenience.

**It holds exactly three files, and the bar is TWO callers rather than one.** `normalize-answer.ts`,
`is-valid-guess.ts` and `mark-guess.ts` each run over input a player invents at play time, which no
generator can enumerate in advance — and each is genuinely imported by `src/` here as well as by a
board over there. That second half is what a copied file has to earn. It briefly held four more —
the hint-rung builders for cryptogram, phrazle and themed anagrams, plus `letter-strengths.ts` — on
the strength of the first half alone. Nothing in `src/` ever imported them; this repo ran them only
under test, which was the whole of what a second copy bought, and they now live in `lull-ui` beside
the boards that call them. A rule with one real caller belongs in the repo that calls it.

**Every hint on the wire is `{ text, metadata? }`.** `text` is decided here and rendered verbatim;
`metadata` is machine-readable structure for the board and never a substitute for the sentence. A
payload that ships structure and expects the client to write the copy puts game wording in
`lull-ui`, which is the exception this rule exists to prevent.

"Decided here" is not "synthesized here". goFigure's `text` is built from templates in
`gofigure/hints.ts`; a phrase puzzle's is model prose that only reached the wire by passing every
gate in `utils/phrase-checks.ts`. Telling clients to render it verbatim is what makes those gates
load-bearing rather than cosmetic — a new player-visible string from a model needs a length bound
and a content check BEFORE it is added, not after.

**A rung that restates the puzzle is not a hint.** Every rung must narrow the answer using something
the player cannot already read off their own screen. Anything on `data` is on their screen — the
clue, the enumeration, the letter bank, the category when it is not hidden — so a rung that names
one of those spends a hint and returns nothing. The failure mode is not a bad template; it is a
builder that describes the puzzle's SHAPE while the generator constrains shape hard enough to make
it legible. Cryptic Clue shipped a three-rung ladder that named the device the clue's own indicator
announced, quoted a definition that was the clue's first word, and stated a length the client
already renders — three hints to deliver one letter.

**A CONSTANT IS NOT A HINT EITHER, and that is the same rule read one step further.** The
redesign that fixed the ladder above replaced it with a per-device sentence — `The answer is built
from two or more shorter words, one after the other.` — which was defensible on the day it shipped
and was the SAME STRING on every charade thereafter. A player meets it once. Every later charade
spends a hint telling them what they already know, and the ladder-length table still reports three
rungs. The test is not "does this rung say something true about this device", it is **"does this
rung narrow THIS answer"** — so a rung whose text does not depend on the puzzle cannot pass, however
well it explains the game. Mechanism belongs in onboarding, not in a hint budget. A player put it
plainly: hints 2 and 3 tell you how the game works, which you already know.

**So ask what the puzzle HIDES.** Every device works on something the player cannot see, and that is
the only content a hint can spend itself on. Cryptic Clue's charade parts and deletion source are
never printed in the clue — verify proves it — so `crypticclue/hints.ts` ships one model-written
phrase per clue about exactly that word, framed in code: `The first part is a thing driven on
roads.` A double definition hides no word, so it gets a third angle on the answer and a shorter
ladder, which is the honest outcome rather than a gap.

Two rules follow, and both are testable:

- **State the drop rule in code, not in judgment.** When a rung is only sometimes redundant, decide
  it from data the builder already holds, so "this rung would restate the screen" is a computation
  rather than a taste call. Draw the ladder from a pool longer than the ladder, so a rung can drop
  without shortening it, and gate the pool running dry as a code defect. **A rule can also answer
  "always", and then the rung does not belong in the pool at all** — a drop rule that fires 100% of
  the time is a rung the pool pretends to have, and it makes the ladder-length table a lie about
  where the rungs come from. `indicators.ts` once kept a `tellingIndicators` list for exactly this,
  proving that every deletion indicator announces its own letter operation and so no deletion device
  rung could ever survive. **That list is now deleted, and its deletion is the rule's last lesson:**
  once no device shipped a mechanism rung at all, the list was evidence for a decision nobody was
  making any more. A committed list kept past its one caller goes stale silently.
- **A ladder may be SHORTER than three, and a rung you do not have beats a bad one.** `HintLadder`
  is one to three rungs; only pad a ladder with something worth a player's hint. Cryptic Clue emitted
  a second letter reveal beside the first to reach three — the same hint twice — which is the shape a
  player named as the thing they hated most. If a type has two good rungs, it ships two. Clients read
  `hints.length`; `endpoints.rest` says so. Cryptic Clue's double definition now ships ONE rung on
  the shape where the model supplied neither string — it hides no word, so there is exactly one
  honest thing left to say, and padding it would mean that second letter reveal again.
- **Escalate, and put the giveaway last.** Order the pool weakest-first so taking a prefix preserves
  the escalation. A rung that hands over the answer belongs at the bottom of the ladder or nowhere.
  **Rank rungs by what they yield on THIS type, not by how much they look like they say.** A letter
  reveal is a mild hint on an anagram and the entire solve on a hidden word, where the answer is a
  literal substring of the clue and position plus enumeration is a lookup. **Cryptic Clue got this
  wrong twice, in opposite directions.** Its first pool ranked the letter rungs above the fodder
  quotation and promoted a lookup to rung one. Its second moved the letter rungs to the bottom and
  left the fodder above them — which promoted a _different_ complete solve to rung one on the same
  clues, because an anagram's fodder IS the answer's letters and a hidden clue's contains them. Both
  versions ranked by how much a rung LOOKS like it says. Work out what each rung yields on each
  device, in the hand, before ordering them. The current pools put the two prose rungs above the
  letters on every device: a phrase leaves a field of candidates standing, and a character beside a
  definition and the rendered enumeration usually does not.

`__tests__/unit/generators/crypticclue/hints.test.ts` is the worked example: one row per drop rule,
an `escalation` block asserting no ladder opens with the strongest rung, and a length-count row that
fails if someone re-adds the enumeration to a rung.

**A second model string needs its own gate, not a second call to the first one.** `gatedGloss` and
`gatedWordGloss` sit in the same file and differ in three rows, each of which is the reason they are
two functions: a word gloss protects TWO words (its target and the answer) where a gloss protects
one; it carries a SHAPE row, because code interpolates it mid-sentence and `A noisy argument.`
composes a doubled period; and it forbids SEVERAL texts, because a double definition's second angle
may restate neither printed half nor the gloss above it. Reusing the gloss's gate would have shipped
a phrase naming `CAR` — the answer-leak gate keeps only tokens of four characters or more.

**Dates are UTC calendar dates.** A pack id is `YYYY-MM-DD` in UTC. Never derive one from a
local-time `Date`, and never compare one against a local midnight. Tests run under `TZ=UTC` so a
developer machine east of UTC cannot pass something CI will fail.

**Generation failures are isolated per puzzle, not per generator.** The nightly handler catches
around each `generate` call. Catching one level up loses every puzzle of a type to a single bad
draw, which is the outcome the incomplete-pack design exists to prevent.

**Never retry unbounded.** Generators run in a Lambda with a 900-second timeout. Any redraw or
retry loop is bounded and throws when the bound is reached, so the failure is one logged puzzle
rather than a killed invocation with nothing to explain it.

## Testing Standards

**Jest clears all mocks automatically** (`clearMocks: true` in jest.config.ts). Never manually
clear mocks.

**Mock state:** Set shared defaults in `beforeAll`. Override per-test with `mockReturnValueOnce` /
`mockResolvedValueOnce` / `mockRejectedValueOnce`. Never use `beforeEach` — write a named `setup()`
function if repeated arrangement is needed and call it explicitly.

**Non-determinism:** Any function that uses `Date.now()`, `Math.random()`, or `crypto.randomUUID()`
to produce a value that affects test outcomes MUST accept it as an injectable parameter with a
default:

```ts
// source
export const createThing = (input: Input, now = Date.now): Thing => ({ ...input, createdAt: now() })

// test
it('sets createdAt', () => {
  expect(createThing(input, () => 1_000_000).createdAt).toBe(1_000_000)
})
```

**Fake timers:** Use `jest.useFakeTimers()` in `beforeAll` (and `jest.useRealTimers()` in
`afterAll`) when the code under test calls `setTimeout`, `setInterval`, or `Date` internally
without injection.

**No `if` statements in tests.** No live `Date.now()` or `Math.random()` calls in test bodies. No
date arithmetic that depends on the current wall-clock time.

**Deterministic above all.** A test that passes today and fails tomorrow is broken.

## Security

**Validate all external inputs** at API boundaries — schema, type, and length — before passing to
downstream services or LLMs. A path parameter reaching a DynamoDB key unvalidated is an unbounded
key.

**Prompt injection** — user-supplied text embedded in LLM prompts is an attack surface. XML-escape
`<`/`>` before injecting into XML-structured prompts. Keep user content in user-role turns rather
than system prompts wherever possible.

**LLM output is untrusted.** Always parse and validate model responses against the expected schema.
Never execute or eval model output.

**Bearer tokens** (session IDs, API keys) are often the sole access control in Lambda APIs. Always
generate with `crypto.randomInt` (CSPRNG), never `Math.random()`.

**OWASP Top 10.** Primary exposure for Lambda APIs: A01 Broken Access Control (token-as-sole-auth),
A03 Injection (prompt injection for LLM apps; NoSQL injection for DynamoDB), A05 Security
Misconfiguration (IAM — avoid `Resource: "*"` and unnecessary actions; scope to specific ARNs).
