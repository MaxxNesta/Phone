-- A courier is owed until paid
--
-- A landed-cost charge can name its payee — the forwarder, the gate, the
-- driver who brought the boxes up from Muse — without a bill having been
-- recorded for it. Posting spread that charge onto the phones and credited
-- Landed Cost Clearing, so the cost was right and the debt was nowhere: the
-- clearing account went negative and no one could say who was owed it.
--
-- Such a charge now credits Payable (Other) under its payee instead, and the
-- money is paid off with an ordinary cash or bank voucher that carries the
-- courier and says which charges it settles. A charge linked to a bill
-- already recorded is unchanged: the bill is the debt, the charge only
-- spends what the bill put into clearing.

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE']));

-- Payable (Other) on the shipped chart is 21109. A chart without it gets no
-- role, and a payee'd charge then posts to clearing as before.
insert into system_account (company_id, role, account_id)
select a.company_id, 'OTHER_PAYABLE', a.id
  from account a
 where a.is_postable and a.account_type = 'LIABILITY'
   and (a.code = '21109' or a.name ilike 'payable (other)' or a.name ilike 'other payable%')
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'OTHER_PAYABLE')
   and a.id = (select b.id from account b
                where b.company_id = a.company_id and b.is_postable and b.account_type = 'LIABILITY'
                  and (b.code = '21109' or b.name ilike 'payable (other)' or b.name ilike 'other payable%')
                order by (b.code = '21109') desc, b.code limit 1);

-- Where the charge's credit went when it posted: the payable, under its
-- payee, or (null) its clearing account. Read back by a reversal so it
-- undoes the line it wrote, whatever the settings say by then.
alter table landed_cost_charge add column if not exists owed_account_id uuid references account(id);

-- A courier payment, line by line against the charges it pays.
create table if not exists courier_settlement (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references company(id) on delete cascade,
  payment_id   uuid not null references document(id),
  charge_id    uuid not null references landed_cost_charge(id),
  amount       numeric(18,4) not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (payment_id, charge_id)
);
create index if not exists courier_settlement_charge on courier_settlement (charge_id);

-- No charge is paid more than it was. Checked at commit so a payment that
-- writes several rows is judged on all of them. A voided payment (its
-- voucher REVERSED) keeps its rows for the record and stops counting.
create or replace function fn_courier_settlement_cap() returns trigger language plpgsql as $$
declare v_paid numeric; v_owed numeric;
begin
  select coalesce(sum(s.amount), 0) into v_paid
    from courier_settlement s join document p on p.id = s.payment_id
   where s.charge_id = new.charge_id and p.status = 'POSTED';
  select base_amount into v_owed from landed_cost_charge where id = new.charge_id;
  if v_paid > v_owed + 0.0001 then
    raise exception 'This charge is owed %, and payments to it would come to %', v_owed, v_paid;
  end if;
  return null;
end $$;
drop trigger if exists courier_settlement_cap on courier_settlement;
create constraint trigger courier_settlement_cap after insert or update on courier_settlement
  deferrable initially deferred for each row execute function fn_courier_settlement_cap();
