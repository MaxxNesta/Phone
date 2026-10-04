-- 0004_ledger.sql
-- The general ledger, and the constraints that make it trustworthy.
--
-- Everything here is enforced by the database rather than the application.
-- Correctness that lives only in application code is correctness a bulk
-- import, a background job, or next year's developer will eventually bypass.

-- ------------------------------------------------------------ entry header --

create table journal_entry (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id),
    entry_no         text not null,
    entry_date       date not null,
    fiscal_period_id uuid not null references fiscal_period(id),

    -- What produced this posting. Null only for manual journal entries.
    source_type      text,
    source_id        uuid,

    memo             text,

    -- Reversal pairing. A wrong entry is never edited; it is reversed and
    -- replaced, and both halves stay visible forever.
    reverses_entry_id    uuid references journal_entry(id),
    reversed_by_entry_id uuid references journal_entry(id),

    created_at       timestamptz not null default now(),
    created_by       uuid,

    unique (company_id, entry_no)
);

create index on journal_entry (company_id, entry_date);
create index on journal_entry (company_id, fiscal_period_id);
create index on journal_entry (source_type, source_id);

-- ------------------------------------------------------------- entry lines --

-- `amount` and `base_amount` are SIGNED: positive is a debit, negative is a
-- credit. One signed column makes the fundamental invariant a plain sum = 0
-- and makes the "both debit and credit populated" bug unrepresentable.
-- Reporting gets two columns back from v_journal_line in 0008.

create table journal_line (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id),
    journal_entry_id uuid not null references journal_entry(id),
    line_no          smallint not null,

    account_id       uuid not null references account(id),

    -- Transaction currency, and the same value converted to company base.
    currency         char(3) not null references currency(code),
    amount           numeric(18,4) not null,
    exchange_rate    numeric(18,8) not null default 1 check (exchange_rate > 0),
    base_amount      numeric(18,4) not null,

    -- Dimensions. Present from the first migration because retrofitting them
    -- means re-posting every entry ever made.
    location_id      uuid references location(id),
    cost_center_id   uuid references cost_center(id),
    project_id       uuid references project(id),

    -- Set on control-account lines so the subledger can reconcile to the GL.
    partner_id       uuid references business_partner(id),

    memo             text,

    unique (journal_entry_id, line_no),
    check (amount <> 0)
);

create index on journal_line (company_id, account_id);
create index on journal_line (journal_entry_id);
create index on journal_line (company_id, partner_id) where partner_id is not null;
create index on journal_line (company_id, cost_center_id) where cost_center_id is not null;

-- =========================================================================
-- INVARIANT 5 — nothing posts into a closed period
-- =========================================================================

create or replace function fn_journal_entry_period() returns trigger
language plpgsql as $$
declare
    p fiscal_period;
begin
    select * into p
      from fiscal_period
     where company_id = new.company_id
       and new.entry_date between start_date and end_date
     limit 1;

    if not found then
        raise exception
            'No fiscal period covers % for company %', new.entry_date, new.company_id;
    end if;

    if p.status <> 'OPEN' then
        raise exception
            'Fiscal period % is %; cannot post on %', p.period_no, p.status, new.entry_date;
    end if;

    new.fiscal_period_id := p.id;
    return new;
end;
$$;

create trigger trg_journal_entry_period
    before insert on journal_entry
    for each row execute function fn_journal_entry_period();

-- =========================================================================
-- INVARIANT 1 — every entry balances
-- =========================================================================
-- Deferred to commit, because lines are necessarily inserted one at a time
-- and the entry is only required to balance once the transaction is done.

create or replace function fn_entry_balanced() returns trigger
language plpgsql as $$
declare
    v_sum   numeric(18,4);
    v_lines integer;
begin
    select coalesce(sum(base_amount), 0), count(*)
      into v_sum, v_lines
      from journal_line
     where journal_entry_id = new.journal_entry_id;

    if v_lines < 2 then
        raise exception
            'Journal entry % has % line(s); a posting needs at least two',
            new.journal_entry_id, v_lines;
    end if;

    if v_sum <> 0 then
        raise exception
            'Journal entry % does not balance; base amounts sum to %',
            new.journal_entry_id, v_sum;
    end if;

    return null;
end;
$$;

create constraint trigger trg_entry_balanced
    after insert on journal_line
    deferrable initially deferred
    for each row execute function fn_entry_balanced();

-- An entry with no lines at all would never fire the trigger above.
create or replace function fn_entry_has_lines() returns trigger
language plpgsql as $$
begin
    if not exists (select 1 from journal_line where journal_entry_id = new.id) then
        raise exception 'Journal entry % has no lines', new.entry_no;
    end if;
    return null;
end;
$$;

create constraint trigger trg_entry_has_lines
    after insert on journal_entry
    deferrable initially deferred
    for each row execute function fn_entry_has_lines();

-- =========================================================================
-- Immutability — corrections are reversals, never edits
-- =========================================================================

create or replace function fn_journal_entry_immutable() returns trigger
language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        raise exception
            'Journal entries cannot be deleted. Post a reversal instead.';
    end if;

    -- Linking a reversal is the only permitted change.
    if (new.company_id, new.entry_no, new.entry_date, new.fiscal_period_id,
        new.source_type, new.source_id, new.memo, new.reverses_entry_id,
        new.created_at, new.created_by)
       is distinct from
       (old.company_id, old.entry_no, old.entry_date, old.fiscal_period_id,
        old.source_type, old.source_id, old.memo, old.reverses_entry_id,
        old.created_at, old.created_by)
    then
        raise exception
            'Journal entry % is immutable. Post a reversal instead.', old.entry_no;
    end if;

    return new;
end;
$$;

create trigger trg_journal_entry_immutable
    before update or delete on journal_entry
    for each row execute function fn_journal_entry_immutable();

create or replace function fn_journal_line_immutable() returns trigger
language plpgsql as $$
begin
    raise exception
        'Journal lines are immutable. Reverse the entry and post a new one.';
end;
$$;

create trigger trg_journal_line_immutable
    before update or delete on journal_line
    for each row execute function fn_journal_line_immutable();

-- =========================================================================
-- Account guards
-- =========================================================================

create or replace function fn_journal_line_account_guard() returns trigger
language plpgsql as $$
declare
    a account;
    e journal_entry;
begin
    select * into a from account where id = new.account_id;

    if not a.is_postable then
        raise exception
            'Account % (%) is a heading and cannot be posted to', a.code, a.name;
    end if;

    if not a.is_active then
        raise exception 'Account % (%) is inactive', a.code, a.name;
    end if;

    if a.currency is not null and a.currency <> new.currency then
        raise exception
            'Account % is denominated in % but the line is in %',
            a.code, a.currency, new.currency;
    end if;

    -- Control accounts belong to their subledger. A hand-typed journal entry
    -- posting straight to AR is how a subledger silently stops reconciling.
    if a.is_control then
        select * into e from journal_entry where id = new.journal_entry_id;
        if e.source_type is null then
            raise exception
                'Account % is a control account and cannot be posted to by a manual journal entry',
                a.code;
        end if;
        if new.partner_id is null then
            raise exception
                'Control account % requires partner_id on the line', a.code;
        end if;
    end if;

    return new;
end;
$$;

create trigger trg_journal_line_account_guard
    before insert on journal_line
    for each row execute function fn_journal_line_account_guard();
