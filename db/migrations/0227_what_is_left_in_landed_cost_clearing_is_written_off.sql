-- A bill debited to Landed Cost Clearing (or a cost type's own clearing
-- account) that no landed cost ever spreads sits there for good. It is now
-- listed, and what is left can be written off to Landed Cost Variance: a
-- COGS-type account, Purchase Price Variance (5940) where the chart has one,
-- else the company's PURCHASE_PRICE_VARIANCE account.
--
-- A write-off is a row of its own with its entry; a mistaken one is undone
-- by a reversing entry, never by editing or deleting the row.

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS', 'FX_REVALUATION_CASH', 'FX_REVALUATION_AP',
  'INVENTORY_DAMAGE', 'LANDED_COST_VARIANCE']));

insert into system_account (company_id, role, account_id)
select c.id, 'LANDED_COST_VARIANCE',
       coalesce((select a.id from account a where a.company_id = c.id and a.code = '5940'),
                (select s.account_id from system_account s where s.company_id = c.id and s.role = 'PURCHASE_PRICE_VARIANCE'))
  from company c
 where not exists (select 1 from system_account s where s.company_id = c.id and s.role = 'LANDED_COST_VARIANCE')
   and coalesce((select a.id from account a where a.company_id = c.id and a.code = '5940'),
                (select s.account_id from system_account s where s.company_id = c.id and s.role = 'PURCHASE_PRICE_VARIANCE')) is not null;

create table if not exists landed_cost_writeoff (
    id                      uuid primary key default gen_random_uuid(),
    company_id              uuid not null references company(id),
    source_journal_line_id  uuid not null references journal_line(id),
    amount                  numeric(18,4) not null check (amount > 0),  -- base currency
    entry_date              date not null,
    reason                  text not null,
    entry_id                uuid not null references journal_entry(id),
    created_by              uuid references app_user(id),
    created_at              timestamptz not null default now(),
    reversal_entry_id       uuid references journal_entry(id),
    reversal_reason         text,
    reversed_by             uuid references app_user(id),
    reversed_at             timestamptz
);

-- One standing write-off per bill line.
create unique index if not exists landed_cost_writeoff_one_standing
    on landed_cost_writeoff (source_journal_line_id) where reversal_entry_id is null;
create index if not exists landed_cost_writeoff_company on landed_cost_writeoff (company_id);
