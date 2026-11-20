-- Unrealised exchange gains and losses get their own account (docs/06 D-P6).
--
-- The month-end revaluation (0223) restates what is still owed in yuan at
-- the month-end rate. That difference is not money gained or lost — the bill
-- is not paid yet, and the entry reverses the next morning — so it is kept
-- apart from the realised figure in 6340, which is. The customer keeps both
-- realised directions in one account, and the unrealised account follows
-- the same shape: one account, gain and loss.

insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, '6341', 'Unrealised Exchange Gain/Loss', 'EXPENSE'
  from account g
 where g.code = '63' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '6341');

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS']));

insert into system_account (company_id, role, account_id)
select a.company_id, r.role, a.id
  from account a
 cross join (values ('FX_UNREALISED_GAIN'), ('FX_UNREALISED_LOSS')) r(role)
 where a.code = '6341'
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = r.role);
