-- Money or goods the owner takes out of the business for themselves. The
-- chart had capital, retained earnings and opening balance but nowhere to
-- put drawings, so they ended up as expenses or against capital.
--
-- 34 Drawings (a heading) and 3410 Owner Drawings under Equity. The
-- account's name is what the reports read: the statement of changes in
-- equity counts an equity account named "drawing" as drawings, and the
-- cash-flow trigger (0128) files it as Financing / Distribution.

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select g.company_id, g.id, '34', 'Drawings', 'EQUITY', false
  from account g
 where g.code = '3' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '34');

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select g.company_id, g.id, '3410', 'Owner Drawings', 'EQUITY', true
  from account g
 where g.code = '34' and not g.is_postable
   and not exists (select 1 from account a where a.company_id = g.company_id and a.code = '3410');
