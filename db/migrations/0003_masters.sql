-- 0003_masters.sql
-- Units, items, partners, pricing, tax codes.

-- ------------------------------------------------------------------ units --

create table uom (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,          -- PCS, DOZ, BOX, KG
    name       text not null,
    name_my    text,

    unique (company_id, code)
);

-- ------------------------------------------------------------ item groups --

-- Drives account determination. An item's group decides which inventory,
-- COGS, and revenue accounts its postings land in.
create table item_group (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    parent_id  uuid references item_group(id),
    code       text not null,
    name       text not null,
    name_my    text,
    is_active  boolean not null default true,

    unique (company_id, code)
);

create index on item_group (company_id, parent_id);

-- ------------------------------------------------------------------ items --

create table item (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references company(id),
    item_group_id uuid not null references item_group(id),
    code          text not null,
    name          text not null,
    name_my       text,

    base_uom_id   uuid not null references uom(id),

    -- Weighted average for v1 (see decision D2). The column exists so the
    -- valuation layer stays pluggable — expiry-tracked goods will want FIFO.
    valuation_method text not null default 'WEIGHTED_AVERAGE'
        check (valuation_method in ('WEIGHTED_AVERAGE', 'FIFO')),

    -- Services, delivery charges, labour. Priced and invoiced, never stocked.
    is_stocked    boolean not null default true,

    tracks_batch  boolean not null default false,
    tracks_expiry boolean not null default false,

    is_active     boolean not null default true,
    created_at    timestamptz not null default now(),

    unique (company_id, code)
);

create index on item (company_id, item_group_id);

-- Barcodes and supplier part numbers resolving to the same item.
create table item_alias (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    item_id    uuid not null references item(id) on delete cascade,
    alias      text not null,

    unique (company_id, alias)
);

-- Case / dozen / piece. Quantities are always *stored* in the item's base
-- unit; this table only converts what the user typed.
create table item_uom (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    item_id    uuid not null references item(id) on delete cascade,
    uom_id     uuid not null references uom(id),

    -- Quantity of base units in one of this unit. 1 Box = 120 pieces -> 120.
    factor     numeric(18,4) not null check (factor > 0),

    unique (company_id, item_id, uom_id)
);

create table item_reorder (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    item_id     uuid not null references item(id) on delete cascade,
    location_id uuid not null references location(id),
    min_qty     numeric(18,4),
    max_qty     numeric(18,4),

    unique (company_id, item_id, location_id)
);

-- ---------------------------------------------------------------- pricing --

create table price_level (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,
    name       text not null,
    sort_order smallint not null default 0,

    unique (company_id, code)
);

create table item_price (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),
    item_id        uuid not null references item(id) on delete cascade,
    price_level_id uuid not null references price_level(id),
    uom_id         uuid not null references uom(id),
    currency       char(3) not null references currency(code),
    price          numeric(18,4) not null check (price >= 0),
    valid_from     date not null default current_date,

    unique (company_id, item_id, price_level_id, uom_id, currency, valid_from)
);

-- ------------------------------------------------------------- tax codes --

-- No tax engine in v1 (decision: deferred). The shape is reserved because it
-- cannot be retrofitted — see docs/00-scope.md. Every document line points at
-- a tax code; for now they all point at NONE.
create table tax_code (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references company(id),
    code              text not null,
    name              text not null,
    rate              numeric(9,6) not null default 0 check (rate >= 0),
    output_account_id uuid references account(id),   -- tax collected on sales
    input_account_id  uuid references account(id),   -- tax paid on purchases
    is_active         boolean not null default true,

    unique (company_id, code)
);

-- --------------------------------------------------------------- partners --

-- One table with role flags rather than separate customer and vendor tables.
-- In this market the same company is routinely both, and splitting them
-- means reconciling one legal entity against itself.
create table business_partner (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),
    code           text not null,
    name           text not null,
    name_my        text,
    company_name   text,

    is_customer    boolean not null default false,
    is_supplier    boolean not null default false,

    -- Control accounts. Null falls back to the company default in
    -- account_determination.
    ar_control_id  uuid references account(id),
    ap_control_id  uuid references account(id),

    currency       char(3) references currency(code),
    price_level_id uuid references price_level(id),
    payment_terms_days smallint not null default 0,
    credit_limit   numeric(18,4),
    default_discount_pct numeric(9,6) not null default 0,

    township       text,
    address        text,
    phone          text,

    is_active      boolean not null default true,
    created_at     timestamptz not null default now(),

    unique (company_id, code),
    check (is_customer or is_supplier)
);

create index on business_partner (company_id, is_customer) where is_customer;
create index on business_partner (company_id, is_supplier) where is_supplier;
