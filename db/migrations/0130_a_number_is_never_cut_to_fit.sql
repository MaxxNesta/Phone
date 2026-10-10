-- A number wider than its series' padding is printed in full.
--
-- lpad() truncates: lpad('1000', 3, '0') is '100'. Every series is padded to
-- three digits, so the thousandth journal entry of a day came out as the
-- hundredth's number, collided with it, and from then on every posting that
-- day failed — found by the load test, which crossed 999 journal entries in an
-- afternoon. Padding is a minimum width, never a maximum:
--   1 -> 001, 999 -> 999, 1000 -> 1000, 10000 -> 10000.
--
-- Only the formatting changes. The four numbering functions below are their
-- current definitions (0038 and the fiscal-year overloads), with lpad() swapped
-- for fn_pad_document_no(); locking, series keys and prefixes are untouched.

create or replace function fn_pad_document_no(p_value text, p_width int)
returns text language sql immutable as $$
    select case when length(p_value) >= p_width then p_value
                else lpad(p_value, p_width, '0') end
$$;

CREATE OR REPLACE FUNCTION public.fn_next_document_no(p_company uuid, p_type text, p_date date, p_direction text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
    s     number_series;
    v_pfx text := fn_document_prefix(p_type, p_direction);
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = v_pfx
       and series_date = p_date
     for update;

    if not found then
        insert into number_series (company_id, document_type, series_date,
                                   prefix, padding, next_value)
        values (p_company, v_pfx, p_date, v_pfx, 3, 1)
        returning * into s;
    end if;

    update number_series set next_value = s.next_value + 1 where id = s.id;

    return v_pfx || to_char(p_date, 'YYYYMMDD')
           || fn_pad_document_no(s.next_value::text, s.padding);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_next_document_no(p_company uuid, p_type text, p_fiscal_year uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
    s      number_series;
    v_pfx  text;
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = p_type
       and fiscal_year_id is not distinct from p_fiscal_year
       and series_date is null
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
        insert into number_series (company_id, document_type, fiscal_year_id,
                                   prefix, padding, next_value)
        values (p_company, p_type, p_fiscal_year, v_pfx, 6, 1)
        returning * into s;
    end if;

    update number_series set next_value = s.next_value + 1 where id = s.id;

    return s.prefix || fn_document_no_year(p_fiscal_year)
           || fn_pad_document_no(s.next_value::text, s.padding);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_peek_document_no(p_company uuid, p_type text, p_date date, p_direction text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    s     number_series;
    v_pfx text := fn_document_prefix(p_type, p_direction);
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = v_pfx
       and series_date = p_date;

    return v_pfx || to_char(p_date, 'YYYYMMDD')
           || fn_pad_document_no(coalesce(s.next_value, 1)::text, coalesce(s.padding, 3));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_peek_document_no(p_company uuid, p_type text, p_fiscal_year uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    s number_series;
begin
    select * into s from number_series
     where company_id = p_company
       and document_type = p_type
       and fiscal_year_id is not distinct from p_fiscal_year
       and series_date is null;

    if not found then
        return null;
    end if;

    return s.prefix || fn_document_no_year(p_fiscal_year)
           || fn_pad_document_no(s.next_value::text, s.padding);
end;
$function$
;
