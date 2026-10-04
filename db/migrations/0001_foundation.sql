-- 0001_foundation.sql
-- Company, currency, fiscal calendar, locations, document numbering.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- company --

create table company (
    id                uuid primary key default gen_random_uuid(),
    code              text        not null unique,
    name              text        not null,
    name_my           text,
    base_currency     char(3)     not null,          -- 'MMK'
    fiscal_year_start_month  smallint not null default 4
        check (fiscal_year_start_month between 1 and 12),
    created_at        timestamptz not null default now()
);

comment on column company.fiscal_year_start_month is
    'Myanmar has moved its fiscal year more than once. Configurable, never hardcoded.';

-- --------------------------------------------------------------- currency --

create table currency (
    code           char(3)  primary key,             -- ISO 4217
    name           text     not null,
    symbol         text,
    decimal_places smallint not null default 2
);

insert into currency (code, name, symbol, decimal_places) values
    ('MMK', 'Myanmar Kyat',  'K',  0),
    ('USD', 'US Dollar',     '$',  2),
    ('THB', 'Thai Baht',     '฿',  2),
    ('SGD', 'Singapore Dollar', 'S$', 2),
    ('CNY', 'Chinese Yuan',  '¥',  2);

-- Rate types matter here: the CBM reference rate, the market rate, and a
-- negotiated contract rate routinely disagree, and companies book against
-- different ones depending on the transaction.
create table rate_type (
    code text primary key,
    name text not null
);

insert into rate_type (code, name) values
    ('OFFICIAL', 'Central Bank reference rate'),
    ('MARKET',   'Market rate'),
    ('CONTRACT', 'Contracted rate');

create table exchange_rate (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid    not null references company(id),
    from_currency  char(3) not null references currency(code),
    to_currency    char(3) not null references currency(code),
    rate_type      text    not null references rate_type(code),
    valid_from     date    not null,
    rate           numeric(18,8) not null check (rate > 0),
    created_at     timestamptz not null default now(),

    unique (company_id, from_currency, to_currency, rate_type, valid_from),
    check (from_currency <> to_currency)
);

create index on exchange_rate (company_id, from_currency, to_currency, valid_from desc);

-- Resolve the rate in force on a given date.
create or replace function fn_exchange_rate(
    p_company uuid, p_from char(3), p_to char(3), p_type text, p_date date
) returns numeric language sql stable as $$
    select case when p_from = p_to then 1::numeric else (
        select r.rate
          from exchange_rate r
         where r.company_id    = p_company
           and r.from_currency = p_from
           and r.to_currency   = p_to
           and r.rate_type     = p_type
           and r.valid_from   <= p_date
         order by r.valid_from desc
         limit 1
    ) end;
$$;

-- --------------------------------------------------------- fiscal calendar --

create table fiscal_year (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    code        text not null,                       -- '2026-27'
    start_date  date not null,
    end_date    date not null,
    status      text not null default 'OPEN'
        check (status in ('OPEN', 'CLOSED')),

    unique (company_id, code),
    check (end_date > start_date)
);

create table fiscal_period (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid     not null references company(id),
    fiscal_year_id uuid     not null references fiscal_year(id),
    period_no      smallint not null check (period_no between 1 and 12),
    start_date     date     not null,
    end_date       date     not null,
    status         text     not null default 'OPEN'
        check (status in ('OPEN', 'CLOSED', 'PERMANENTLY_CLOSED')),

    unique (company_id, fiscal_year_id, period_no),
    check (end_date >= start_date)
);

create index on fiscal_period (company_id, start_date, end_date);

comment on column fiscal_period.status is
    'CLOSED can be reopened by an administrator. PERMANENTLY_CLOSED cannot — '
    'used once a year is audited and signed.';

-- Resolve the period containing a posting date. Null means no period exists,
-- which the ledger trigger treats as a hard error.
create or replace function fn_period_for(p_company uuid, p_date date)
returns fiscal_period language sql stable as $$
    select p.* from fiscal_period p
     where p.company_id = p_company
       and p_date between p.start_date and p.end_date
     limit 1;
$$;

-- -------------------------------------------------------------- locations --

-- Arbitrary depth: Branch > Sub Branch > Location Group > Location.
-- Only leaf locations flagged `is_stock_location` may hold inventory.
create table location (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references company(id),
    parent_id         uuid references location(id),
    code              text not null,
    name              text not null,
    name_my           text,
    is_stock_location boolean not null default false,
    is_active         boolean not null default true,
    created_at        timestamptz not null default now(),

    unique (company_id, code)
);

create index on location (company_id, parent_id);

-- ------------------------------------------------------ document numbering --

-- Gapless, per company, per document type, per fiscal year. The counter is
-- taken under a row lock at posting time, never at draft.
create table number_series (
    id             uuid primary key default gen_random_uuid(),
    company_id     uuid not null references company(id),
    document_type  text not null,
    fiscal_year_id uuid references fiscal_year(id),
    prefix         text not null default '',
    padding        smallint not null default 6,
    next_value     bigint   not null default 1,

    unique (company_id, document_type, fiscal_year_id)
);

create or replace function fn_next_document_no(
    p_company uuid, p_type text, p_fiscal_year uuid
) returns text language plpgsql as $$
declare
    s number_series;
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = p_type
       and fiscal_year_id is not distinct from p_fiscal_year
     for update;

    if not found then
        raise exception 'No number series for % in company %', p_type, p_company;
    end if;

    update number_series set next_value = next_value + 1 where id = s.id;

    return s.prefix || lpad(s.next_value::text, s.padding, '0');
end;
$$;
