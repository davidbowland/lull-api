# Project Guidelines

**Always commit changes** after completing work unless explicitly told not to.

## Comments

Comment to say what the code cannot: why a non-obvious choice was made where the obvious one is
wrong, a hazard that fails silently, where a magic number came from. Do not write the project's
history. No record of what a line used to be, what an earlier draft proposed, which measurement
justified a change already made, or what a comment used to say. State the current rule, present
tense, as briefly as it can be said.

## Lull-specific rules

**The backend decides; the UI displays.** No game rule is authored in `lull-ui`. Content,
difficulty, selection and answers all come from here.

**`src/rules/` is the one exception, it holds exactly three files, and the bar is TWO callers rather
than one.** `normalize-answer.ts`, `is-valid-guess.ts` and `mark-guess.ts` each run over input a
player invents at play time, which no generator can enumerate in advance — and each is genuinely
imported by `src/` here as well as by a board over there. That second half is what a copied file has
to earn: a rule with one real caller belongs in the repo that calls it, however well it fits the
first half. The files are copied by hand with nothing verifying the copies match, so they must stay
dependency-free and compile in a Lambda bundle and a Next.js one alike. Adding a fourth is a
decision, not a convenience.

**Every hint on the wire is `{ text, metadata? }`.** `text` is decided here and rendered verbatim;
`metadata` is machine-readable structure for the board and never a substitute for the sentence. A
payload that ships structure and expects the client to write the copy puts game wording in
`lull-ui`.

**"Decided here" is not "synthesized here".** goFigure's `text` comes from templates in
`gofigure/hints.ts`; a phrase puzzle's is model prose that reached the wire only by passing the
gates in `utils/phrase-checks.ts`. A new player-visible string from a model needs a length bound and
a content check BEFORE it is added, not after: clients render `text` verbatim, so those gates are
the only thing standing between a model and a player.

**A second model string needs its own gate, not a second call to the first one.** `gatedGloss` and
`gatedWordGloss` sit together in `crypticclue/hints.ts` and differ in three rows, each of which is
the reason they are two functions: a word gloss protects TWO words where a gloss protects one; it
carries a SHAPE row, because code interpolates it mid-sentence and `A noisy argument.` composes a
doubled period; and it forbids SEVERAL texts, because a double definition's second angle may restate
neither printed half nor the gloss above it. Reusing the gloss's gate would ship a phrase naming
`CAR` — the answer-leak gate keeps only tokens of four characters or more.

### Hints

**A rung must narrow THIS answer, using something the player cannot read off their own screen.**
Anything on `data` is on their screen — the clue, the enumeration, the letter bank, the category
when it is not hidden — so a rung naming one of those spends a hint and returns nothing. Describing
the puzzle's SHAPE is the usual way this goes wrong, since the generator constrains shape hard
enough to make it legible.

**A constant is not a hint either.** A rung whose text does not depend on the puzzle cannot pass,
however well it explains the game: a player meets it once and pays for it every day after.
Mechanism belongs in onboarding, not in a hint budget.

**So ask what the puzzle HIDES.** Every device works on something the player cannot see, and that is
the only content a hint can spend itself on. Cryptic Clue's charade parts and deletion source are
never printed in the clue — verify proves it — so `crypticclue/hints.ts` ships one model-written
phrase per clue about exactly that word, framed in code: `The first part is a thing driven on
roads.` A double definition hides no word, so it gets a third angle on the answer and a shorter
ladder.

Three rules follow, and all are testable:

- **State the drop rule in code, not in judgment.** When a rung is only sometimes redundant, decide
  it from data the builder already holds, so "this rung would restate the screen" is a computation
  rather than a taste call. Draw the ladder from a pool longer than the ladder, so a rung can drop
  without shortening it, and gate the pool running dry as a code defect. A rule that answers
  "always" means the rung does not belong in the pool at all — and a committed list kept past its
  last caller goes stale silently, so delete it rather than leaving it to be trusted.
- **A ladder may be SHORTER than three, and a rung you do not have beats a bad one.** `HintLadder`
  is one to three rungs; only pad a ladder with something worth a player's hint. Padding to reach
  three produces the same hint twice, which players hate. If a type has two good rungs, it ships
  two. Clients read `hints.length`; `endpoints.rest` says so.
- **Escalate, and put the giveaway last.** Order the pool weakest-first so taking a prefix preserves
  the escalation. Rank rungs by what they YIELD on this type, not by how much they look like they
  say: a letter reveal is mild on an anagram and the entire solve on a hidden word, whose answer is
  a substring of the clue; an anagram's fodder IS the answer's letters. Work out what each rung
  yields on each device, in the hand, before ordering them.

`__tests__/unit/generators/crypticclue/hints.test.ts` is the worked example: one row per drop rule,
an `escalation` block asserting no ladder opens with the strongest rung, and a length-count row that
fails if someone re-adds the enumeration to a rung.

### Correctness

**Dates are UTC calendar dates.** A pack id is `YYYY-MM-DD` in UTC. Never derive one from a
local-time `Date`, and never compare one against a local midnight. Tests run under `TZ=UTC` so a
developer machine east of UTC cannot pass something CI will fail.

**Generation failures are isolated per puzzle, not per generator.** The nightly handler catches
around each `generate` call. Catching one level up loses every puzzle of a type to a single bad
draw, which is what the incomplete-pack design exists to prevent.

**Never retry unbounded.** Generators run in a Lambda with a 900-second timeout. Any redraw or
retry loop is bounded and throws when the bound is reached, so a bad draw costs one logged puzzle
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
