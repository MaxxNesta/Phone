-- Free goods from a supplier
--
-- A supplier's FOC: units that arrive on a bill at no charge. They go on the
-- shelf at zero cost — the company paid nothing for them — and the bill line
-- names why it is free, the same way a free line on a sale does.
--
-- foc_reason so far held only the reasons goods are given away (damaged,
-- office use, a promotion, a sample), each with the expense account a free
-- sale's cost moves to. A reason for goods received free is the other side
-- of the same idea, so it lives in the same table with applies_to set to
-- PURCHASE. Its account is the chart's FOC Received (51202): the account the
-- line is classed under. At zero cost no amount reaches it.
--
-- Sales screens list only SALE reasons, and the sales engine refuses a
-- PURCHASE one, so a supplier's free goods can never become a giveaway.

alter table foc_reason add column if not exists applies_to text not null default 'SALE'
    check (applies_to in ('SALE', 'PURCHASE'));

insert into foc_reason (company_id, code, name, account_id, applies_to)
select a.company_id, 'SUPPLIER', 'Free from supplier', a.id, 'PURCHASE'
  from account a
 where a.code = '51202'
   and not exists (select 1 from foc_reason f where f.company_id = a.company_id and f.code = 'SUPPLIER');

comment on column foc_reason.applies_to is
  'SALE: why goods are given away (a free line on a sale). PURCHASE: goods received free from a supplier, at zero cost.';
