# Project Guidelines

**Always commit changes** after completing work unless explicitly told not to.

## Lull-specific rules

**The backend decides; the UI displays.** No game rule is authored in `lull-ui`. Content,
difficulty, selection, and answers all come from here. The only exception is `src/rules/` — pure
functions copied by hand into `lull-ui`, with nothing verifying the copies match — and it exists
solely for logic that runs over input a player invents at play time, which no generator can
enumerate in advance. Adding a function there is a decision, not a convenience.

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

Two rules follow, and both are testable:

- **State the drop rule in code, not in judgment.** When a rung is only sometimes redundant, decide
  it from data the builder already holds — `crypticclue/indicators.ts` keeps a committed
  `tellingIndicators` list, so "the clue gives its own device away" is a set membership rather than a
  taste call. Draw the ladder from a pool longer than the ladder, so a rung can drop without
  shortening it, and gate the pool running dry as a code defect.
- **A ladder may be SHORTER than three, and a rung you do not have beats a bad one.** `HintLadder`
  is one to three rungs; only pad a ladder with something worth a player's hint. Cryptic Clue emitted
  a second letter reveal beside the first to reach three — the same hint twice — which is the shape a
  player named as the thing they hated most. If a type has two good rungs, it ships two. Clients read
  `hints.length`; `endpoints.rest` says so.
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
  device, in the hand, before ordering them.

`__tests__/unit/generators/crypticclue/hints.test.ts` is the worked example: one row per drop rule,
an `escalation` block asserting no ladder opens with the strongest rung, and a length-count row that
fails if someone re-adds the enumeration to a rung.

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
