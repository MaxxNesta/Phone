-- Defective stock the supplier will neither take back nor credit is written
-- off out of quarantine (Path B). That loss is not a count difference: it
-- goes to Inventory Damage (5920), not to the adjustment account (5910) that
-- counts use, so scrap can be read on its own.
--
-- A company whose chart has no 5920 points the role at its adjustment
-- account instead, so a write-off still posts.

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS', 'FX_REVALUATION_CASH', 'FX_REVALUATION_AP',
  'INVENTORY_DAMAGE']));

insert into system_account (company_id, role, account_id)
select c.id, 'INVENTORY_DAMAGE',
       coalesce((select a.id from account a where a.company_id = c.id and a.code = '5920'),
                (select s.account_id from system_account s where s.company_id = c.id and s.role = 'STOCK_ADJUSTMENT'))
  from company c
 where not exists (select 1 from system_account s where s.company_id = c.id and s.role = 'INVENTORY_DAMAGE')
   and coalesce((select a.id from account a where a.company_id = c.id and a.code = '5920'),
                (select s.account_id from system_account s where s.company_id = c.id and s.role = 'STOCK_ADJUSTMENT')) is not null;
