-- Secondhand buyback and trade-in (decisions 2026-11-18).
--
-- A phone bought from a customer or another shop is an ordinary purchase
-- and goods receipt (postPurchaseWithReceipt): paid now, or owed. An IMEI we
-- sold before comes back as the same unit on a new layer (reacquire), never
-- twice on a shelf. What the counter saw is kept beside it here.
--
-- A trade-in is a sale of the new phone plus a buyback of the old one,
-- settled against each other through 1450 Trade-in Clearing: a payment of
-- the old phone's bill and a receipt against the new phone's invoice, the
-- same amount through the same account, so it nets to nothing and no cash,
-- revenue, stock or cost moves twice. A promotional top-up above the
-- inspected value is a discount on the new phone (4190), never stock cost.

insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, '1450', 'Trade-in Clearing', 'ASSET'
  from account g
 where g.code = '14' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '1450');

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING']));

insert into system_account (company_id, role, account_id)
select a.company_id, 'TRADE_IN_CLEARING', a.id from account a
 where a.code = '1450'
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'TRADE_IN_CLEARING');

-- One row per phone taken in: who sold it, what it was found to be, and the
-- sale of ours it came from, if any. A layer whose receipt has one of these
-- is secondhand stock.
create table if not exists secondhand_intake (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references company(id),
  serial_id             uuid not null references stock_serial(id),
  receipt_id            uuid not null references document(id),
  bill_id               uuid not null references document(id),
  seller_kind           text not null check (seller_kind in ('CUSTOMER', 'SHOP')),
  seller_name           text not null,
  seller_phone          text not null,
  seller_nrc            text,
  grade                 text not null,
  battery_pct           integer check (battery_pct between 0 and 100),
  activation_lock       text not null check (activation_lock in ('REMOVED', 'PRESENT')),
  checks                jsonb not null default '{}',
  notes                 text,
  previous_sale_id      uuid references document(id),
  created_by_id         uuid references app_user(id),
  created_at            timestamptz not null default now(),
  -- An individual seller is identified; a shop is identified by being one.
  check (seller_kind = 'SHOP' or nullif(trim(seller_nrc), '') is not null)
);
create index if not exists secondhand_intake_serial_idx on secondhand_intake (serial_id);
create index if not exists secondhand_intake_receipt_idx on secondhand_intake (receipt_id);

-- The documents one trade-in made, so each can be found from the others.
create table if not exists trade_in (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references company(id),
  intake_id             uuid not null references secondhand_intake(id),
  sale_id               uuid not null references document(id),
  payment_id            uuid references document(id),
  receipt_id            uuid references document(id),
  sale_total            numeric(18,4) not null,
  inspected_value       numeric(18,4) not null,
  top_up                numeric(18,4) not null default 0,
  cash_difference       numeric(18,4) not null,
  created_at            timestamptz not null default now()
);
create index if not exists trade_in_sale_idx on trade_in (sale_id);
