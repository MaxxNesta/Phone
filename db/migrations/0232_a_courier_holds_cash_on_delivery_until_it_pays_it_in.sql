-- A courier holds cash on delivery until it pays it in (COD phase 2).
--
-- A cash-on-delivery invoice (0230) can name the courier company that carries
-- it. When the courier reports the parcel delivered and paid, the customer's
-- debt is settled and the courier owes the money instead:
--
--   courier collected   Dr COD Receivable (courier)   Cr Accounts Receivable (customer)
--   courier pays in     Dr Cash / Bank (what arrived)
--                       Dr Carriage Outward (the courier's fee, kept back)
--                                                     Cr COD Receivable (courier)
--
-- The first is an ordinary customer receipt whose money side is COD
-- Receivable under the courier; the second an ordinary cash or bank voucher.
-- Nothing new is stored about either: what a courier holds is the balance of
-- COD Receivable under its name.

alter table business_partner add column if not exists is_courier boolean not null default false;
-- A courier company may be only that: neither sold to nor bought from.
alter table business_partner drop constraint if exists business_partner_check;
alter table business_partner add constraint business_partner_check check (is_customer or is_supplier or is_courier);

alter table document add column if not exists courier_id uuid references business_partner(id);
create index if not exists document_courier on document (courier_id) where courier_id is not null;

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS', 'FX_REVALUATION_CASH', 'FX_REVALUATION_AP',
  'INVENTORY_DAMAGE', 'LANDED_COST_VARIANCE', 'COD_RECEIVABLE', 'CARRIAGE_OUTWARD']));

-- 1230 COD Receivable (Courier), under 12 Receivables, on every chart that has 12.
insert into account (company_id, code, name, account_type, is_postable, parent_id)
select p.company_id, '1230', 'COD Receivable (Courier)', 'ASSET', true, p.id
  from account p
 where p.code = '12'
   and not exists (select 1 from account a where a.company_id = p.company_id and a.code = '1230');

insert into system_account (company_id, role, account_id)
select a.company_id, 'COD_RECEIVABLE', a.id from account a
 where a.code = '1230' and a.is_postable
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'COD_RECEIVABLE');

insert into system_account (company_id, role, account_id)
select a.company_id, 'CARRIAGE_OUTWARD', a.id from account a
 where a.code = '6130' and a.is_postable
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'CARRIAGE_OUTWARD');
