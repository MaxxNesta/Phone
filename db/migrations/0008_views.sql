-- 0008_views.sql
-- Reporting views, including the invariant checks as queries you can run.

-- Signed amounts split back into the two columns accountants read.
create view v_journal_line as
select
    jl.id,
    jl.company_id,
    jl.journal_entry_id,
    je.entry_no,
    je.entry_date,
    je.fiscal_period_id,
    je.source_type,
    je.source_id,
    jl.line_no,
    jl.account_id,
    a.code  as account_code,
    a.name  as account_name,
    a.account_type,
    jl.currency,
    jl.amount,
    jl.exchange_rate,
    jl.base_amount,
    case when jl.base_amount > 0 then  jl.base_amount else 0 end as debit,
    case when jl.base_amount < 0 then -jl.base_amount else 0 end as credit,
    jl.location_id,
    jl.cost_center_id,
    jl.project_id,
    jl.partner_id,
    jl.memo
  from journal_line jl
  join journal_entry je on je.id = jl.journal_entry_id
  join account       a  on a.id  = jl.account_id;

-- ------------------------------------------------------------ trial balance --

create view v_trial_balance as
select
    jl.company_id,
    je.fiscal_period_id,
    a.id   as account_id,
    a.code as account_code,
    a.name as account_name,
    a.account_type,
    sum(case when jl.base_amount > 0 then  jl.base_amount else 0 end) as debit,
    sum(case when jl.base_amount < 0 then -jl.base_amount else 0 end) as credit,
    sum(jl.base_amount) as balance
  from journal_line jl
  join journal_entry je on je.id = jl.journal_entry_id
  join account       a  on a.id  = jl.account_id
 group by jl.company_id, je.fiscal_period_id, a.id, a.code, a.name, a.account_type;

-- ------------------------------------------------------------ stock on hand --

create view v_stock_on_hand as
select
    sm.company_id,
    sm.item_id,
    i.code as item_code,
    i.name as item_name,
    sm.location_id,
    l.code as location_code,
    sum(sm.qty)        as qty_on_hand,
    sum(sm.total_cost) as value_on_hand
  from stock_movement sm
  join item     i on i.id = sm.item_id
  join location l on l.id = sm.location_id
 group by sm.company_id, sm.item_id, i.code, i.name, sm.location_id, l.code
having sum(sm.qty) <> 0 or sum(sm.total_cost) <> 0;

-- -------------------------------------------------------------- open items --

-- AR and AP as open items rather than a running balance. This is what makes
-- a truthful aging report possible, and what the local incumbents don't do.
create view v_open_item as
select
    d.company_id,
    d.id          as document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code        as partner_code,
    p.name        as partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    coalesce(al.allocated, 0)                as allocated,
    d.gross_total - coalesce(al.allocated, 0) as outstanding,
    case when d.due_date is null then null
         else current_date - d.due_date end   as days_overdue,
    case
        when d.due_date is null            then 'CURRENT'
        when current_date <= d.due_date    then 'CURRENT'
        when current_date - d.due_date <= 30 then '1-30'
        when current_date - d.due_date <= 60 then '31-60'
        when current_date - d.due_date <= 90 then '61-90'
        else '90+'
    end as aging_bucket
  from document d
  join business_partner p on p.id = d.partner_id
  left join (
        select invoice_id, sum(amount) as allocated
          from payment_allocation
         group by invoice_id
  ) al on al.invoice_id = d.id
 where d.status   = 'POSTED'
   and d.doc_type in ('SALES_INVOICE', 'PURCHASE_INVOICE')
   and d.gross_total - coalesce(al.allocated, 0) <> 0;

-- ----------------------------------------------------------- GR/IR balance --

-- Anything sitting here too long is a missing supplier invoice. The account
-- is a control mechanism, not just a bookkeeping device.
create view v_grir_balance as
select
    jl.company_id,
    jl.partner_id,
    je.source_id as document_id,
    sum(jl.base_amount) as balance,
    min(je.entry_date)  as oldest_entry_date,
    current_date - min(je.entry_date) as days_open
  from journal_line   jl
  join journal_entry  je on je.id = jl.journal_entry_id
  join system_account sa on sa.account_id = jl.account_id
                        and sa.company_id = jl.company_id
                        and sa.role       = 'GRIR_CLEARING'
 group by jl.company_id, jl.partner_id, je.source_id
having sum(jl.base_amount) <> 0;

-- =========================================================================
-- Invariant checks — every row returned is a defect
-- =========================================================================

-- Invariant 1: every journal entry balances.
create view v_check_unbalanced_entries as
select
    je.company_id,
    je.id as journal_entry_id,
    je.entry_no,
    je.entry_date,
    sum(jl.base_amount) as imbalance
  from journal_entry je
  join journal_line  jl on jl.journal_entry_id = je.id
 group by je.company_id, je.id, je.entry_no, je.entry_date
having sum(jl.base_amount) <> 0;

-- Invariant 2: the GL inventory account equals the valued stock ledger.
-- The check that separates a real ERP from invoicing software.
create view v_check_inventory_reconciliation as
with inventory_accounts as (
    select distinct company_id, account_id
      from account_determination
     where role = 'INVENTORY'
),
gl as (
    select jl.company_id, sum(jl.base_amount) as gl_balance
      from journal_line jl
      join inventory_accounts ia
        on ia.account_id = jl.account_id
       and ia.company_id = jl.company_id
     group by jl.company_id
),
stock as (
    select company_id, sum(total_cost) as stock_value
      from stock_movement
     group by company_id
)
select
    coalesce(gl.company_id, stock.company_id) as company_id,
    coalesce(gl.gl_balance, 0)    as gl_balance,
    coalesce(stock.stock_value, 0) as stock_value,
    coalesce(gl.gl_balance, 0) - coalesce(stock.stock_value, 0) as difference
  from gl
  full outer join stock on stock.company_id = gl.company_id
 where coalesce(gl.gl_balance, 0) <> coalesce(stock.stock_value, 0);

-- Invariants 3 and 4: control accounts equal their subledgers.
create view v_check_control_reconciliation as
with ar as (
    select company_id, 'AR' as side,
           sum(base_amount) as gl_balance
      from journal_line jl
     where exists (
        select 1 from account a
         where a.id = jl.account_id and a.is_control
           and a.account_type = 'ASSET'
     )
     group by company_id
),
ar_sub as (
    select company_id, 'AR' as side, sum(outstanding) as sub_balance
      from v_open_item where doc_type = 'SALES_INVOICE'
     group by company_id
)
select
    ar.company_id,
    ar.side,
    ar.gl_balance,
    coalesce(ar_sub.sub_balance, 0) as sub_balance,
    ar.gl_balance - coalesce(ar_sub.sub_balance, 0) as difference
  from ar
  left join ar_sub on ar_sub.company_id = ar.company_id and ar_sub.side = ar.side
 where ar.gl_balance <> coalesce(ar_sub.sub_balance, 0);
