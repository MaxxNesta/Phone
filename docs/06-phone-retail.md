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

**D-P6. Buying in yuan (or any currency), selling in kyat.** Migration 0119.
Documents keep their totals in kyat at the document's own rate, so every
report reads what it always read; the foreign figure is kyat over the rate.
- Goods receipt: stock valued at the rate on the day the goods arrive (typed,
  or the latest MARKET rate in Settings → Currencies).
- Purchase invoice for a receipt: takes the receipt's rate (GR/IR clears to the
  kyat). A bill with no receipt, or one that receives as it posts, uses its own.
- The payable's journal line carries the yuan amount and rate.
- Paying: amounts in the bill's currency; the bill comes down at its carrying
  rate, the bank at today's; the gap is FX gain or loss (both 6340 Exchange
  Rate Gain/Loss since the chart moved to four digits, 0203).
- Advances in yuan paid on or before the goods arrived fix what those goods
  cost (IFRIC 22): applying one to the bill corrects the goods' cost by the
  gap between the bill's rate and the advance's — onto stock held, to cost of
  sales for what has sold — with no exchange on it. An advance paid after
  the goods arrived settles a debt and keeps its exchange difference, as
  does one applied to a bill with nothing received yet.
- Purchase orders may be placed in the supplier's currency; a blank rate takes
  the one on file for the order date.
- Returns and debit notes against a yuan bill go at that bill's rate, so the
  payable comes down at what it was carried at and no FX arises on them.
- `payment_allocation.amount` is the invoice side (kyat at the invoice's rate);
  `base_amount` the payment side (kyat at the payment's rate). Equal for every
  kyat document, so nothing that existed changes.
- Month-end revaluation (0222, 0223; Finance → Transactions → Exchange
  revaluation): what suppliers are owed in a foreign currency, read from the
  supplier ledger, and foreign cash and bank accounts, restated at the
  month-end rate. The difference is unrealised exchange (6341, apart from
  realised 6340), booked on the month end beside the balances (2160, 1150)
  so neither the supplier ledger nor a bank stops agreeing with its detail,
  and reversed the next day. Stock and advances for goods are not restated.
  One standing run per month; a wrong rate is voided and run again. The
  dashboard reminds an accountant while last month is undone.
  `scripts/test-fx-revaluation.mjs`.
- Not yet: sales in foreign currency.

**D-P7. Damaged on arrival: quarantine, then return (agreed 2026-11-20,
built 2026-11-21, 0218–0220, 0224).** Ten ordered, ten arrive, one is broken. The design follows SAP
(blocked stock, then a return delivery that reopens the order) and NetSuite
(a status that cannot be sold, then a vendor return).
- Goods receipt: each line records arrived, accepted and rejected, with a
  reason and the rejected units' IMEIs. Accepted units go to the branch's
  stock; rejected ones go to its quarantine location. Quarantine is still
  stock, at cost, on the balance sheet, but a location flagged not for sale,
  refused by the posting engine for sales, deliveries and the till and left
  out of sellable stock. The PO shows 10 of 10 received.
- On the rejected line the receiver chooses **replace** (the supplier sends
  another) or **credit** (the supplier takes it off what is owed).
- Purchase return, opened from the receipt with the line and IMEIs filled in,
  takes the unit out of quarantine. It must be a return, not a debit note: a
  debit note moves money only, and the unit has to leave stock.
  - Replace: clears GR/IR for the unit, not the payable; the PO reopens 1
    (when the return posts, as SAP's 122 does, not at the receipt); the
    replacement arrives against the PO and the bill stays at 10.
  - Credit: the PO stays complete; the return comes off the receipt if not yet
    billed (the bill is then for 9) or off the bill if it is.
- A supplier who refuses both: write the unit off from quarantine.
- Selling: orders, deliveries, invoices and the till see only sellable stock.
  The engine already refuses a serial at another location ("Transfer it here
  first"); the flag adds the refusal for a sale, delivery or till sale at the
  quarantine location itself, which also covers items without IMEIs. The
  stock position shows quarantine in its own column, never as available, so a
  sales order for 10 against 9 good units reads short 1. Delivered 9, the
  order keeps 1 to deliver: replace fills it from the replacement; credit
  leaves it to other stock or to closing the order's remainder. A
  deliver-later invoice for 10 holds the tenth in 2230 until it goes, or is
  credited if it never can.
- Release: a unit found good after all is transferred back to sellable stock
  with a reason (SAP's release from blocked stock); no other transfer out of
  quarantine.
- Customer returns of faulty phones use the same location: the sales return
  takes the unit into quarantine, not back onto the shelf, and a purchase
  return then sends it to the supplier under the supplier warranty, or it is
  written off.
- As built: quarantine is a bin inside each warehouse ("Main Warehouse /
  Quarantine", `location.is_quarantine`, 0218), made with the warehouse and
  on first use. The building's stock is counted together — the Inventory
  summary folds each bin into its warehouse and says how many units are in
  quarantine; `v_stock_on_hand.warehouse_id` and `fn_stock_home` give the
  warehouse a bin counts in — while anything that sells or picks leaves the
  bin out. The
  database refuses a sales order, invoice or delivery dated there and any
  stock leaving it on a sale or delivery. Transfers in or out need a reason.
  Forms, the till and imports do not offer it; item pickers count sellable
  stock only; stock lists show it as its own location. A receipt line marked
  `rejected` (0219) lands there; the receipt page shows it under its line, prints a
  rejection note and offers the return per outcome. A return line names the
  receipt line it sends back, and a replace return reopens the order
  (`v_order_outstanding`, 0220). `scripts/test-quarantine.mjs`.
- Found faulty after the receipt was posted (0224, built 2026-11-21): the
  receipt does not change. **Report faulty** (on the receipt, or on the IMEI
  page of a unit still on the shelf) writes a `fault_report` against the
  receipt line the unit came in on — what is wrong, replace or credit — and
  moves it into its warehouse's quarantine bin by a transfer that names the
  receipt. From there it goes back exactly as a refused unit: the receipt
  page shows it under its line, the rejection note lists it, and the return
  opens filled in. A replace return goes against the receipt even once it is
  billed and reopens the order (`document_line.for_replacement`, which now
  drives `v_order_outstanding` for both kinds); a credit goes against the bill
  once there is one. A unit already sold is not reported here — it comes back
  as a customer return through a warranty claim (D-P8).
- The three moments, side by side: seen while entering the receipt → refuse
  it on the line; found on the shelf after posting → Report faulty; found by
  the customer after sale → warranty claim, customer return into quarantine,
  then to the supplier.

**D-P8. Warranty claims (0221, built 2026-11-21).** A customer back with a
faulty phone opens a claim: the fault, whether the shop's and the supplier's
warranties covered it on the day (kept, not recomputed), and how it ended —
repaired, replaced, refunded, or turned down with a reason. It moves
nothing; it names the customer return (faulty, into quarantine) and the
supplier return it led to, each recorded on the claim in its own
transaction. Inventory → Warranty lookup → Warranty claims, and from the
phone's own page.

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
