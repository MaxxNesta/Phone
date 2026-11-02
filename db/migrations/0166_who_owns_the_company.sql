-- Who owns the company
--
-- Shareholders and the movements that change what each one holds. Three
-- answers, kept together rather than in three spreadsheets: who the owners
-- are (shareholder), how many shares each holds, and which transaction
-- changed that (share_transfer, replayed in date order).
--
--   ISSUE     the company creates shares and gives them to a shareholder.
--             Posts Dr the asset account (the money received), Cr the
--             equity account.
--   PURCHASE  the company buys shares back from a shareholder. Posts the
--             reverse: Dr equity, Cr asset.
--   TRANSFER  shares move from one shareholder to another. Ownership only:
--             the company's equity is unchanged, so nothing is posted.
--
-- A shareholder record alone holds nothing. Its folio number is given the
-- first time it receives shares, and from then on it can transfer or sell
-- them. Share numbers are ranges (1–6000); an issue takes numbers no earlier
-- issue of that type used, and a transfer or purchase must move numbers the
-- giver actually holds — checked by the app, which replays the transfers.

create table if not exists shareholder (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    code        text not null,
    name        text not null,
    -- An organisation (Horizon Ventures LLC) rather than a person.
    is_company  boolean not null default false,
    -- Given on the first shares received; null until then.
    folio_no    text,
    phone       text,
    email       text,
    address     text,
    notes       text,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    unique (company_id, code),
    unique (company_id, folio_no)
);

create table if not exists share_transfer (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references company(id),
    transfer_no         text not null,
    transfer_type       text not null check (transfer_type in ('ISSUE', 'PURCHASE', 'TRANSFER')),
    transfer_date       date not null,
    from_shareholder_id uuid references shareholder(id),
    to_shareholder_id   uuid references shareholder(id),
    share_type          text not null check (share_type in ('EQUITY', 'PREFERENCE')),
    no_of_shares        integer not null check (no_of_shares > 0),
    from_no             integer not null check (from_no > 0),
    to_no               integer not null,
    rate                numeric(18,4) not null check (rate >= 0),
    amount              numeric(18,4) not null,
    equity_account_id   uuid not null references account(id),
    -- The money side: required for an issue or a purchase, absent for a transfer.
    asset_account_id    uuid references account(id),
    journal_entry_id    uuid references journal_entry(id),
    status              text not null default 'POSTED' check (status in ('POSTED', 'CANCELLED')),
    cancel_entry_id     uuid references journal_entry(id),
    remarks             text,
    created_by_id       uuid references app_user(id),
    created_at          timestamptz not null default now(),
    cancelled_at        timestamptz,
    unique (company_id, transfer_no),
    constraint share_transfer_range check (to_no - from_no + 1 = no_of_shares),
    constraint share_transfer_parties check (
         (transfer_type = 'ISSUE'    and to_shareholder_id is not null and from_shareholder_id is null and asset_account_id is not null)
      or (transfer_type = 'PURCHASE' and from_shareholder_id is not null and to_shareholder_id is null and asset_account_id is not null)
      or (transfer_type = 'TRANSFER' and from_shareholder_id is not null and to_shareholder_id is not null
                                     and from_shareholder_id <> to_shareholder_id and asset_account_id is null))
);

create index if not exists share_transfer_company_date on share_transfer (company_id, transfer_date, transfer_no);
create index if not exists share_transfer_from on share_transfer (from_shareholder_id);
create index if not exists share_transfer_to on share_transfer (to_shareholder_id);

comment on table shareholder is 'An owner of the company. Holds nothing until a share transfer gives it shares.';
comment on table share_transfer is 'An issue, buy-back or owner-to-owner transfer of a range of shares. Replayed in date order to give holdings.';
