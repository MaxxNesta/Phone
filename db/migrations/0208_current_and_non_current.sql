-- Current and non-current: the balance sheet's own split, as headings.
--
-- 0203 left the groups directly under their class, current and non-current
-- told apart only by code range. Now a section sits between them, the codes
-- the statements already know (1-CA, 2-CL):
--
--   1 Assets      → 1-CA Current Assets (11–15) · 1-NC Non-current Assets (16–19)
--   2 Liabilities → 2-CL Current Liabilities (21–24, 26) · 2-NL Non-current Liabilities (25)
--
-- With it, the accounts a company will need and did not have:
--   2150 Salary Payable          what payroll owes staff (HR settings points here)
--   26   Short-term Borrowings   2610 Short-term Loan, 2620 Current Portion of Long-term Loan
--   1601 Land, 1602 Buildings    property; 1701 Accumulated Dep; Buildings, 6401 its expense
--                                (land is not depreciated)
--
-- Only a company on the four-digit chart; nothing posted moves.

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select c.company_id, c.id, x.code, x.name, c.account_type, false
  from (values ('1', '1-CA', 'Current Assets'), ('1', '1-NC', 'Non-current Assets'),
               ('2', '2-CL', 'Current Liabilities'), ('2', '2-NL', 'Non-current Liabilities')) as x(cls, code, name)
  join account c on c.code = x.cls and c.parent_id is null
 where exists (select 1 from account f where f.company_id = c.company_id and f.code = '5110')
   and not exists (select 1 from account a where a.company_id = c.company_id and a.code = x.code);

insert into account (company_id, parent_id, code, name, account_type, is_postable)
select s.company_id, s.id, '26', 'Short-term Borrowings', 'LIABILITY', false
  from account s
 where s.code = '2-CL'
   and not exists (select 1 from account a where a.company_id = s.company_id and a.code = '26');

update account g set parent_id = s.id
  from account s
 where s.company_id = g.company_id and not g.is_postable and length(g.code) = 2
   and s.code = case when g.code between '11' and '15' then '1-CA'
                     when g.code between '16' and '19' then '1-NC'
                     when g.code in ('21', '22', '23', '24', '26') then '2-CL'
                     when g.code = '25' then '2-NL' end;

insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, x.code, x.name, g.account_type
  from (values ('21', '2150', 'Salary Payable'),
               ('26', '2610', 'Short-term Loan'),
               ('26', '2620', 'Current Portion of Long-term Loan'),
               ('16', '1601', 'Land'),
               ('16', '1602', 'Buildings'),
               ('17', '1701', 'Accumulated Dep; Buildings'),
               ('64', '6401', 'Depreciation For Buildings')) as x(grp, code, name)
  join account g on g.code = x.grp and not g.is_postable
  join account s on s.company_id = g.company_id and s.code = '2-CL'
 where not exists (select 1 from account a where a.company_id = g.company_id and a.code = x.code);
