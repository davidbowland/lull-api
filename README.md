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
