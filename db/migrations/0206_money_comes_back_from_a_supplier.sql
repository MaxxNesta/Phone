-- Money comes back from a supplier.
--
-- A debit note on a bill already paid in full leaves the bill below zero: the
-- supplier owes us the difference. Until now nothing could record them paying
-- it, so the note itself was refused. SUPPLIER_REFUND (prefix SRF) is the
-- mirror of CUSTOMER_REFUND (0142): raised from the debit note it settles,
--
--   Dr the cash or bank account it came into / Cr Accounts Payable,
--
-- with an allocation of minus the amount against the bill, which climbs back
-- from below zero to nothing. Voiding it reverses it like any payment.

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check CHECK ((doc_type = ANY (ARRAY['PURCHASE_ORDER'::text, 'GOODS_RECEIPT'::text, 'PURCHASE_INVOICE'::text, 'PURCHASE_RETURN'::text, 'SUPPLIER_PAYMENT'::text, 'SALES_ORDER'::text, 'DELIVERY'::text, 'SALES_INVOICE'::text, 'SALES_RETURN'::text, 'CUSTOMER_RECEIPT'::text, 'CUSTOMER_REFUND'::text, 'SUPPLIER_REFUND'::text, 'STOCK_ADJUSTMENT'::text, 'STOCK_TRANSFER'::text, 'CASH_VOUCHER'::text, 'BANK_VOUCHER'::text, 'JOURNAL_VOUCHER'::text, 'CASH_TRANSFER'::text, 'OPENING_BALANCE'::text, 'CONSIGNMENT_RECEIPT'::text, 'CONSIGNMENT_SETTLEMENT'::text, 'ADVANCE_APPLICATION'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text, 'YEAR_END_CLOSE'::text, 'LANDED_COST'::text])));

CREATE OR REPLACE FUNCTION public.fn_document_prefix(p_type text, p_direction text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select case
        when p_type = 'CASH_VOUCHER' and p_direction = 'OUT' then 'P'
        when p_type = 'CASH_VOUCHER'                         then 'R'
        when p_type = 'BANK_VOUCHER' and p_direction = 'OUT' then 'BP'
        when p_type = 'BANK_VOUCHER'                         then 'BR'

        when p_type = 'CUSTOMER_RECEIPT'    then 'CR'
        when p_type = 'CUSTOMER_REFUND'     then 'RF'
        when p_type = 'SUPPLIER_PAYMENT'    then 'CP'
        when p_type = 'SUPPLIER_REFUND'     then 'SRF'
        when p_type = 'JOURNAL_VOUCHER'     then 'J'
        when p_type = 'SALES_INVOICE'       then 'DS'
        when p_type = 'SALES_RETURN'        then 'SR'
        when p_type = 'PURCHASE_INVOICE'    then 'DP'
        when p_type = 'PURCHASE_RETURN'     then 'PR'
        when p_type = 'STOCK_TRANSFER'      then 'ST'
        when p_type = 'GOODS_RECEIPT'       then 'STR'
        when p_type = 'DELIVERY'            then 'SI'
        when p_type = 'STOCK_ADJUSTMENT'    then 'SAJ'
        when p_type = 'CREDIT_NOTE'         then 'CN'
        when p_type = 'DEBIT_NOTE'          then 'DN'

        when p_type = 'PURCHASE_ORDER'      then 'PO'
        when p_type = 'SALES_ORDER'         then 'SO'
        when p_type = 'CASH_TRANSFER'       then 'CT'
        when p_type = 'OPENING_BALANCE'     then 'OB'
        when p_type = 'CONSIGNMENT_RECEIPT' then 'CNR'
        when p_type = 'DELIVERY_TRIP'       then 'TRP'
        when p_type = 'BANK_STATEMENT'      then 'BST'
        when p_type = 'YEAR_END_CLOSE'      then 'YEC'
        when p_type = 'LANDED_COST'         then 'LC'

        -- Back, with the reason restated so the next rewrite of this
        -- function keeps it: a journal entry is not a journal voucher, and
        -- GEN is for a type nobody has named yet, not for the one thing
        -- every posting in the system creates.
        when p_type = 'JOURNAL'             then 'JE'
        else 'GEN'
    end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_allocation_pairing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
    v_pay_type text;
    v_pay_no   text;
    v_inv_type text;
    v_inv_no   text;
    v_inv_stat text;
    v_expected text;
begin
    select doc_type, doc_no into v_pay_type, v_pay_no
      from document where id = new.payment_id;
    select doc_type, doc_no, status into v_inv_type, v_inv_no, v_inv_stat
      from document where id = new.invoice_id;

    v_expected := case v_pay_type
        when 'CUSTOMER_RECEIPT' then 'SALES_INVOICE'
        when 'CUSTOMER_REFUND'  then 'SALES_INVOICE'
        when 'SUPPLIER_PAYMENT' then 'PURCHASE_INVOICE'
        when 'SUPPLIER_REFUND'  then 'PURCHASE_INVOICE'
        else null
    end;

    if v_expected is null then
        raise exception
            'Document % is a % and cannot settle anything',
            v_pay_no, lower(replace(v_pay_type, '_', ' '));
    end if;

    if v_inv_type <> v_expected then
        raise exception
            'A % cannot settle %, which is a %. It settles a %',
            lower(replace(v_pay_type, '_', ' ')), v_inv_no,
            lower(replace(v_inv_type, '_', ' ')),
            lower(replace(v_expected, '_', ' '));
    end if;

    if v_inv_stat <> 'POSTED' then
        raise exception 'Invoice % is % and cannot be settled', v_inv_no, v_inv_stat;
    end if;

    -- Only a refund pays money back, and only a refund may allocate below zero.
    if (v_pay_type in ('CUSTOMER_REFUND', 'SUPPLIER_REFUND')) <> (new.amount < 0) then
        raise exception 'Only a refund allocates a negative amount, and a refund allocates nothing else';
    end if;

    return new;
end;
$function$;
