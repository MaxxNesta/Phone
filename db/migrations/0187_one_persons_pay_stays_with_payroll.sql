-- One person's pay stays with payroll
--
-- Salaries are paid in a batch by default, and a batch voucher says only
-- "Salary payment" and its total: the cash book and the ledger see that.
-- A voucher whose amount is one person's pay is different: a payment for a
-- single payslip, or the journal of a run with a single payslip, shows that
-- employee's salary as its total. Its details (the document page, its print,
-- its attachments, its journal entry) open only for those who may see
-- salaries. A voided one's reversal carries the same amount, so it counts too.
-- The ledger lines themselves stay where they are: balances must add up.

create or replace function fn_hr_restricted(p_doc uuid) returns boolean
language sql stable as $$
  select exists (
    select 1
      from (select p_doc as id
            union all
            select d.id from document d where d.reversed_by_document_id = p_doc) c
     where (select count(distinct x.payslip_id) from hr_salary_payment x where x.document_id = c.id) = 1
        or (select count(*) from hr_payroll_run r join hr_payslip s on s.run_id = r.id where r.document_id = c.id) = 1)
$$;

create index if not exists document_reversed_by on document (reversed_by_document_id) where reversed_by_document_id is not null;
