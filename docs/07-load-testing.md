# Load, soak and spike testing

Finished on 11 Oct 2026. The app passes at 50 concurrent users, stays stable for
3 hours at 15 users, and recovers from a sudden jump from 20 to 50 users. The
ramp, 50-user and spike runs ended with books, stock and IMEIs checked and consistent.

All tests ran against **dev only**: the deployed dev app, Vercel cle1, and the
dev Neon database (ep-winter-leaf) in us-east-2. Pilot and production were
never touched.

## Results

| Test | Load | Failures | Page p95 | Posting p95 | Data checks |
|---|---|---|---|---|---|
| Ramp | 5 → 10 → 20 users, 3 min each | 0 | 975 ms max | 1,139 ms max | 13/13 |
| 50 users | 50 users, 3 min | 0 | 860 ms | 1,229 ms | 33/33 |
| Spike | 20 → 50 in 10 s → 20 | 0 | 1,151 ms | 2,504 ms at the peak, 1,020 ms after | 37/37 |
| Soak | 15 users, 3 hours | 0 (36,047 requests, 8,328 documents) | 1.1 s → 1.5 s | 817 → 883 ms median | – |
| Deadlocks, postings | 24 workers × 180 s | 0 (was 10 in 60 s) | – | – | – |
| Deadlocks, voids and corrections | 24 workers × 90 s | 0 (was 65) | – | – | – |

At 50 users the app posts about 157 documents a minute. Every same-IMEI race,
where two users sell one phone at the same moment, sold the phone exactly once.

## Defects the tests found, all fixed

| Defect | Found by | Fix |
|---|---|---|
| The 1,000th document number of a day was cut to 3 digits, and every posting after it failed | ramp | e6df1fa, migration 0130 |
| Any unique-key error was reported as "already being posted" | ramp | e6df1fa |
| Deadlocks between postings of two documents (sale + receipt) at 50 users | ramp | a1fc6cd |
| Income statement took 15–20 s (no index on `document.journal_entry_id`) | soak | cd3bc8e, migration 0131 |
| A goods receipt line with more than about 7,280 IMEIs failed (Postgres parameter limit) | setup | 3e375a6 |
| Deadlocks between voids or corrections and postings | targeted repro | 3dbf5eb |

Migrations 0130 and 0131 are applied on dev. They go to pilot and production
together with the code that needs them.

## Known limits

- During a spike, posting p95 rises to about 2.5 s while up to 4 postings wait
  on the day's number-series locks. It returns to normal as soon as load drops.
  Every posting takes the journal series, so a single company's posting rate
  has a ceiling.
- Over 3 hours page p95 drifted from 1.1 s to 1.5 s. Nothing failed.

## Running them again

The scripts are in `loadtest/`. k6 v2.3 and a dev `DATABASE_URL` are required.
`setup.mjs`, `verify.mjs`, `cleanup.mjs` and `deadlock-repro.mjs` refuse any
database that isn't dev.

```bash
npx tsx loadtest/setup.mjs                  # test users, stock, IMEIs → loadtest/run.json
LT_SECONDS=300 node loadtest/dbmon.mjs fifty &   # samples the database every 5 s
k6 run -e BASE=<deployed dev url> -e VJWT=<_vercel_jwt cookie> \
  -e ACTIONS=./actions-deployed.json -e PROFILE=fifty \
  --out csv=results/fifty-points.csv loadtest/erp.js
LT_LABEL=fifty node loadtest/report.mjs     # per-stage table → results/report-fifty.json
npx tsx loadtest/verify.mjs                 # stock, ledger, IMEI and payment checks
npx tsx loadtest/cleanup.mjs                # ends the sessions, retires the test data
```

`PROFILE` is one of `smoke`, `ramp`, `fifty`, `spike` or `soak` (`SOAK_VUS`,
`SOAK_DURATION`). `node loadtest/soak-report.mjs` summarises a soak in
15-minute windows. Deadlocks are reproduced against the database directly:
`MODE=void W=24 S=90 npx tsx loadtest/deadlock-repro.mjs`. Run it in a Vercel
Sandbox in cle1, next to the database, because from a laptop the round trip
hides the contention.

Server-action IDs change with every build. Take `actions-deployed.json` from
the deployed build being tested.
