-- Carriage inward is spread onto the phones
--
-- The shop has always booked a courier's charge as Dr Carriage Inward /
-- Cr Payable (Other), which put the whole charge into cost of sales on the
-- day of the bill, whether the phones had sold or not. A courier bill now
-- keeps that entry, under the courier's name, and the landed cost written
-- with it in the same step moves the charge out of Carriage Inward and onto
-- the phones: Dr Inventory / Cr Carriage Inward. The account reads as it
-- always did, nets to nothing for whatever was spread, and anything never
-- spread stays expensed exactly as before.

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD']));

-- Carriage Inward on the shipped chart is 51110. A chart without one gets no
-- role, and a courier's charge posts straight to inventory as in 0161.
insert into system_account (company_id, role, account_id)
select a.company_id, 'CARRIAGE_INWARD', a.id
  from account a
 where a.is_postable and (a.code = '51110' or a.name ilike 'carriage inward%')
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'CARRIAGE_INWARD')
   and a.id = (select b.id from account b
                where b.company_id = a.company_id and b.is_postable
                  and (b.code = '51110' or b.name ilike 'carriage inward%')
                order by (b.code = '51110') desc, b.code limit 1);

-- The account a courier's bill was booked to before being spread: the bill
-- is Dr this / Cr the payable, the spread Dr inventory / Cr this. Null for a
-- charge that went straight to inventory. Read back by a reversal.
alter table landed_cost_charge add column if not exists via_account_id uuid references account(id);

-- A cost type of the same name, so a courier bill reads as the shop's own
-- books do. Spread equally: a car charge is per phone carried, not by value.
insert into landed_cost_type (company_id, code, name, default_method)
select c.id, 'CARRIAGE', 'Carriage Inward', 'EQUAL'
  from company c
 where not exists (select 1 from landed_cost_type t where t.company_id = c.id and t.code = 'CARRIAGE');
