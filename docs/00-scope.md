# Scope — v1

This page exists so that in month four, when a client asks for payroll, there
is something to point at.

## In

| Area | Contents |
|---|---|
| **Purchase cycle** | Purchase order → goods receipt → purchase invoice → payment, plus purchase returns |
| **Sales cycle** | Sales order → delivery → sales invoice → receipt, plus sales returns |
| **Inventory** | Multi-location stock, per-warehouse FIFO valuation (see [decisions D2](03-decisions.md)), adjustments, transfers, unit hierarchy |
| **AR / AP** | Open-item subledgers with invoice-level matching and aging |
| **General ledger** | Chart of accounts, journal entries, fiscal periods with locking, trial balance, P&L, balance sheet |
| **Multi-currency** | Per-transaction rate capture, base-currency conversion, realised FX gain/loss on settlement |
| **Masters** | Business partners, items, warehouses, accounts, currencies, price levels |

## Out — deliberately

| Deferred | Why |
|---|---|
| **Commercial Tax engine** | Clients currently handle CT outside their ERP; the incumbent's entire tax feature is a `TaxFree` checkbox. Schema holes are reserved now (see below), logic comes later. |
| **Consignment** | A real Myanmar requirement and a genuine competitive gap, but it depends on inventory and posting being correct first. v1.5. |
| **Payroll / HR** | Separate domain, separate regulations (SSB, PIT). Additive. |
| **CRM** | Not why anyone buys an ERP here. |
| **Manufacturing** | BOM and work orders are a different product. |
| **Multi-company consolidation** | Schema carries `company_id` from day one; consolidation reporting comes later. |
| **Mobile / offline sync** | Architecturally significant and expensive. Not until the core is proven. |
| **Approval workflows** | Permissions in v1; workflow engine later. |
| **Report builder** | Fixed reports in v1. The incumbent's ~100 canned reports are table stakes eventually, not now. |

## Tax carve-out

Tax logic is deferred; tax *shape* is not. Retrofitting these means migrating
every historical document line, and the inclusive/exclusive flag is
unrecoverable after the fact — there is no way to tell later whether an old
price already had CT in it.

Reserved from day one:

- `tax_code` on every document line, pointing at a `NONE` code
- `net_amount`, `tax_amount`, `gross_amount` per line — `tax_amount` always 0
- `price_includes_tax` flag on the document header
- a reserved tax line slot in the posting matrix

Roughly a day of work now. Weeks of migration later.

## The non-negotiables

Cheap to build now, effectively impossible to retrofit once there is live
client data:

| | Why it can't wait |
|---|---|
| Dimensions on every journal line (cost centre, project, branch) | Retrofitting means re-posting all history |
| `company_id` on every table | Single-company schemas never recover |
| Per-line currency + rate + base amount | Adding a second currency later is a rewrite |
| Immutability and audit trail | Once users depend on editing, it can't be taken away |
| Fiscal period locking | Otherwise a stray posting silently changes an audited year |
| Unit-of-measure conversions | Distribution runs on case/dozen/piece; bolting it on corrupts stock |
| Unicode-native text storage | The whole point |
