# Backups and restore drill

The ERP keeps its records in Neon Postgres (project with branches dev, pilot,
production) and the files people attach in Cloudflare R2. Both need a copy
that lives somewhere else, and a restore that has been tried.

## 1. What Neon already does

Neon has no nightly backup files. Instead it keeps a **history window** of
every change on each root branch, and can rebuild the database as it was at
any moment inside that window ("instant restore", point-in-time).

| Plan | History window | Cost of history |
|---|---|---|
| Free | 6 hours (max 1 GB of change history) | free |
| Launch | 1 day by default, up to 7 days | $0.20 per GB-month |
| Scale | 1 day by default, up to 30 days | $0.20 per GB-month |

So on the Free plan a mistake noticed the next morning **cannot** be undone
from Neon. That is the gap to close before production goes live.

### Check what you have now

1. Open the Neon console, choose the project, then **Settings → Storage** (or
   **Instant restore** on the branch page). The "history retention" or
   "restore window" shown is the backup you have.
2. Check the plan under **Billing**.

### Set it up

1. Production on **Launch** at least, with the history window raised to the
   maximum (7 days on Launch, up to 30 on Scale). Settings → Storage →
   History retention.
2. A **daily copy outside Neon**, because the history window lives with the
   database it protects. A `pg_dump` once a day, kept for 30 days in R2:

   ```bash
   pg_dump "$PROD_DIRECT_URL" --format=custom --no-owner --file="erp-$(date +%F).dump"
   # then upload erp-YYYY-MM-DD.dump to a private R2 bucket (e.g. erp-backups)
   ```

   This is `.github/workflows/nightly-backup.yml`: every night at 03:00
   Yangon it dumps production with its **direct** (non-pooler) connection,
   checks the dump can be read, uploads it to `postgres/` in the backup
   bucket and deletes copies older than 30 days. It runs from `main` only;
   start it by hand from the Actions tab to test. Its secrets are listed at
   the top of the file.
3. **R2 attachments** have no automatic backup. Turn on bucket replication or
   a weekly copy of the private bucket to a second bucket; product photos in
   the public bucket can be re-uploaded and matter less.

## 2. Restore drill (do this once a month, and before go-live)

The drill restores into a **new branch**, never over production. Nobody's
work is touched.

1. **Pick a restore point.** A time inside the window, e.g. an hour ago.
   Write it down with its time zone: `2026-11-13T09:00:00+06:30`.
2. **Restore into a test branch.** Neon console → production branch →
   **Branches → Create branch → From a point in time** → the time above.
   Name it `restore-test-YYYY-MM-DD`.
3. **Copy its connection string** (direct, not pooler) from Connection
   details. This is the restored database.
4. **Run the check** from the repo:

   ```bash
   RESTORED_URL="<restore-test branch url>" \
   SOURCE_URL="<production url>" \
   RESTORE_POINT="2026-11-13T09:00:00+06:30" \
   npx tsx scripts/verify-restore.mjs
   ```

   It only reads. It checks that every migration is recorded, the key tables
   have rows, the ledger nets to nought, no journal entry is lopsided, no line
   lost its document, and nothing is newer than the restore point. With the
   source it compares each table's rows created up to the restore point, and
   the ledger's totals, which must match because the ledger is append-only.
5. **Look at it with the app** (optional): point a local `.env` at the test
   branch, `npm run dev`, open a few invoices and the trial balance.
6. **From a pg_dump file instead** (the off-Neon copy): create an empty
   branch or database, then
   `pg_restore --no-owner --dbname="<empty db url>" erp-YYYY-MM-DD.dump`, and
   run the same check with `RESTORE_POINT` set to the dump's time.
7. **Delete the test branch** when done, and note the date and the result.

If any check fails, the backup is not trusted until the reason is found.

## 3. A real restore

Restore into a new branch as in the drill, verify it, then point the app at
it (Vercel → Environment Variables → `DATABASE_URL` for Production → redeploy),
or use Neon's "restore branch" to roll production back in place. Work posted
after the restore point is lost either way, so note what has to be re-entered.
