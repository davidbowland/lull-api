# Lull API

Lambdas for Lull: the nightly pack generator and the pack API.

## First deploy: bootstrap the packs

**A fresh stack serves an empty app, and nothing tells you.** The two schedules are
`cron(33 3 * * ? *)`, which generates **tomorrow**, and `cron(33 5 * * ? *)`, which tops up
today and tomorrow. Neither runs at deploy time, so between going live and the next 03:33 UTC
there is no pack for any date: `GET /packs/{today}` returns 404 and every visitor sees "No
puzzles on this device."

There is no error to find, either. `createPackHandler` returns normally when there is nothing
to do, so the `level="ERROR"` CloudWatch subscription fires nothing.

After the first deploy, generate today and tomorrow by hand:

`template.yaml` sets no `FunctionName`, so CloudFormation appends a stack suffix and a bare
`--function-name lull-api-CreatePackFunction` fails with `ResourceNotFoundException`. Look the real
name up first:

```bash
FN=$(aws cloudformation describe-stack-resource --stack-name lull-api \
  --logical-resource-id CreatePackFunction \
  --query 'StackResourceDetail.PhysicalResourceId' --output text)

for d in $(date -u +%F) $(date -u -v+1d +%F); do
  aws lambda invoke --function-name "$FN" \
    --payload "$(printf '{"date":"%s"}' "$d")" --cli-binary-format raw-in-base64-out \
    /dev/stdout
done
```

Then confirm: `curl https://lull-api.dbowland.com/v1/packs/$(date -u +%F)`.

The handler validates the date's format and refuses anything malformed, and `createPack` tops
up rather than replacing, so re-running these is safe.

## Why the nightly runs at 03:33 UTC, and why it is the only schedule

The shelf renders the player's **local** date; the schedule targets a **UTC** date. Date D first
begins for a player at UTC+14, which is 10:00 UTC on D-1, so building D at 03:33 UTC on D-1
leaves 6h27m of margin.

There used to be a second run at 05:33 UTC passing `{"retryToday": true}` to top up today's and
tomorrow's packs. It is gone. Repair does not need a cron: a `GET /v1/packs/{date}` on an
incomplete date rebuilds the fast half in-request and hands the slow half to the model builders
under `claimPackGeneration`, which is both sooner than 05:33 and rate-limited. What the second
cron reliably did instead was re-run a type that fails deterministically — a spent model budget,
a clue batch that returns no `tool_use` — at full Bedrock cost, so one failure a night became
two.

A hand top-up is `{"date": "YYYY-MM-DD"}`, which names the day it means.

## Generating Packs Locally

`npm run generate-packs` fills packs from your machine with headless Claude Code doing every model
call in place of Bedrock. Everything else — the gates, the reviews, the DynamoDB writes — is the
Lambdas' own code. For each date it builds the self-contained puzzles, then runs the phrase,
Themed Anagrams, Cryptogram, and Cryptic Clue chains concurrently. Dates run one at a time, in
ascending order. The summary labels the chains `phrases`, `themedanagrams`, `cryptogram`, and
`crypticclue`.

You need developer-role credentials exported in the shell (`$(./scripts/assumeDeveloperRole.sh)`,
which needs `AWS_ACCOUNT_ID`, the `developer` profile, and `jq`; the session lasts about an hour, so
run a few dates at a time), a logged-in `claude`, and a `.env.local` at the repo root. It is
gitignored, and these are the test stack's values from `template.yaml`, except `DICTIONARY_PATH`,
which points at the local layer. A variable already set in your shell, such as `AWS_REGION`,
overrides the file:

```bash
AWS_REGION=us-east-1
DEBUG_LOGGING=false
DICTIONARY_PATH=layers/dictionary/dictionary
DYNAMODB_PACKS_TABLE_NAME=lull-api-packs-test
DYNAMODB_PROMPTS_TABLE_NAME=lull-api-prompts-test
INSPIRATION_ADJECTIVES_COUNT=5
INSPIRATION_NOUNS_COUNT=10
INSPIRATION_VERBS_COUNT=8
LLM_ANAGRAM_PROMPT_ID=create-anagram-sets
LLM_CRYPTIC_PROMPT_ID=create-cryptic-clues
LLM_CRYPTIC_REVIEW_PROMPT_ID=review-cryptic-clues
LLM_CRYPTOGRAM_PROMPT_ID=create-cryptogram-sentences
LLM_PHRASE_PROMPT_ID=create-phrases
LLM_REVIEW_PROMPT_ID=review-phrases
PACK_START_DATE=2026-01-01
PHRASE_HISTORY_DAYS=550
```

Pass dates and inclusive ranges, each range at most 366 days. Duplicates collapse and dates run
sorted:

```bash
npm run generate-packs -- 2026-10-05 2026-10-07..2026-10-09
CLAUDE_MODEL=opus CLAUDE_EFFORT=high npm run generate-packs -- 2026-10-05
```

Before any AWS call, it exits 1 if a required variable is missing, a date or range is invalid, or
`claude --version` fails.

Each call uses the model and effort from its prompt file's config line unless `CLAUDE_MODEL` /
`CLAUDE_EFFORT` override them. Prompts are read from `prompts/` on disk, not the prompts table, so a
prompt can be tried before it is deployed. `claude -p` runs isolated from your personal Claude Code
settings: no CLAUDE.md, hooks, skills, or MCP servers reach the model. It also runs without your AWS
credentials or `CLAUDE_CODE_USE_BEDROCK`, so it always bills your Claude login, never Bedrock.

Each call is tried up to three times, each try timing out after 20 minutes, and each chain makes up
to three attempts until its types are no longer missing. A call that still fails — a review
included — fails its chain attempt before anything is written, so a failed review never ships its
batch. A reviewer that answers but drops or misaddresses every item is handled as the Lambdas
handle it: the batch keeps its code gates and ships unreviewed, with an error in the run log.
Each try's prompt and response are kept in `.local-packs/<date>/<chain>/attempt-<n>/`, and the
services' structured logs go to `.local-packs/run-<timestamp>.log`; the terminal shows progress and a
summary per date.

The exit code is 0 when every result is `complete` or `skipped`, and 1 for anything `short`,
`failed`, or `aborted`. Cryptic Clue is best-effort: a short Cryptic Clue alone still exits 0.

The run prints the packs table it writes to before it starts. When it exits 1, it prints a `Rerun:`
line of the dates left unfinished; rerunning them generates only what is still missing. When the AWS
credentials expire mid-run, it stops starting work and says so: refresh them, then rerun. Each chain
attempt that made a model call appends a `{ source: 'local' }` entry to the pack's `Usage`, with no
token counts.
