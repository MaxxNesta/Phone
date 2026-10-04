-- 0015_voucher_prefixes.sql
-- Teach the numbering function the finance voucher prefixes.
--
-- 0014 inserted number_series rows for the new types, but on a fresh database
-- migrations run before the seed creates a company, so nothing was inserted
-- and fn_next_document_no fell back to left(type, 3). That produced CAS-,
-- BAN- and JOU-, and worse, CASH_VOUCHER and CASH_TRANSFER both landed on
-- CAS- — two different books numbering documents identically.

create or replace function fn_next_document_no(
    p_company uuid, p_type text, p_fiscal_year uuid
) returns text language plpgsql as $$
declare
    s      number_series;
    v_pfx  text;
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = p_type
       and fiscal_year_id is not distinct from p_fiscal_year
     for update;

    if not found then
        v_pfx := case p_type
            when 'PURCHASE_ORDER'    then 'PO-'
            when 'GOODS_RECEIPT'     then 'GR-'
            when 'PURCHASE_INVOICE'  then 'PI-'
            when 'PURCHASE_RETURN'   then 'PR-'
            when 'SUPPLIER_PAYMENT'  then 'PAY-'
            when 'SALES_ORDER'       then 'SO-'
            when 'DELIVERY'          then 'DO-'
            when 'SALES_INVOICE'     then 'SI-'
            when 'SALES_RETURN'      then 'SR-'
            when 'CUSTOMER_RECEIPT'  then 'RC-'
            when 'STOCK_ADJUSTMENT'  then 'ADJ-'
            when 'STOCK_TRANSFER'    then 'TRF-'
            when 'OPENING_BALANCE'   then 'OB-'
            when 'CASH_VOUCHER'      then 'CV-'
            when 'BANK_VOUCHER'      then 'BV-'
            when 'JOURNAL_VOUCHER'   then 'JV-'
            when 'CASH_TRANSFER'     then 'CT-'
            when 'JOURNAL'           then 'JE-'
            else left(p_type, 3) || '-'
        end;

        insert into number_series (company_id, document_type, fiscal_year_id, prefix, next_value)
        values (p_company, p_type, p_fiscal_year, v_pfx, 1)
        returning * into s;
    end if;

    update number_series set next_value = next_value + 1 where id = s.id;

    return s.prefix || lpad(s.next_value::text, s.padding, '0');
end;
$$;

-- Correct any series already created with a fallback prefix, provided the
-- book has not started numbering yet.
update number_series set prefix = 'CV-' where document_type = 'CASH_VOUCHER'    and prefix = 'CAS-';
update number_series set prefix = 'CT-' where document_type = 'CASH_TRANSFER'   and prefix = 'CAS-';
update number_series set prefix = 'BV-' where document_type = 'BANK_VOUCHER'    and prefix = 'BAN-';
update number_series set prefix = 'JV-' where document_type = 'JOURNAL_VOUCHER' and prefix = 'JOU-';
update number_series set prefix = 'JE-' where document_type = 'JOURNAL'         and prefix = 'JOU-';
