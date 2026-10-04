-- 0005_documents.sql
-- Document headers, lines, and open-item allocation.

-- One header table with a type discriminator rather than a table per
-- document. Purchase and sales lines are structurally identical, and the
-- document-flow link (source_document_id) only works if every document is
-- addressable in one place.

create table document (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),

    doc_type       text not null check (doc_type in (
        'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE',
        'PURCHASE_RETURN', 'SUPPLIER_PAYMENT',
        'SALES_ORDER', 'DELIVERY', 'SALES_INVOICE',
        'SALES_RETURN', 'CUSTOMER_RECEIPT',
        'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'OPENING_BALANCE'
    )),

    -- Assigned at posting, never at draft. Null while DRAFT.
    doc_no         text,
    fiscal_year_id uuid references fiscal_year(id),

    doc_date       date not null,
    posting_date   date not null,
    due_date       date,

    partner_id     uuid references business_partner(id),

    -- Source and destination. Transfers use both; everything else uses the first.
    location_id    uuid references location(id),
    to_location_id uuid references location(id),

    currency       char(3) not null references currency(code),
    exchange_rate  numeric(18,8) not null default 1 check (exchange_rate > 0),
    rate_type      text references rate_type(code),

    -- Reserved with the tax engine deferred. Cannot be retrofitted: there is
    -- no way to tell later whether a historical price already included tax.
    price_includes_tax boolean not null default false,

    status         text not null default 'DRAFT'
        check (status in ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),

    -- Document flow: what this came from.
    source_document_id uuid references document(id),

    -- The posting this document produced.
    journal_entry_id   uuid references journal_entry(id),

    net_total      numeric(18,4) not null default 0,
    tax_total      numeric(18,4) not null default 0,
    gross_total    numeric(18,4) not null default 0,

    memo           text,
    created_at     timestamptz not null default now(),
    created_by     uuid,
    posted_at      timestamptz,

    unique (company_id, doc_type, doc_no),

    -- A posted document must carry its number. It need not carry a journal
    -- entry: orders post nothing by design, and a transfer between locations
    -- sharing an inventory account posts nothing either. Which types must
    -- post is enforced by trg_document_posting below.
    check (status <> 'POSTED' or doc_no is not null)
);

create index on document (company_id, doc_type, posting_date);
create index on document (company_id, partner_id) where partner_id is not null;
create index on document (source_document_id) where source_document_id is not null;
create index on document (company_id, status);

-- Document types that MUST produce a posting once they are posted. Orders
-- and same-account transfers are deliberately absent — they move nothing in
-- the ledger, and requiring an entry from them would force empty postings.
--
-- Deferred to commit, because the journal entry references the document as
-- its source and the document references the entry back; one of the two has
-- to be written second.
create or replace function fn_document_posting_required() returns trigger
language plpgsql as $$
declare
    d document;
begin
    -- Re-read rather than trusting NEW: a deferred trigger fires at commit
    -- with the tuple captured when the event was queued, and the journal
    -- entry is linked after the document row is inserted.
    select * into d from document where id = new.id;
    if not found then
        return null;
    end if;

    if d.status = 'POSTED'
       and d.journal_entry_id is null
       and d.doc_type in (
            'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
            'SUPPLIER_PAYMENT', 'DELIVERY', 'SALES_INVOICE',
            'SALES_RETURN', 'CUSTOMER_RECEIPT', 'STOCK_ADJUSTMENT',
            'OPENING_BALANCE')
    then
        raise exception
            'Document % (%) is posted but has no journal entry',
            d.doc_no, d.doc_type;
    end if;

    return null;
end;
$$;

create constraint trigger trg_document_posting_required
    after insert or update on document
    deferrable initially deferred
    for each row execute function fn_document_posting_required();

-- ---------------------------------------------------------- document lines --

-- Free-of-charge reasons. Stock still moves, but the cost lands in expense
-- rather than COGS, and which expense depends on why it went out.
create table foc_reason (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,          -- PROMOTION, SAMPLE, OFFICE, DAMAGED, STAFF
    name       text not null,
    name_my    text,
    account_id uuid not null references account(id),

    unique (company_id, code)
);

create table document_line (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),
    document_id    uuid not null references document(id) on delete cascade,
    line_no        smallint not null,

    item_id        uuid references item(id),
    description    text,
    location_id    uuid references location(id),

    -- What the user typed, and the same thing in the item's base unit.
    -- Everything downstream reads base_qty; entered_* exists for reprinting
    -- the document as it was keyed.
    entered_qty    numeric(18,4) not null,
    entered_uom_id uuid references uom(id),
    base_qty       numeric(18,4) not null,

    unit_price     numeric(18,4) not null default 0,
    discount_pct   numeric(9,6)  not null default 0,
    discount_amount numeric(18,4) not null default 0,

    -- Trade discount is netted into net_amount and posts nothing. Only
    -- settlement discount gets its own account.
    net_amount     numeric(18,4) not null default 0,
    tax_code_id    uuid references tax_code(id),
    tax_amount     numeric(18,4) not null default 0,
    gross_amount   numeric(18,4) not null default 0,

    foc_reason_id  uuid references foc_reason(id),

    batch_no       text,
    expiry_date    date,

    -- Document flow at line level, for partial fulfilment.
    source_line_id uuid references document_line(id),

    unique (document_id, line_no),
    check (foc_reason_id is null or unit_price = 0)
);

create index on document_line (document_id);
create index on document_line (company_id, item_id);
create index on document_line (source_line_id) where source_line_id is not null;

-- ------------------------------------------------------- open-item matching --

-- This is what makes AR/AP an open-item subledger rather than a
-- balance-forward running total. A payment is matched against the specific
-- invoices it settles, which is the only way partial payments, disputed
-- invoices, and credit notes produce a truthful aging report.

create table payment_allocation (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),

    -- The payment, receipt, or credit note doing the settling.
    payment_id     uuid not null references document(id),
    -- The invoice being settled.
    invoice_id     uuid not null references document(id),

    amount         numeric(18,4) not null check (amount <> 0),
    base_amount    numeric(18,4) not null,

    -- Realised FX difference when invoice and payment rates differ.
    fx_amount      numeric(18,4) not null default 0,

    created_at     timestamptz not null default now(),

    unique (payment_id, invoice_id)
);

create index on payment_allocation (company_id, invoice_id);
create index on payment_allocation (company_id, payment_id);

-- An allocation may never exceed what the invoice still owes.
create or replace function fn_allocation_within_invoice() returns trigger
language plpgsql as $$
declare
    v_invoice_total numeric(18,4);
    v_allocated     numeric(18,4);
begin
    select gross_total into v_invoice_total
      from document where id = new.invoice_id;

    select coalesce(sum(amount), 0) into v_allocated
      from payment_allocation
     where invoice_id = new.invoice_id
       and id <> new.id;

    if abs(v_allocated + new.amount) > abs(v_invoice_total) then
        raise exception
            'Allocation of % would over-apply invoice % (total %, already allocated %)',
            new.amount, new.invoice_id, v_invoice_total, v_allocated;
    end if;

    return new;
end;
$$;

create trigger trg_allocation_within_invoice
    before insert or update on payment_allocation
    for each row execute function fn_allocation_within_invoice();
