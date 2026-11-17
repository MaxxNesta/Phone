-- Two accounts the rebate decisions need (accountant memo, 2026-11-17).
-- Nothing posts to them automatically: they hold month-end accruals.
--
--   1560 Supplier Rebates Receivable  a rebate the company is entitled to
--                                     before the supplier's credit note
--   2250 Rebates Payable              a customer rebate to be paid out or
--                                     credited later (IFRS 15 refund liability)
--
-- Only for a company on the four-digit chart (0203), under its groups.
insert into account (company_id, parent_id, code, name, account_type)
select g.company_id, g.id, x.code, x.name, x.t::account_type
  from (values ('15', '1560', 'Supplier Rebates Receivable', 'ASSET'),
               ('22', '2250', 'Rebates Payable (Refund Liability)', 'LIABILITY')) as x(grp, code, name, t)
  join account g on g.code = x.grp and not g.is_postable
 where not exists (select 1 from account a where a.company_id = g.company_id and a.code = x.code);
