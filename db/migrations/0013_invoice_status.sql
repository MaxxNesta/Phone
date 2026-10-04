-- 0013_invoice_status.sql
-- Payment status for every invoice, derived rather than stored.
--
-- Nothing writes "PAID" onto an invoice. The invoice records what was agreed
-- and never changes; what has been settled is the sum of the allocations
-- against it. Storing a status would be a second source of truth that drifts
-- the first time a payment is reversed.

create view v_invoice_status as
select
    d.company_id,
    d.id                as document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code              as partner_code,
    p.name              as partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    coalesce(a.paid, 0)                     as paid,
    d.gross_total - coalesce(a.paid, 0)     as outstanding,

    case
        when coalesce(a.paid, 0) = 0                then 'OPEN'
        when coalesce(a.paid, 0) >= d.gross_total   then 'PAID'
        else 'PARTIALLY_PAID'
    end as payment_status,

    case
        when d.due_date is null then null
        else current_date - d.due_date
    end as days_overdue

  from document d
  join business_partner p on p.id = d.partner_id
  left join (
        select invoice_id, sum(amount) as paid
          from payment_allocation
         group by invoice_id
  ) a on a.invoice_id = d.id
 where d.status = 'POSTED'
   and d.doc_type in ('SALES_INVOICE', 'PURCHASE_INVOICE');

comment on view v_invoice_status is
    'Every posted invoice with what has been settled against it. OPEN, '
    'PARTIALLY_PAID or PAID is computed from allocations, never stored.';

-- What a partner owes, or is owed, in one row each.
create view v_partner_balance as
select
    company_id,
    partner_id,
    partner_code,
    partner_name,
    doc_type,
    count(*) filter (where outstanding <> 0)::int as open_invoices,
    sum(gross_total)                              as invoiced,
    sum(paid)                                     as paid,
    sum(outstanding)                              as outstanding,
    sum(outstanding) filter (
        where due_date is not null and current_date > due_date
    )                                             as overdue
  from v_invoice_status
 group by company_id, partner_id, partner_code, partner_name, doc_type
having sum(outstanding) <> 0;
