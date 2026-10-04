# Phone Retail ERP: fork record and implementation plan

## Fork point

| | |
|---|---|
| Source | `SoftwareERPmm/Software`, branch `main` |
| Commit | `93902c4de32a7ac53d137235a4dd5dd48759fb56` ("Merge branch 'dev'", 2026-10-04 11:30 +0700) |
| Tag | `phone-retail-base-v1` — this repo's first commit. Its tree is byte-for-byte the source commit above; history was squashed so the repo starts clean (`git diff phone-retail-base-v1 93902c4` after `git fetch upstream` shows nothing). |
| Target | `MaxxNesta/Phone`, its own Neon project (dev / pilot / production), its own Vercel project |

From here on, migrations are independent. A fix worth taking from upstream is
cherry-picked deliberately (`git fetch upstream`), never merged wholesale.

## What the inspection found

The trading ERP already has more of this than the brief assumes:

| Area | State at the fork point |
|---|---|
| Serial / IMEI | **Partial.** `item.tracks_serial`, `stock_serial` (unique per company), `stock_serial_issue` (append-only, counts only while its document stands), `v_stock_serial_available`. Goods Receipt requires serial count = quantity and rejects duplicates. Delivery checks each serial is on the shelf, belongs to the item and sits at the issuing location. |
| Variants | **Done.** Migration 0107: variant = item row with `parent_item_id`; `variant_attribute` / `variant_option`; parents cannot be sold. Fits Product, Variant (256 GB / Black), Serial unit. |
| Barcode / price | `item.barcode`, price levels, volume discounts. Reusable. |
| Counter sale | `postSaleWithDelivery`: one transaction, but it writes **two documents**: a hidden Delivery (Dr 1090 GSNI / Cr Inventory) and the SI (Dr AR / Cr Revenue, Dr COGS / Cr 1090). Net effect is right; the path is the one the brief rules out. |
| Void / amend | Mature (0037, 0054): void posts a mirror entry, amend = void + new version; `document_history` append-only. Reused unchanged. |
| Auth / roles | **None.** `app_user` exists only as an FK target; there is no login, no session, no permission check. Has to be built. |
| Reports | Sales report reads cost from `sales_cost_allocation`. Inventory/COGS reconciliation page reads the same table. |

### Gaps that make serialized stock wrong today

1. **Cost is not the serial's cost.** `planFifoConsumption` draws the oldest
   lot at the location whatever IMEI was scanned. Sell IMEI B (lot @ 1,100)
   while lot A (@ 1,000) is open and the sale is costed 1,000. Totals still
   reconcile; per-unit margin is wrong.
2. **A returned phone stays "sold".** `postSalesReturn` re-creates a lot but
   never touches `stock_serial_issue`, so the IMEI never reappears in
   `v_stock_serial_available`.
3. **A transferred phone stays at the old branch.** `postStockTransfer` makes a
   new lot at the destination; `stock_serial.stock_lot_id` still points at the
   source lot, so the view shows the old location, and the destination is
   refused with "at another location".
4. **Purchase return** cannot name the serial going back.

## Decisions

**D-P1. The Sales Invoice moves the stock.** A retail SI writes its own stock
movements, FIFO consumption and serial issues, and carries Dr COGS / Cr
Inventory in **its own** journal entry beside Dr Cash/AR / Cr Revenue. No
Delivery row, no 1090. `sales_cost_allocation` rows are still written, against
the SI's own consumption, so the sales report and COGS reconciliation keep
working unchanged. (`v_delivery_cost_unclaimed` only reads `DELIVERY`
documents, so the 1090 invariant is unaffected.)
Selected by `company.retail_mode` (default true in this fork). The Delivery path
stays in the code, hidden behind the future Wholesale flag.

**D-P2. A serial is consumed from its own lot.** For `tracks_serial` items the
FIFO planner draws exactly the lot each named serial belongs to. Every other
item keeps ordinary FIFO.

**D-P3. Status is derived, plus a stored overlay for non-movement states.**
IN_STOCK / SOLD / RETURNED / TRANSFERRED come from the movement history, as
0075 intended, so no status column can disagree with the ledger. RESERVED and
REPAIR do not move stock, so they live in a small `stock_serial_hold` table.
`v_stock_serial` exposes one status.

**D-P4. Serial location follows the lot.** A transfer re-points the serial to the
destination lot and appends a `stock_serial_event` row for the history. It never
creates a second serial record.

**D-P5. Auth is new and minimal.** Email + password (Node `scrypt`), an
httpOnly session cookie backed by a `user_session` table, and a fixed
role→permission map in code. Every server action and route checks permission
server-side; the navigation hides what the role cannot use. Roles: Admin,
Manager, Cashier, Salesperson, Inventory Clerk, Accountant.

## Work list

### Reused unchanged
GL / journal engine, chart and posting rules, AR/AP open items and aging,
Goods Receipt and Purchase Invoice (GR/IR), supplier payment, customer
receipt, void/amend/versioning/history, fiscal periods and locking, trial
balance, P&L, balance sheet, cash flow, variants, price levels, barcodes,
branch/warehouse locations, numbering.

### Modified
- `lib/posting.ts`: retail branch in `_postSalesInvoice` (D-P1); serial-exact
  lot draw (D-P2); serials on sales return, purchase return and transfer
  (gaps 2–4); `resolveDeliveryBehind` returns the SI itself when it moved stock.
- `lib/void.ts`: an SI that issued its own stock restores its layers and
  serials on void, as an owned delivery does now.
- `app/nav.tsx`: retail navigation; Sales Order, Delivery, Trips, Routes,
  Coverage hidden unless wholesale mode is on.
- Dashboard: retail KPI cards.

### New
- Migrations: `retail_mode` flag, serial attributes (IMEI 2, warranty months,
  supplier warranty), `stock_serial_hold`, `stock_serial_event`, `v_stock_serial`,
  `app_user` password / role, `user_session`.
- POS screen (`/pos`): barcode/IMEI scan, model search, exact-unit picker,
  accessories, discount, tax, salesperson, split payment, receipt print;
  cost/margin only with `cost.view`.
- Inventory → Phone Stock with filters, IMEI search and per-serial drill-down
  (GR, supplier, SI, customer, returns, transfers, warranty).
- Warranty lookup (IMEI / serial / invoice / customer) and expiry report.
- Reports: sales and margin by brand / model / variant / storage / colour /
  IMEI / salesperson / branch; stock by model / branch, aging, fast/slow movers.
- Login, user admin, role permissions.

### Tests (`scripts/test-phone-*.mjs`, the repo's existing style, against the dev DB)
Purchase, sale, returns, void/amend, transfer, reporting reconciliation and
concurrency: the full list in the brief, §19. Concurrency: two
transactions selling one IMEI; the second must fail on the serial row lock.

## Status (2026-10-04)

Built on `dev`:

- 0117: serial current-layer model, issue → layer/consumption, event log, holds,
  `v_stock_serial`, IMEI 2 / maker's serial / warranty columns, `retail_mode`,
  and a trigger that refuses a second standing issue of one unit.
- `postRetailSale`: SI moves stock, Dr COGS / Cr Inventory in its own entry,
  claim rows on its own layers; void restores each handset to a new layer;
  amend keeps the same handsets; returns, purchase returns, transfers and
  write-offs name exact units. Delivery path also draws exact layers.
- 0118 + `lib/auth*.ts` + `middleware.ts`: sign-in, sessions, six roles,
  path gating, `requirePermission` first in every server action (165),
  discount ceiling, cost stripped server-side for roles without `cost.view`.
- Screens: POS, receipt, Dashboard, IMEI / Serial (+ unit history, holds),
  Inventory summary, Products, Warranty, Sales & margin, Stock & aging,
  Users, global search. Distribution screens hidden unless `retail_mode` off.
- `lib/setup.ts`: fixed the upstream bug that broke company setup on a fresh
  database (it wrote the dropped `tax_code.rate`).
- Tests: `scripts/test-phone-retail.mjs` (purchase, sale, returns, void /
  amend, transfer, write-off, concurrency, reconciliation).

Not yet:

- Opening balances for serial items (existing stock with IMEIs at go-live) —
  the opening batch does not take serials. Receive it on a goods receipt from
  an "Opening stock" supplier for now.
- The goods-receipt and transfer forms still lack an IMEI entry grid; the
  engine and parser accept `serials`/`unitDetails`, the form fields are next.
- Customer-return form: same — engine ready, form field next.
- Document-level `posted_by_id` is stamped by the POS only.

## Out of scope for v1
Repair centre, trade-in valuation, instalments, wholesale delivery, routes,
CRM, forecasting. `stock_serial_hold` (REPAIR) and `stock_serial_event` are the
extension points a repair-intake module would build on.
