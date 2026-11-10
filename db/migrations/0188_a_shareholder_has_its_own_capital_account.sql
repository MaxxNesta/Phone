-- A shareholder has its own capital account
--
-- Owners here put money in as amounts, not as numbered shares: Royal, ACT and
-- RD each have an equity account (Shares -Royal, ...) and their payments are
-- ordinary cash and bank vouchers credited to it. Linking the shareholder to
-- that account lets the equity pages show each owner's capital and the
-- vouchers behind it straight from the ledger, without a share issue that
-- would post the same money a second time.
--
-- Number of shares and price per share are what the owners agreed, entered
-- by hand and editable; null until someone enters them. They post nothing.

alter table shareholder
    add column if not exists equity_account_id uuid references account(id),
    add column if not exists no_of_shares      bigint        check (no_of_shares >= 0),
    add column if not exists share_price       numeric(18,4) check (share_price >= 0);

-- One owner per capital account: two sharing one would each show the other's money.
create unique index if not exists shareholder_equity_account
    on shareholder (company_id, equity_account_id) where equity_account_id is not null;
