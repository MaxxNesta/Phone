-- Interest has an account of its own.
--
-- Interest cover (operating profit ÷ interest) needs interest kept apart from
-- the running costs of the shop; until now there was nowhere to post it but
-- a general expense, where it was counted as operating. Finance costs sit
-- under Expenses in the chart's own shape: a heading, a sub-heading, and the
-- account interest is posted to.
--
-- Only where the chart has the Expenses heading (6) and the codes are free.

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select h.company_id, h.id, '67', 'Finance Costs', 'EXPENSE', false
  from account h
 where h.code = '6' and not h.is_postable
   and not exists (select 1 from account x where x.company_id = h.company_id and x.code = '67');

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select h.company_id, h.id, '671', 'Interest Expense', 'EXPENSE', false
  from account h
 where h.code = '67' and not h.is_postable
   and not exists (select 1 from account x where x.company_id = h.company_id and x.code = '671');

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select h.company_id, h.id, '67101', 'Interest Expense', 'EXPENSE', true
  from account h
 where h.code = '671' and not h.is_postable
   and not exists (select 1 from account x where x.company_id = h.company_id and x.code = '67101');
