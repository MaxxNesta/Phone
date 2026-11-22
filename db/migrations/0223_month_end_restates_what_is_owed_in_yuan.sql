-- Month end restates what is owed in yuan (docs/06 D-P6).
--
-- A bill in yuan is carried in kyat at the rate on the day it was booked.
-- At month end the balance sheet should say what that yuan is worth now, so
-- the revaluation restates every foreign balance still open at the month-end
-- rate, books the difference as unrealised exchange (6341, 0222), and takes
-- it back the next morning. Payments go on settling at the bill's own rate,
-- exactly as before, and realised exchange is still booked when money moves.
--
-- What is restated: what suppliers are owed in a foreign currency, read from
-- the supplier ledger itself (so a return or note not against any bill is
-- included), and foreign-currency cash and bank accounts. What is not:
-- stock, which stays at what it cost, and advances paid for goods, which are
-- not money owed back while the goods are still expected (IFRIC 22).
--
-- The difference goes to adjustment accounts beside the balances, not into
-- them: the supplier ledger must keep agreeing with the open bills, and a
-- bank account must keep agreeing with its statement. Between the month-end
-- entry and the next morning's reversal those two accounts carry it; on any
-- other day they are nil.

insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, '1150', 'Foreign Cash Revaluation', 'ASSET'
  from account g
 where g.code = '11' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '1150');

insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, '2160', 'Foreign Payables Revaluation', 'LIABILITY'
  from account g
 where g.code = '21' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '2160');

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS', 'FX_REVALUATION_CASH', 'FX_REVALUATION_AP']));

insert into system_account (company_id, role, account_id)
select a.company_id, r.role, a.id
  from account a
  join (values ('1150', 'FX_REVALUATION_CASH'), ('2160', 'FX_REVALUATION_AP')) r(code, role) on r.code = a.code
 where not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = r.role);

-- One run per month end. Voided runs stay, with the entries that undid them.
create table if not exists fx_revaluation (
    id                     uuid primary key default gen_random_uuid(),
    company_id             uuid not null references company(id),
    period_end             date not null,
    reversal_date          date not null check (reversal_date > period_end),
    rates                  jsonb not null,
    entry_id               uuid references journal_entry(id),
    reversal_entry_id      uuid references journal_entry(id),
    status                 text not null default 'POSTED' check (status in ('POSTED', 'VOIDED')),
    void_entry_id          uuid references journal_entry(id),
    void_reversal_entry_id uuid references journal_entry(id),
    void_reason            text,
    created_by             uuid references app_user(id),
    created_at             timestamptz not null default now(),
    voided_by              uuid references app_user(id),
    voided_at              timestamptz
);

create unique index if not exists fx_revaluation_one_per_month
    on fx_revaluation (company_id, period_end) where status = 'POSTED';

-- What each balance was restated from and to, as posted.
create table if not exists fx_revaluation_line (
    id              uuid primary key default gen_random_uuid(),
    revaluation_id  uuid not null references fx_revaluation(id),
    kind            text not null check (kind in ('PAYABLE', 'CASH')),
    account_id      uuid not null references account(id),
    partner_id      uuid references business_partner(id),
    currency        char(3) not null references currency(code),
    fc_balance      numeric(18,4) not null,
    carried         numeric(18,4) not null,
    rate            numeric(18,8) not null,
    revalued        numeric(18,4) not null,
    difference      numeric(18,4) not null
);

create index if not exists fx_revaluation_line_run on fx_revaluation_line (revaluation_id);
