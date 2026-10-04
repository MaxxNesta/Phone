-- 0020_partner_balance_extras.sql
-- What the Receivables/Payables "by partner" rollup needs beyond the
-- per-invoice view: a due-soon bucket and the partner's credit limit,
-- joined once here rather than by every query that reads this view.

create or replace view v_partner_balance as
select
    v.company_id,
    v.partner_id,
    v.partner_code,
    v.partner_name,
    v.doc_type,
    count(*) filter (where v.outstanding <> 0)::int as open_invoices,
    sum(v.gross_total)                              as invoiced,
    sum(v.paid)                                      as paid,
    sum(v.outstanding)                               as outstanding,
    sum(v.outstanding) filter (
        where v.due_date is not null and v.days_overdue > 0
    )                                                as overdue,
    -- Not yet due, but due within a week — the amount worth chasing before
    -- it becomes overdue rather than after.
    sum(v.outstanding) filter (
        where v.due_date is not null
          and v.days_overdue <= 0
          and v.due_date <= current_date + 7
    )                                                as due_soon,
    max(p.credit_limit)                             as credit_limit

  from v_invoice_status v
  join business_partner p on p.id = v.partner_id
 group by v.company_id, v.partner_id, v.partner_code, v.partner_name, v.doc_type
having sum(v.outstanding) <> 0;

comment on view v_partner_balance is
    'What each partner owes or is owed, rolled up from open invoices. '
    'due_soon is outstanding and not yet overdue but due within a week; '
    'credit_limit is carried through from business_partner for the same '
    'reason partner_name is -- one row has everything the summary needs.';
