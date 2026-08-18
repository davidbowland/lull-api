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

```bash
for d in $(date -u +%F) $(date -u -v+1d +%F); do
  aws lambda invoke --function-name lull-api-CreatePackFunction \
    --payload "$(printf '{"date":"%s"}' "$d")" --cli-binary-format raw-in-base64-out \
    /dev/stdout
done
```

Then confirm: `curl https://lull-api.dbowland.com/v1/packs/$(date -u +%F)`.

The handler validates the date's format and refuses anything malformed, and `createPack` tops
up rather than replacing, so re-running these is safe.

## Why the retry runs at 05:33 UTC

The shelf renders the player's **local** date; these schedules target **UTC** dates. Local day
X ends at 15:00 UTC for UTC+9, so a repair at 15:33 UTC landed after the day it was repairing
had already finished for everyone from Japan eastward. 05:33 is after the nightly and before
any local day ends.
