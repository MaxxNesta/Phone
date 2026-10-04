# Database

Plain SQL migrations. The schema is the source of truth — whichever ORM sits
on top (Drizzle, Prisma, raw `pg`) reads from this, not the other way round.
Run them in filename order.

```bash
psql "$DATABASE_URL" -f db/migrations/0001_foundation.sql
# ...through 0008
```

## Conventions

| | |
|---|---|
| **Primary keys** | `uuid` with `gen_random_uuid()`. Chosen over `bigserial` because offline sync is a known future requirement and client-generated IDs make it tractable. |
| **Money** | `numeric(18,4)` — exact, never float. Four decimals covers USD cents and the MMK rounding tail. |
| **Quantities** | `numeric(18,4)`, always stored in the item's **base unit**. Case/dozen/piece is a display and entry concern, never a storage one. |
| **Exchange rates** | `numeric(18,8)`. |
| **Tenancy** | `company_id` on every business table, in every unique key. |
| **Timestamps** | `timestamptz`, always. Business dates are `date`. |
| **Naming** | `snake_case`, singular table names. |
| **Burmese text** | `name_my` alongside `name` on masters. UTF-8 Unicode only — legacy font encodings are converted at import, never stored. |

## Debits and credits

`journal_line.amount` is **signed**: positive is a debit, negative is a credit.
A single signed column makes the fundamental invariant a plain
`sum(...) = 0`, and makes the "both columns filled" bug impossible.

Reporting that wants two columns gets them from `v_journal_line` (0008),
which splits the sign back out into `debit` and `credit`.

## What the database enforces itself

These are not application concerns. They hold even if someone connects with
`psql` and starts typing.

| Rule | How |
|---|---|
| Every journal entry balances, per currency | Deferred constraint trigger on commit |
| Posted entries are never updated or deleted | Trigger raises on `UPDATE`/`DELETE` |
| Nothing posts into a closed period | Trigger checks `fiscal_period.status` |
| Stock movements are append-only | Trigger raises on `UPDATE`/`DELETE` |
| Document numbers are gapless per series | Row-locked counter in `number_series` |

Correctness that lives only in application code is correctness that a
background job, a bulk import, or next year's developer will eventually
bypass.

## schema.sql

`schema.sql` is a generated snapshot of the whole structure in one file —
tables, views, functions and triggers as they currently stand. Useful for
reading, for handing to a DBA, or for diffing after a migration.

It is **not** how the database gets built. The migrations are, and they run
in order. Regenerate the snapshot after adding one:

```bash
pg_dump -h 127.0.0.1 -p 5433 -U erp_dev -d myanmar_erp_dev   --schema-only --no-owner --no-privileges -f db/schema.sql
```

Never edit it by hand.

## Files

| | |
|---|---|
| `0001_foundation.sql` | Company, currency, exchange rates, fiscal calendar, locations, numbering |
| `0002_accounts.sql` | Chart of accounts (arbitrary depth), dimensions |
| `0003_masters.sql` | Units, items, item groups, partners, price levels, tax codes |
| `0004_ledger.sql` | Journal entries and lines, plus the invariant triggers |
| `0005_documents.sql` | Document headers, lines, and payment allocation |
| `0006_stock.sql` | Append-only stock movements |
| `0007_determination.sql` | Account determination rules |
| `0008_views.sql` | Trial balance, stock on hand, open items, GR/IR |
