-- Money arrives by a channel
--
-- A customer pays in cash, by bank transfer, by card, or through a mobile
-- wallet (KBZPay, AYA Pay, WavePay, MMQR). Until now the till only asked which
-- cash or bank ACCOUNT the money went into. That is the ledger's question; the
-- shop's question is how the customer paid, and with what reference.
--
-- A payment channel answers it. Each channel names the account its money lands
-- in — company-wide, or a different account at a particular branch — and
-- whether a transaction reference must be taken. Nothing about posting
-- changes: a channel is resolved to its account before the posting engine
-- runs, and every payment is still the CUSTOMER_RECEIPT document it always
-- was. The receipt now also remembers the channel and the reference.
--
-- Providers are data, not code: a shop adds its own channels, and the
-- accounting engine never names one.
--
-- 1. payment_channel          what a customer can pay with
-- 2. payment_channel_account  where that money lands (default + per branch)
-- 3. document.payment_channel_id / payment_reference, one posted payment per reference
-- 4. fn_seed_payment_channels  the starting set, for existing and new companies
-- 5. fn_location_branch        the branch (top-level location) a location is in

-- ---- 5 (needed by the others) --------------------------------------------
create or replace function fn_location_branch(p_location uuid) returns uuid
language sql stable as $$
    with recursive up as (
        select id, parent_id from location where id = p_location
        union all
        select l.id, l.parent_id from location l join up on l.id = up.parent_id
    )
    select id from up where parent_id is null limit 1
$$;

comment on function fn_location_branch(uuid) is
    'The top-level location (branch) a location sits under; itself when it is one.';

-- ---- 1 -------------------------------------------------------------------
create table if not exists payment_channel (
    id                 uuid primary key default gen_random_uuid(),
    company_id         uuid not null references company(id),
    code               text not null,
    name               text not null,
    -- How the money moves. Drives the till (cash gives change; the rest must
    -- be exact) and how the chip is drawn — never which account is posted.
    kind               text not null check (kind in ('CASH', 'BANK', 'WALLET', 'QR', 'CARD', 'OTHER')),
    is_active          boolean not null default true,
    requires_reference boolean not null default false,
    merchant_name      text,
    merchant_number    text,
    sort_order         int not null default 100,
    created_at         timestamptz not null default now(),
    created_by_id      uuid references app_user(id),
    updated_at         timestamptz not null default now(),
    updated_by_id      uuid references app_user(id),
    unique (company_id, code),
    unique (company_id, name)
);

comment on table payment_channel is
    'How a customer can pay (cash, bank transfer, card, a mobile wallet). Each maps to a cash or bank account.';

-- ---- 2 -------------------------------------------------------------------
create table if not exists payment_channel_account (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    channel_id  uuid not null references payment_channel(id) on delete cascade,
    -- Null: the account used at every branch without its own.
    branch_id   uuid references location(id),
    account_id  uuid not null references account(id),
    updated_at  timestamptz not null default now(),
    updated_by_id uuid references app_user(id)
);

create unique index if not exists payment_channel_account_one
    on payment_channel_account (channel_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Money can only land in an account that holds money, of the same company.
create or replace function fn_check_payment_channel_account() returns trigger
language plpgsql as $$
begin
    if not exists (
        select 1 from account a
         where a.id = new.account_id and a.company_id = new.company_id and a.is_cash_account
    ) then
        raise exception 'A payment channel can only pay into a cash or bank account';
    end if;
    if not exists (select 1 from payment_channel c where c.id = new.channel_id and c.company_id = new.company_id) then
        raise exception 'That payment channel belongs to another company';
    end if;
    if new.branch_id is not null and not exists (
        select 1 from location l
         where l.id = new.branch_id and l.company_id = new.company_id and l.parent_id is null
    ) then
        raise exception 'A channel account can only be set for a branch of this company';
    end if;
    return new;
end $$;

drop trigger if exists trg_check_payment_channel_account on payment_channel_account;
create trigger trg_check_payment_channel_account
    before insert or update on payment_channel_account
    for each row execute function fn_check_payment_channel_account();

-- Which account a channel pays into at a location: the branch's own, else the default.
create or replace function fn_payment_channel_account(p_channel uuid, p_location uuid) returns uuid
language sql stable as $$
    select m.account_id
      from payment_channel_account m
     where m.channel_id = p_channel
       and (m.branch_id is null or m.branch_id = fn_location_branch(p_location))
     order by m.branch_id is null
     limit 1
$$;

-- ---- 3 -------------------------------------------------------------------
alter table document add column if not exists payment_channel_id uuid references payment_channel(id);
-- The wallet or bank's own transaction id, as the customer's screen shows it.
-- Kept apart from document.reference, which already means other things.
alter table document add column if not exists payment_reference text;

create index if not exists document_payment_channel
    on document (company_id, payment_channel_id) where payment_channel_id is not null;

-- One posted payment per wallet or bank transaction reference: the same
-- KBZPay transaction recorded twice is one payment taken twice. A voided
-- receipt frees its reference to be recorded again.
create unique index if not exists document_payment_reference_once
    on document (company_id, payment_channel_id, lower(payment_reference))
 where payment_channel_id is not null and payment_reference is not null and status = 'POSTED'
   and doc_type = 'CUSTOMER_RECEIPT';

-- ---- 4 -------------------------------------------------------------------
create or replace function fn_seed_payment_channels(p_company uuid) returns void
language plpgsql as $$
declare
    v_cash uuid;
    v_bank uuid;
begin
    insert into payment_channel (company_id, code, name, kind, requires_reference, sort_order) values
        (p_company, 'CASH',   'Cash',               'CASH',   false, 10),
        (p_company, 'BANK',   'Bank Transfer',      'BANK',   true,  20),
        (p_company, 'KBZPAY', 'KBZPay',             'WALLET', true,  30),
        (p_company, 'AYAPAY', 'AYA Pay',            'WALLET', true,  40),
        (p_company, 'WAVE',   'WavePay',            'WALLET', true,  50),
        (p_company, 'MMQR',   'MMQR',               'QR',     true,  60),
        (p_company, 'CARD',   'Debit/Credit Card',  'CARD',   false, 70),
        (p_company, 'OTHER',  'Other',              'OTHER',  false, 90)
    on conflict do nothing;

    -- Reuse the chart as it is: cash to Cash on Hand, bank and card to Cash at
    -- Bank. Wallets wait for their own account, made when a shop needs one.
    select id into v_cash from account
     where company_id = p_company and is_cash_account and not is_bank_account and is_postable and is_active
     order by (code = '1000') desc, code limit 1;
    select id into v_bank from account
     where company_id = p_company and is_bank_account and is_postable and is_active
     order by (code = '1010') desc, code limit 1;

    if v_cash is not null then
        insert into payment_channel_account (company_id, channel_id, account_id)
        select p_company, c.id, v_cash from payment_channel c
         where c.company_id = p_company and c.code = 'CASH'
        on conflict do nothing;
    end if;
    if v_bank is not null then
        insert into payment_channel_account (company_id, channel_id, account_id)
        select p_company, c.id, v_bank from payment_channel c
         where c.company_id = p_company and c.code in ('BANK', 'CARD')
        on conflict do nothing;
    end if;
end $$;

select fn_seed_payment_channels(id) from company;

-- Receipts recorded before channels existed: the ones into Cash on Hand were
-- cash. The rest are left unlabelled rather than guessed at; reports show
-- those by account.
update document d set payment_channel_id = c.id
  from journal_line jl, account a, payment_channel c
 where d.doc_type = 'CUSTOMER_RECEIPT' and d.payment_channel_id is null
   and jl.journal_entry_id = d.journal_entry_id and jl.base_amount > 0
   and a.id = jl.account_id and a.is_cash_account and not a.is_bank_account
   and c.company_id = d.company_id and c.code = 'CASH'
   and exists (select 1 from payment_channel_account m where m.channel_id = c.id and m.account_id = a.id);

-- Every change to how money is taken, and who made it.
create table if not exists payment_channel_audit (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    channel_id uuid references payment_channel(id) on delete set null,
    action     text not null,
    detail     jsonb,
    acted_by   uuid references app_user(id),
    acted_at   timestamptz not null default now()
);
create index if not exists payment_channel_audit_channel on payment_channel_audit (channel_id, acted_at desc);
