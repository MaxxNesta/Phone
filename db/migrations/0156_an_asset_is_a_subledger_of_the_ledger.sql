-- An asset is a subledger of the ledger
--
-- Fixed assets feed the General Ledger; they are not a second one. Every
-- money figure here either waits to be posted or points at the journal line
-- that carries it. Postings go through the ordinary journal voucher, so the
-- period lock, the balance check, the branch rule and the numbering are the
-- ones every other posting obeys.
--
--   fa_setting           how the company depreciates and posts (one row)
--   fa_category          a class of asset and the three accounts it moves
--   fixed_asset          one asset: cost, life, residual, branch, status
--   fa_estimate_change   a new life or residual, from a month onwards
--   fa_run               one branch's depreciation for one month: one voucher
--   fa_depreciation      one asset's depreciation for one month, and the
--                        journal line that carries it (run, history or
--                        correction)
--   fa_journal_link      a posted line tied to an asset: its acquisition,
--                        its disposal, or anything else
--   fa_event             what happened to an asset, append-only

-- ------------------------------------------------------------- setting --

create table if not exists fa_setting (
    company_id        uuid primary key references company(id) on delete cascade,
    -- MANUAL: calculate and show, link journals by hand, never post.
    -- REVIEW: draft vouchers, an authorised person approves and posts.
    -- AUTO:   the scheduler posts each closed month by itself.
    posting_mode      text not null default 'MANUAL'
                      check (posting_mode in ('MANUAL', 'REVIEW', 'AUTO')),
    -- When the first month's depreciation falls.
    --   NEXT_MONTH  the month after the asset goes into service
    --   SAME_MONTH  the month it goes into service, in full
    --   DAILY       that month by the days left in it
    start_convention  text not null default 'NEXT_MONTH'
                      check (start_convention in ('NEXT_MONTH', 'SAME_MONTH', 'DAILY')),
    gain_account_id   uuid references account(id),
    loss_account_id   uuid references account(id),
    updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------ category --

create table if not exists fa_category (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references company(id) on delete cascade,
    code                text not null,
    name                text not null,
    -- Tangible assets depreciate; software amortises. Kept apart so the two
    -- never add up into one figure.
    asset_class         text not null default 'TANGIBLE'
                        check (asset_class in ('TANGIBLE', 'INTANGIBLE')),
    asset_account_id    uuid not null references account(id),
    accum_account_id    uuid not null references account(id),
    expense_account_id  uuid not null references account(id),
    method              text not null default 'STRAIGHT_LINE' check (method in ('STRAIGHT_LINE')),
    default_life_months int check (default_life_months is null or default_life_months between 1 and 1200),
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    unique (company_id, code),
    check (asset_account_id <> accum_account_id and asset_account_id <> expense_account_id
           and accum_account_id <> expense_account_id)
);

-- --------------------------------------------------------------- asset --

create table if not exists fixed_asset (
    id                      uuid primary key default gen_random_uuid(),
    company_id              uuid not null references company(id) on delete cascade,
    code                    text not null,
    name                    text not null,
    category_id             uuid not null references fa_category(id),
    -- The branch it belongs to (a top-level location) and where in it.
    branch_id               uuid not null references location(id),
    site                    text,
    serial_no               text,
    supplier_id             uuid references business_partner(id),
    acquisition_date        date not null,
    in_service_date         date,
    acquisition_cost        numeric(18,4) not null check (acquisition_cost >= 0),
    residual_value          numeric(18,4) not null default 0 check (residual_value >= 0),
    useful_life_months      int not null check (useful_life_months between 1 and 1200),
    method                  text not null default 'STRAIGHT_LINE' check (method in ('STRAIGHT_LINE')),
    -- Null: the company's convention.
    start_convention        text check (start_convention in ('NEXT_MONTH', 'SAME_MONTH', 'DAILY')),
    status                  text not null default 'DRAFT'
                            check (status in ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'INACTIVE')),
    -- Depreciation stops after this month (a disposal or a write-off).
    disposed_on             date,
    notes                   text,
    created_by              uuid references app_user(id),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (company_id, code),
    check (residual_value <= acquisition_cost),
    check (in_service_date is null or in_service_date >= acquisition_date),
    check (status <> 'ACTIVE' or in_service_date is not null)
);
create index if not exists fixed_asset_company_status on fixed_asset (company_id, status);
create index if not exists fixed_asset_category on fixed_asset (category_id);
create index if not exists fixed_asset_branch on fixed_asset (branch_id);

-- A change of estimate is prospective: the net book value at the start of
-- the month is spread over what is left from then on. History is not redone.
create table if not exists fa_estimate_change (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references company(id) on delete cascade,
    asset_id            uuid not null references fixed_asset(id) on delete cascade,
    effective_month     date not null check (extract(day from effective_month) = 1),
    useful_life_months  int not null check (useful_life_months between 1 and 1200),
    residual_value      numeric(18,4) not null check (residual_value >= 0),
    reason              text not null,
    created_by          uuid references app_user(id),
    created_at          timestamptz not null default now(),
    unique (asset_id, effective_month)
);

-- ----------------------------------------------------------------- run --

create table if not exists fa_run (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id) on delete cascade,
    branch_id        uuid not null references location(id),
    period_month     date not null check (extract(day from period_month) = 1),
    mode             text not null check (mode in ('MANUAL', 'REVIEW', 'AUTO')),
    status           text not null default 'DRAFT'
                     check (status in ('DRAFT', 'POSTED', 'FAILED', 'CANCELLED')),
    total            numeric(18,4) not null default 0,
    document_id      uuid references document(id),
    journal_entry_id uuid references journal_entry(id),
    error            text,
    created_by       uuid references app_user(id),
    approved_by      uuid references app_user(id),
    created_at       timestamptz not null default now(),
    posted_at        timestamptz,
    check (status <> 'POSTED' or (document_id is not null and journal_entry_id is not null))
);
-- One live run per branch and month. Two processes racing for the same
-- month: the second insert waits on the first and then fails, so a month is
-- never drafted or posted twice.
create unique index if not exists fa_run_one_live_per_month
    on fa_run (company_id, branch_id, period_month) where status in ('DRAFT', 'POSTED');

-- -------------------------------------------------------- depreciation --

create table if not exists fa_depreciation (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id) on delete cascade,
    asset_id         uuid not null references fixed_asset(id),
    period_month     date not null check (extract(day from period_month) = 1),
    -- RUN: this module's own voucher. HISTORICAL: an existing journal linked
    -- to the month. CORRECTION: an authorised adjustment entry, never an
    -- edit of a posted one.
    source           text not null check (source in ('RUN', 'HISTORICAL', 'CORRECTION')),
    amount           numeric(18,4) not null,
    opening_nbv      numeric(18,4),
    closing_nbv      numeric(18,4),
    run_id           uuid references fa_run(id),
    -- The accumulated-depreciation line of the voucher that carries it.
    -- Null only while its run is a draft.
    journal_line_id  uuid references journal_line(id),
    note             text,
    created_by       uuid references app_user(id),
    created_at       timestamptz not null default now(),
    check (source <> 'RUN' or run_id is not null),
    check (source = 'RUN' or journal_line_id is not null),
    check (source = 'CORRECTION' or amount > 0)
);
create index if not exists fa_depreciation_asset on fa_depreciation (asset_id, period_month);
create index if not exists fa_depreciation_run on fa_depreciation (run_id);
create index if not exists fa_depreciation_line on fa_depreciation (journal_line_id);
-- An asset's month is carried once, by a run or by history; corrections
-- add to it afterwards.
create unique index if not exists fa_depreciation_once_per_month
    on fa_depreciation (asset_id, period_month) where source in ('RUN', 'HISTORICAL');

-- ---------------------------------------------------------------- link --

create table if not exists fa_journal_link (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id) on delete cascade,
    asset_id         uuid not null references fixed_asset(id) on delete cascade,
    journal_line_id  uuid not null references journal_line(id),
    kind             text not null check (kind in ('ACQUISITION', 'DISPOSAL', 'OTHER')),
    amount           numeric(18,4) not null check (amount > 0),
    note             text,
    created_by       uuid references app_user(id),
    created_at       timestamptz not null default now(),
    unique (asset_id, journal_line_id, kind)
);
create index if not exists fa_journal_link_line on fa_journal_link (journal_line_id);

/*
 * No journal line is spent twice. What is allocated to assets from one line
 * (as depreciation or as an acquisition) cannot add up to more than the line
 * itself. Checked per line, under a lock on that line, so two people linking
 * the same journal at once cannot both squeeze under the limit.
 */
create or replace function fn_fa_line_not_overallocated() returns trigger
language plpgsql as $$
declare
    cap numeric;
    used numeric;
begin
    if new.journal_line_id is null then
        return new;
    end if;
    select abs(base_amount) into cap from journal_line where id = new.journal_line_id for update;
    select coalesce((select sum(abs(amount)) from fa_depreciation where journal_line_id = new.journal_line_id), 0)
         + coalesce((select sum(amount) from fa_journal_link where journal_line_id = new.journal_line_id), 0)
      into used;
    if used > cap + 0.0001 then
        raise exception 'That journal line is %; its links to assets would come to %.', cap, used
            using errcode = 'check_violation';
    end if;
    return new;
end $$;

drop trigger if exists fa_depreciation_line_cap on fa_depreciation;
create constraint trigger fa_depreciation_line_cap after insert or update on fa_depreciation
    deferrable initially deferred for each row execute function fn_fa_line_not_overallocated();
drop trigger if exists fa_journal_link_line_cap on fa_journal_link;
create constraint trigger fa_journal_link_line_cap after insert or update on fa_journal_link
    deferrable initially deferred for each row execute function fn_fa_line_not_overallocated();

/*
 * A posted figure is not edited. A depreciation row that a journal carries
 * can be removed only as part of unlinking history (a HISTORICAL row), never
 * changed in place; a later change is a CORRECTION row with its own entry.
 */
create or replace function fn_fa_depreciation_posted_is_fixed() returns trigger
language plpgsql as $$
begin
    if tg_op = 'UPDATE' and old.journal_line_id is not null
       and (new.amount, new.asset_id, new.period_month, new.journal_line_id)
           is distinct from (old.amount, old.asset_id, old.period_month, old.journal_line_id) then
        raise exception 'Posted depreciation is not edited; record a correction instead.';
    end if;
    if tg_op = 'DELETE' and old.journal_line_id is not null and old.source <> 'HISTORICAL' then
        raise exception 'Posted depreciation is not deleted; record a correction instead.';
    end if;
    return coalesce(new, old);
end $$;

drop trigger if exists fa_depreciation_posted_fixed on fa_depreciation;
create trigger fa_depreciation_posted_fixed before update or delete on fa_depreciation
    for each row execute function fn_fa_depreciation_posted_is_fixed();

-- --------------------------------------------------------------- event --

create table if not exists fa_event (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id) on delete cascade,
    asset_id         uuid not null references fixed_asset(id) on delete cascade,
    event_type       text not null check (event_type in (
                       'CREATED', 'UPDATED', 'ACTIVATED', 'ESTIMATE_CHANGED', 'TRANSFERRED',
                       'DISPOSED', 'DEPRECIATION_POSTED', 'HISTORY_LINKED', 'HISTORY_UNLINKED',
                       'CORRECTED', 'EXCEPTION', 'DEACTIVATED', 'REACTIVATED')),
    event_date       date not null,
    from_branch_id   uuid references location(id),
    to_branch_id     uuid references location(id),
    detail           jsonb not null default '{}'::jsonb,
    created_by       uuid references app_user(id),
    created_at       timestamptz not null default now()
);
create index if not exists fa_event_asset on fa_event (asset_id, event_date);
create index if not exists fa_event_company_date on fa_event (company_id, event_date);

create or replace function fn_fa_event_append_only() returns trigger
language plpgsql as $$
begin
    raise exception 'The asset history is append-only.';
end $$;
drop trigger if exists fa_event_append_only on fa_event;
create trigger fa_event_append_only before update on fa_event
    for each row execute function fn_fa_event_append_only();

-- ---------------------------------------------------------------- seed --

/*
 * The categories a chart already describes. Each fixed-asset account under a
 * fixed-asset heading is paired with the accumulated-depreciation account and
 * the expense account that name the same thing ("Accumulated Dep; Generator &
 * Solar", "Depreciation For Generator/Solar"). Matched by name, so another
 * chart can be mapped by hand in Settings; nothing is posted from a name.
 */
create or replace function fn_fa_seed_categories(p_company uuid) returns int
language plpgsql as $$
declare
    a record;
    acc uuid;
    exp uuid;
    key text;
    made int := 0;
begin
    insert into fa_setting (company_id) values (p_company) on conflict do nothing;
    for a in
        select x.id, x.code, x.name
          from account x join account p on p.id = x.parent_id
         where x.company_id = p_company and x.account_type = 'ASSET' and x.is_postable and x.is_active
           and p.indirect_role = 'FIXED_ASSET'
           and lower(x.name) !~ 'accumulated|amortisation|amortization'
    loop
        -- "Generator & Solar" and "Generator/Solar" are one key.
        key := regexp_replace(lower(split_part(a.name, '/', 1)), '[^a-z0-9]+', '', 'g');
        key := left(key, 8);
        select y.id into acc from account y
         where y.company_id = p_company and y.is_postable and y.account_type = 'ASSET'
           and lower(y.name) ~ '^accumulated'
           and regexp_replace(lower(y.name), '[^a-z0-9]+', '', 'g') like '%' || key || '%'
         order by y.code limit 1;
        select z.id into exp from account z
         where z.company_id = p_company and z.is_postable and z.account_type = 'EXPENSE'
           and lower(z.name) ~ '^(depreciation|amortisation|amortization)'
           and regexp_replace(lower(z.name), '[^a-z0-9]+', '', 'g') like '%' || key || '%'
         order by z.code limit 1;
        if acc is null or exp is null then
            continue;
        end if;
        insert into fa_category (company_id, code, name, asset_class, asset_account_id, accum_account_id, expense_account_id)
        values (p_company, a.code, a.name,
                case when exists (select 1 from account e where e.id = exp and lower(e.name) ~ '^amorti') then 'INTANGIBLE' else 'TANGIBLE' end,
                a.id, acc, exp)
        on conflict (company_id, code) do nothing;
        if found then made := made + 1; end if;
    end loop;
    return made;
end $$;

comment on function fn_fa_seed_categories(uuid) is
    'Fixed-asset categories from the chart: each asset account paired with its accumulated-depreciation and expense accounts by name. Idempotent.';

select fn_fa_seed_categories(id) from company;
