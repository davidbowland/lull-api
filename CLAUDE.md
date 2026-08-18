# Project Guidelines

**Always commit changes** after completing work unless explicitly told not to.

## Lull-specific rules

**The backend decides; the UI displays.** No game rule is authored in `lull-ui`. Content,
difficulty, selection, and answers all come from here. The only exception is `src/rules/` — pure
functions vendored into `lull-ui` and kept identical by CI — and it exists solely for logic that
runs over input a player invents at play time, which no generator can enumerate in advance. Adding
a function there is a decision, not a convenience.

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
