-- 0014_finance_vouchers.sql
-- Cash, bank, journal, interbranch transfer and opening balances.

-- Existing document types plus the finance ones. A cash or bank voucher is
-- the simple two-sided case (money in or out against one other account); a
-- journal voucher is the free-form multi-line one.
alter table document drop constraint document_doc_type_check;

alter table document add constraint document_doc_type_check check (doc_type in (
    'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE',
    'PURCHASE_RETURN', 'SUPPLIER_PAYMENT',
    'SALES_ORDER', 'DELIVERY', 'SALES_INVOICE',
    'SALES_RETURN', 'CUSTOMER_RECEIPT',
    'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'OPENING_BALANCE',
    'CASH_VOUCHER', 'BANK_VOUCHER', 'JOURNAL_VOUCHER', 'CASH_TRANSFER'
));

-- All of these must produce a posting; none of them move stock.
create or replace function fn_document_posting_required() returns trigger
language plpgsql as $$
declare
    d document;
begin
    select * into d from document where id = new.id;
    if not found then
        return null;
    end if;

    if d.status = 'POSTED'
       and d.journal_entry_id is null
       and d.doc_type in (
            'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
            'SUPPLIER_PAYMENT', 'DELIVERY', 'SALES_INVOICE',
            'SALES_RETURN', 'CUSTOMER_RECEIPT', 'STOCK_ADJUSTMENT',
            'OPENING_BALANCE', 'CASH_VOUCHER', 'BANK_VOUCHER',
            'JOURNAL_VOUCHER', 'CASH_TRANSFER')
    then
        raise exception
            'Document % (%) is posted but has no journal entry',
            d.doc_no, d.doc_type;
    end if;

    return null;
end;
$$;

-- Which accounts money can be held in. is_cash_account already marks the
-- tills; this separates the drawer from the bank so each gets its own book.
alter table account add column is_bank_account boolean not null default false;

update account set is_bank_account = true
 where is_cash_account and (lower(name) like '%bank%' or code in ('1120', '1130'));

-- A cash account that is not a bank account is petty cash or the till.
comment on column account.is_bank_account is
    'A cash account held at a bank rather than on the premises. Drives whether '
    'a movement belongs in the cash book or the bank book.';

create index on account (company_id) where is_bank_account;

-- ---------------------------------------------------------- account ledger --

-- Every movement on an account with a running balance, which is what the
-- cash and bank detail reports are.
create view v_account_ledger as
select
    jl.company_id,
    jl.account_id,
    a.code            as account_code,
    a.name            as account_name,
    a.account_type,
    a.is_cash_account,
    a.is_bank_account,
    je.id             as journal_entry_id,
    je.entry_no,
    je.entry_date,
    je.memo,
    je.source_type,
    je.source_id,
    d.doc_no,
    d.doc_type,
    p.name            as partner_name,
    l.code            as location_code,
    case when jl.base_amount > 0 then  jl.base_amount else 0 end as debit,
    case when jl.base_amount < 0 then -jl.base_amount else 0 end as credit,
    jl.base_amount,
    sum(jl.base_amount) over (
        partition by jl.company_id, jl.account_id
        order by je.entry_date, je.entry_no, jl.line_no
        rows between unbounded preceding and current row
    ) as running_balance
  from journal_line jl
  join journal_entry je on je.id = jl.journal_entry_id
  join account a on a.id = jl.account_id
  left join document d on d.id = je.source_id
  left join business_partner p on p.id = jl.partner_id
  left join location l on l.id = jl.location_id;

comment on view v_account_ledger is
    'Movements on every account with a running balance. Cash detail and bank '
    'detail are this view filtered by account.';

-- Numbering for the new voucher types.
insert into number_series (company_id, document_type, fiscal_year_id, prefix, next_value)
select c.id, t.dt, fy.id, t.px, 1
  from company c
  join fiscal_year fy on fy.company_id = c.id
  join (values
      ('CASH_VOUCHER',    'CV-'),
      ('BANK_VOUCHER',    'BV-'),
      ('JOURNAL_VOUCHER', 'JV-'),
      ('CASH_TRANSFER',   'CT-')
  ) as t(dt, px) on true
 where not exists (
    select 1 from number_series ns
     where ns.company_id = c.id and ns.document_type = t.dt
       and ns.fiscal_year_id is not distinct from fy.id
 );
