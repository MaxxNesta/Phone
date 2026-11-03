-- Purchases from the old system
--
-- Purchase invoices copied in from the previous software's report, kept as a
-- record of what was bought, from whom, at what price, and which IMEIs came
-- in on each bill. Historical only: importing one moves no stock, writes no
-- journal and opens no payable — those balances arrive through opening
-- stock and opening balances, and posting them again here would count them
-- twice. Hence tables of their own, not rows in document, which every stock,
-- ledger and aging query reads.
--
-- The old document id (s126010003) stays on the record and is searchable;
-- the new number (HPI-2026-00001) is given on import.

create table if not exists historical_purchase_invoice (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references company(id),
    invoice_no          text not null,
    old_ref             text not null,
    doc_date            date not null,
    partner_id          uuid not null references business_partner(id),
    location_id         uuid not null references location(id),
    -- As the old system printed it: Credit, Cash.
    payment             text,
    supplier_invoice_no text,
    remark              text,
    total_qty           numeric(18,4) not null default 0,
    gross_total         numeric(18,2) not null default 0,
    item_discount       numeric(18,2) not null default 0,
    voucher_discount    numeric(18,2) not null default 0,
    advance_pay         numeric(18,2) not null default 0,
    paid_amount         numeric(18,2) not null default 0,
    net_total           numeric(18,2) not null default 0,
    currency            text not null default 'MMK',
    exchange_rate       numeric(18,6) not null default 1,
    -- Which upload brought it in (HIMP-000001) and from what file.
    batch_ref           text not null,
    filename            text,
    created_at          timestamptz not null default now(),
    created_by          uuid,
    unique (company_id, invoice_no),
    -- One old invoice is imported once: a second upload of the same report
    -- shows it as already imported rather than doubling it.
    unique (company_id, old_ref)
);

create table if not exists historical_purchase_invoice_line (
    id          uuid primary key default gen_random_uuid(),
    invoice_id  uuid not null references historical_purchase_invoice(id) on delete cascade,
    line_no     int not null,
    item_id     uuid not null references item(id),
    -- The code and name the old report printed, kept even if the item is renamed later.
    item_code   text not null,
    description text,
    qty         numeric(18,4) not null check (qty > 0),
    unit_price  numeric(18,2) not null,
    amount      numeric(18,2) not null,
    remark      text,
    serials     text[] not null default '{}',
    unique (invoice_id, line_no)
);

create index if not exists historical_purchase_invoice_partner_idx on historical_purchase_invoice (company_id, partner_id, doc_date);
create index if not exists historical_purchase_invoice_line_serials_idx on historical_purchase_invoice_line using gin (serials);
