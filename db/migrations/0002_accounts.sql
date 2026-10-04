-- 0002_accounts.sql
-- Chart of accounts and posting dimensions.

-- Arbitrary depth via parent_id. Deliberately not the incumbent's fixed
-- four levels with hardcoded numeric code ranges — that design exhausts its
-- code space and cannot be reorganised for a client whose books don't fit it.
-- Here the code is a label; the tree is the structure.

create type account_type as enum (
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'REVENUE',
    'COGS',
    'EXPENSE'
);

create table account (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    parent_id    uuid references account(id),
    code         text not null,
    name         text not null,
    name_my      text,
    account_type account_type not null,

    -- Only leaves are postable. Parents exist to aggregate.
    is_postable  boolean not null default true,

    -- Control accounts are written by the subledgers (AR, AP, inventory) and
    -- must never be posted to by a manual journal entry, or the subledger
    -- stops reconciling to the ledger.
    is_control   boolean not null default false,

    -- Set for accounts denominated in a single foreign currency, e.g. a USD
    -- bank account. Null means the account accepts any currency.
    currency     char(3) references currency(code),

    is_active    boolean not null default true,
    created_at   timestamptz not null default now(),

    unique (company_id, code)
);

create index on account (company_id, parent_id);
create index on account (company_id, account_type);

-- Debit-normal types increase with a positive signed amount.
create or replace function fn_is_debit_normal(p_type account_type)
returns boolean language sql immutable as $$
    select p_type in ('ASSET', 'COGS', 'EXPENSE');
$$;

-- ------------------------------------------------------- system accounts --

-- The eleven accounts the posting engine needs by role rather than by code.
-- Mapped once per client during onboarding.
create table system_account (
    company_id uuid not null references company(id),
    role       text not null,
    account_id uuid not null references account(id),

    primary key (company_id, role),
    check (role in (
        'GRIR_CLEARING',
        'PURCHASE_PRICE_VARIANCE',
        'PURCHASE_DISCOUNT_RECEIVED',
        'SALES_DISCOUNT_ALLOWED',
        'STOCK_ADJUSTMENT',
        'PROMOTION_EXPENSE',
        'FX_GAIN',
        'FX_LOSS',
        'ROUNDING_DIFFERENCE',
        'OPENING_BALANCE_EQUITY',
        'RETAINED_EARNINGS'
    ))
);

-- ------------------------------------------------------------ dimensions --

-- Explicit columns rather than a generic entity-attribute table: dimensions
-- are queried and grouped constantly, and EAV makes every report a join
-- puzzle. Adding a fourth dimension later is one column and one backfill;
-- adding dimensions after go-live with none at all is a full re-post.

create table cost_center (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,
    name       text not null,
    name_my    text,
    is_active  boolean not null default true,

    unique (company_id, code)
);

create table project (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,
    name       text not null,
    name_my    text,
    is_active  boolean not null default true,

    unique (company_id, code)
);
