# Working with Claude on this repo

**Phone Retail ERP** (`MaxxNesta/Phone`): a controlled fork of a trading ERP,
taken at source commit 93902c4 (2026-10-04). What changed for phone retail and
why: [docs/06-phone-retail.md](docs/06-phone-retail.md). Read it first.

## Read first

- [docs/06-phone-retail.md](docs/06-phone-retail.md) — the fork, the retail
  posting decision (the sales invoice moves the stock; no delivery, no 1090),
  serial/IMEI model, auth, and what is still to build
- [docs/04-development.md](docs/04-development.md) — setup, scripts, and the
  hard rules for touching the ledger (never write outside `lib/posting.ts`,
  never store a derived figure, corrections are reversals, never edit an
  applied migration)
- [docs/02-posting-matrix.md](docs/02-posting-matrix.md) — what every document
  type does to the ledger (trading flow; retail differs as 06 describes)
- [docs/01-document-flow.md](docs/01-document-flow.md) and
  [docs/03-decisions.md](docs/03-decisions.md) — inherited design decisions
- [docs/05-ui-rebuild.md](docs/05-ui-rebuild.md) — how the theme is layered;
  `--brand` (green, the interface accent) is separate from `--dr` (the debit
  colour). Phone-retail screens use `app/erp/retail.css`.

## Git

- Commits use the repo-local identity (MaxxNesta, noreply). No co-author or
  tool attribution lines in commits or PR descriptions.
- All work goes on `dev`; merge into `main` to release.
- Stage explicit paths, never `-A`/`.`.

## Databases

A separate Neon project from the trading ERP, with its own branches (dev,
pilot, production). **Never point this app at the trading ERP's database.**

| Neon branch | Endpoint | Company name (sidebar) | Used by |
| --- | --- | --- | --- |
| dev | `ep-winter-leaf` | MTK — DEV | local `.env`, Vercel **Preview** (`dev`, feature branches) |
| pilot | `ep-billowing-boat` | MTK | not on Vercel yet — a tester site would be a second project |
| production | `ep-flat-cloud` | My Company | Vercel **Production** (`main`) |

Vercel project: `phone` (`prj_An3yNI7CyId5eWUApfKkPqvVmTD4`) in team
"Kaung Htet's projects", linked to `MaxxNesta/Phone`. `DATABASE_URL` is set per
environment there. The sidebar company name is how to tell which database is
on screen; keep the three distinct.

- Local `.env` points at **dev**. Test suites under `scripts/` empty
  transactions on whatever `DATABASE_URL` points at — never run them against
  pilot or production.
- Migrations are not run by the build. Apply by hand before deploying code
  that needs them: `npm run db:migrate` (dev via `.env`), then
  `DATABASE_URL="<pilot url>" npm run db:migrate`, and the same for
  production, before pushing the code that depends on them.
- A fresh database: `npm run db:migrate`, then
  `npx tsx scripts/bootstrap.mjs "Shop Name" CODE`, then open `/login` to
  create the first administrator.

## Auth

Sign-in is required everywhere except `/login` and `/setup`. Roles and
permissions live in `lib/auth-core.ts`; `middleware.ts` gates pages by path and
every server action in `lib/actions.ts` calls `requirePermission` first. A new
server action must do the same — the menu hiding a link is not access control.

## Working style

- Long pasted "advice" documents about this app's design: verify every claim
  against the code before implementing it.
- For a broad request or a hard-to-reverse design fork, survey the code for
  the real options and offer a small set of grounded choices.
