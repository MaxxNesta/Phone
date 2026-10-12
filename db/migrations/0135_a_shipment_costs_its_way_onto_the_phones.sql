-- A shipment costs its way onto the phones
--
-- Freight, insurance, customs duty and clearance are part of what a phone
-- cost (IAS 2: purchase price plus the costs of bringing it to its present
-- location). Until now they could only be expensed. A landed cost is a
-- document of its own, linked to posted goods receipts: it gathers the
-- charges, spreads them over the receipts' phones, and on posting moves the
-- money out of Landed Cost Clearing — into inventory for a phone still on
-- the shelf, into cost of sales for one already sold.
--
-- It is a `document` row (doc_type LANDED_COST), so numbering, attachments,
-- history, the journal link and reversal links are the ones every other
-- document uses. The tables below hold what only a landed cost has.
--
-- Where the money comes from: whatever put it into Landed Cost Clearing — a
-- cash or bank payment, a journal voucher crediting the supplier, or (in
-- trading mode) a purchase-invoice service line mapped there. A charge may
-- name that journal line as its source, and a source is used once.
--
-- Seeds only what is missing; nothing a company already has is overwritten.

-- ---------------------------------------------------------------------------
-- The document type and its number prefix.

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check check (doc_type = any (array[
  'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN', 'SUPPLIER_PAYMENT',
  'SALES_ORDER', 'DELIVERY', 'SALES_INVOICE', 'SALES_RETURN', 'CUSTOMER_RECEIPT',
  'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'CASH_VOUCHER', 'BANK_VOUCHER', 'JOURNAL_VOUCHER',
  'CASH_TRANSFER', 'OPENING_BALANCE', 'CONSIGNMENT_RECEIPT', 'CONSIGNMENT_SETTLEMENT',
  'ADVANCE_APPLICATION', 'CREDIT_NOTE', 'DEBIT_NOTE', 'YEAR_END_CLOSE', 'LANDED_COST']));

create or replace function fn_document_prefix(p_type text, p_direction text)
returns text language sql immutable as $$
    select case
        when p_type = 'CASH_VOUCHER' and p_direction = 'OUT' then 'P'
        when p_type = 'CASH_VOUCHER'                         then 'R'
        when p_type = 'BANK_VOUCHER' and p_direction = 'OUT' then 'BP'
        when p_type = 'BANK_VOUCHER'                         then 'BR'

        when p_type = 'CUSTOMER_RECEIPT'    then 'CR'
        when p_type = 'SUPPLIER_PAYMENT'    then 'CP'
        when p_type = 'JOURNAL_VOUCHER'     then 'J'
        when p_type = 'SALES_INVOICE'       then 'DS'
        when p_type = 'SALES_RETURN'        then 'SR'
        when p_type = 'PURCHASE_INVOICE'    then 'DP'
        when p_type = 'PURCHASE_RETURN'     then 'PR'
        when p_type = 'STOCK_TRANSFER'      then 'ST'
        when p_type = 'GOODS_RECEIPT'       then 'STR'
        when p_type = 'DELIVERY'            then 'SI'
        when p_type = 'STOCK_ADJUSTMENT'    then 'SAJ'
        when p_type = 'CREDIT_NOTE'         then 'CN'
        when p_type = 'DEBIT_NOTE'          then 'DN'

        when p_type = 'PURCHASE_ORDER'      then 'PO'
        when p_type = 'SALES_ORDER'         then 'SO'
        when p_type = 'CASH_TRANSFER'       then 'CT'
        when p_type = 'OPENING_BALANCE'     then 'OB'
        when p_type = 'CONSIGNMENT_RECEIPT' then 'CNR'
        when p_type = 'DELIVERY_TRIP'       then 'TRP'
        when p_type = 'BANK_STATEMENT'      then 'BST'
        when p_type = 'YEAR_END_CLOSE'      then 'YEC'
        when p_type = 'LANDED_COST'         then 'LC'

        -- Back, with the reason restated so the next rewrite of this
        -- function keeps it: a journal entry is not a journal voucher, and
        -- GEN is for a type nobody has named yet, not for the one thing
        -- every posting in the system creates.
        when p_type = 'JOURNAL'             then 'JE'
        else 'GEN'
    end;
$$;

-- ---------------------------------------------------------------------------
-- Landed Cost Clearing: where a landed-cost bill waits until it is spread.
-- An asset beside 1090, debited by the bill and credited by the landed cost.

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select a.company_id, a.parent_id, '1095', 'Landed Cost Clearing', 'ASSET', true
  from account a
 where a.code = '1090'
   and not exists (select 1 from account x where x.company_id = a.company_id and x.code = '1095');

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING']));

insert into system_account (company_id, role, account_id)
select a.company_id, 'LANDED_COST_CLEARING', a.id
  from account a
 where a.code = '1095'
   and not exists (select 1 from system_account s
                    where s.company_id = a.company_id and s.role = 'LANDED_COST_CLEARING');

-- ---------------------------------------------------------------------------
-- Cost types and templates: reusable defaults, not transactions.

create table if not exists landed_cost_type (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references company(id),
    code                text not null,
    name                text not null,
    default_method      text not null default 'VALUE'
                        check (default_method in ('VALUE', 'EQUAL', 'MANUAL')),
    clearing_account_id uuid references account(id),
    default_partner_id  uuid references business_partner(id),
    default_currency    char(3) references currency(code),
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    unique (company_id, code)
);

comment on column landed_cost_type.clearing_account_id is
    'Credited when a charge of this type is spread onto the goods; null means '
    'the company''s LANDED_COST_CLEARING account.';

create table if not exists landed_cost_template (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    name        text not null,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    unique (company_id, name)
);

create table if not exists landed_cost_template_line (
    id           uuid primary key default gen_random_uuid(),
    template_id  uuid not null references landed_cost_template(id) on delete cascade,
    line_no      int not null,
    cost_type_id uuid not null references landed_cost_type(id),
    method       text not null check (method in ('VALUE', 'EQUAL', 'MANUAL')),
    unique (template_id, cost_type_id)
);

-- ---------------------------------------------------------------------------
-- The landed cost itself: what a document row does not already carry.
-- Status lives on the document (DRAFT, POSTED, REVERSED); "calculated" is a
-- draft whose allocation is current, recorded here.

create table if not exists landed_cost (
    document_id     uuid primary key references document(id),
    company_id      uuid not null references company(id),
    template_id     uuid references landed_cost_template(id),
    shipment_ref    text,
    carrier_ref     text,
    calculated_at   timestamptz,
    -- A receipt with lines that are not phones (cases, cables) gets none of
    -- the charges in this version; somebody has to say they know that.
    excluded_ack_at timestamptz,
    excluded_ack_by uuid references app_user(id),
    calculated_by   uuid references app_user(id),
    reversed_at     timestamptz,
    reversed_by     uuid references app_user(id),
    reversal_reason text
);

create table if not exists landed_cost_receipt (
    landed_cost_id uuid not null references landed_cost(document_id) on delete cascade,
    receipt_id     uuid not null references document(id),
    primary key (landed_cost_id, receipt_id)
);
create index if not exists landed_cost_receipt_receipt_idx on landed_cost_receipt (receipt_id);

create table if not exists landed_cost_charge (
    id                     uuid primary key default gen_random_uuid(),
    landed_cost_id         uuid not null references landed_cost(document_id) on delete cascade,
    line_no                int not null,
    cost_type_id           uuid not null references landed_cost_type(id),
    partner_id             uuid references business_partner(id),
    -- The journal line that put this money into clearing, where there is one.
    source_journal_line_id uuid references journal_line(id),
    description            text,
    currency               char(3) not null references currency(code),
    exchange_rate          numeric(18,8) not null check (exchange_rate > 0),
    -- The day the rate is for, and who typed it. A linked source keeps its
    -- own: a bill already stored in kyat is never converted again.
    rate_date              date,
    rate_entered_by        uuid references app_user(id),
    fc_amount              numeric(18,4) not null check (fc_amount > 0),
    base_amount            numeric(18,4) not null check (base_amount > 0),
    method                 text not null check (method in ('VALUE', 'EQUAL', 'MANUAL')),
    clearing_account_id    uuid not null references account(id),
    reference              text,
    -- False once the landed cost is reversed or the line removed, which frees
    -- the source for another landed cost.
    is_active              boolean not null default true
);

-- A bill is spread once. Two landed costs both claiming the same freight
-- invoice would put it on the phones twice and leave clearing negative.
create unique index if not exists landed_cost_charge_source_once
    on landed_cost_charge (source_journal_line_id)
 where source_journal_line_id is not null and is_active;

-- Manual allocations, as entered: per charge, per product variant.
create table if not exists landed_cost_manual (
    charge_id uuid not null references landed_cost_charge(id) on delete cascade,
    item_id   uuid not null references item(id),
    amount    numeric(18,4) not null check (amount >= 0),
    primary key (charge_id, item_id)
);

-- What each phone receives from each charge. Rewritten on every calculate
-- while the document is a draft; fixed once posted.
create table if not exists landed_cost_allocation (
    id               uuid primary key default gen_random_uuid(),
    landed_cost_id   uuid not null references landed_cost(document_id) on delete cascade,
    charge_id        uuid not null references landed_cost_charge(id) on delete cascade,
    serial_id        uuid not null references stock_serial(id),
    receipt_id       uuid not null references document(id),
    receipt_line_id  uuid references document_line(id),
    item_id          uuid not null references item(id),
    original_cost    numeric(18,4) not null,
    amount           numeric(18,4) not null check (amount >= 0),
    unique (charge_id, serial_id)
);
create index if not exists landed_cost_allocation_serial_idx on landed_cost_allocation (serial_id);

-- How each phone was treated when the landed cost posted, and again when it
-- was reversed: kept for good, because the answer depends on where the phone
-- was on that day and cannot be worked out again afterwards.
create table if not exists landed_cost_posting (
    id              uuid primary key default gen_random_uuid(),
    landed_cost_id  uuid not null references landed_cost(document_id),
    -- The document whose journal carries this row: the landed cost when it
    -- posted, its reversal when it was undone.
    document_id     uuid not null references document(id),
    serial_id       uuid not null references stock_serial(id),
    status_then     text not null,
    treatment       text not null check (treatment in ('INVENTORY', 'COGS')),
    account_id      uuid not null references account(id),
    location_id     uuid references location(id),
    lot_id          uuid references stock_lot(id),
    consumption_id  uuid references stock_lot_consumption(id),
    amount          numeric(18,4) not null,
    created_at      timestamptz not null default now()
);
create index if not exists landed_cost_posting_serial_idx on landed_cost_posting (serial_id);
create index if not exists landed_cost_posting_consumption_idx on landed_cost_posting (consumption_id);

-- A phone on a layer shared with others is moved onto a layer of its own
-- before its cost changes, since one layer holds one cost. The move is a
-- consumption of the shared layer and a new one-phone layer, both at the same
-- cost and the same warehouse; this records which consumption made which
-- layer, so a later price correction on the shared layer can follow the
-- phone instead of treating the move as a sale.
create table if not exists landed_cost_relayer (
    consumption_id uuid primary key references stock_lot_consumption(id),
    landed_cost_id uuid not null references landed_cost(document_id),
    serial_id      uuid not null references stock_serial(id),
    from_lot_id    uuid not null references stock_lot(id),
    to_lot_id      uuid not null references stock_lot(id)
);

-- What kind of movement, where it is not an ordinary one. COST_LAYER_SPLIT is
-- the −1/+1 pair that moves one phone off a shared layer onto its own: same
-- warehouse, same quantity and value, no journal. Every report and every
-- piece of logic that reads movements as stock coming or going leaves it out.
alter table stock_movement add column if not exists kind text
    check (kind in ('COST_LAYER_SPLIT'));
create index if not exists stock_movement_kind_idx on stock_movement (kind) where kind is not null;

-- ---------------------------------------------------------------------------
-- Seeds: the usual costs of importing phones, and one template for them.

insert into landed_cost_type (company_id, code, name, default_method)
select c.id, t.code, t.name, t.method
  from company c
 cross join (values
   ('FREIGHT',   'International Freight', 'VALUE'),
   ('INSURANCE', 'Insurance',             'VALUE'),
   ('DUTY',      'Customs Duty',          'VALUE'),
   ('CLEARANCE', 'Customs Clearance',     'EQUAL'),
   ('LOCAL',     'Local Transport',       'EQUAL'),
   ('HANDLING',  'Handling',              'EQUAL'),
   ('INSPECT',   'Inspection',            'EQUAL'),
   ('OTHER',     'Other Import Cost',     'VALUE')
 ) as t(code, name, method)
on conflict (company_id, code) do nothing;

insert into landed_cost_template (company_id, name)
select c.id, 'China Phone Import' from company c
on conflict (company_id, name) do nothing;

insert into landed_cost_template_line (template_id, line_no, cost_type_id, method)
select tpl.id, l.line_no, ty.id, l.method
  from landed_cost_template tpl
 cross join (values
   (1, 'FREIGHT',   'VALUE'),
   (2, 'INSURANCE', 'VALUE'),
   (3, 'DUTY',      'VALUE'),
   (4, 'CLEARANCE', 'EQUAL'),
   (5, 'LOCAL',     'EQUAL'),
   (6, 'HANDLING',  'EQUAL')
 ) as l(line_no, code, method)
  join landed_cost_type ty on ty.company_id = tpl.company_id and ty.code = l.code
 where tpl.name = 'China Phone Import'
on conflict (template_id, cost_type_id) do nothing;
