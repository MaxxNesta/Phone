-- Money goes back to a customer
--
-- A return against a paid invoice leaves the invoice below nothing: the
-- customer is owed the difference, and nothing in the system could pay it.
-- A cash voucher could move the money, but it would debit receivables with no
-- open item saying so, and the ledger and the subledger would disagree.
--
-- A refund is its own document, CUSTOMER_REFUND (prefix RF). It is raised from
-- the return it pays out, names the payment channel and reference like a
-- receipt does, and:
--
--   against an invoice:  Dr Accounts Receivable / Cr the channel's account,
--                        with an allocation of minus the amount, so the
--                        invoice climbs back from below nothing to zero.
--   with no invoice:     Dr Customer Advances / Cr the channel's account,
--                        paying out the credit the return left on account.
--
-- Voiding a refund reverses it; a return cannot be voided while a refund
-- raised from it stands (the void's ordinary "raised from this" rule).

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check check (doc_type = any (array[
  'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN', 'SUPPLIER_PAYMENT',
  'SALES_ORDER', 'DELIVERY', 'SALES_INVOICE', 'SALES_RETURN', 'CUSTOMER_RECEIPT', 'CUSTOMER_REFUND',
  'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'CASH_VOUCHER', 'BANK_VOUCHER', 'JOURNAL_VOUCHER',
  'CASH_TRANSFER', 'OPENING_BALANCE', 'CONSIGNMENT_RECEIPT', 'CONSIGNMENT_SETTLEMENT',
  'ADVANCE_APPLICATION', 'CREDIT_NOTE', 'DEBIT_NOTE', 'YEAR_END_CLOSE', 'LANDED_COST']));

create or replace function fn_document_prefix(p_type text, p_direction text)
returns text language sql immutable as $$
    select case
        when p_type = 'CASH_VOUCHER' and p_direction = 'OUT' then 'P'
        when p_type = 'CASH_VOUCHER'                         then 'R'
        when p_type = 'BANK_VOUCHER' and p_direction = 'OUT' then 'BP'
        when p_type = 'BANK_VOUCHER'                         then 'BR'

        when p_type = 'CUSTOMER_RECEIPT'    then 'CR'
        when p_type = 'CUSTOMER_REFUND'     then 'RF'
        when p_type = 'SUPPLIER_PAYMENT'    then 'CP'
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
$$;

-- A refund settles (negatively) the sales invoice its return was against.
create or replace function fn_allocation_pairing() returns trigger
language plpgsql as $$
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
    if (v_pay_type = 'CUSTOMER_REFUND') <> (new.amount < 0) then
        raise exception 'Only a refund allocates a negative amount, and a refund allocates nothing else';
    end if;

    return new;
end;
$$;

-- One posted payment per channel and reference, refunds included.
drop index if exists document_payment_reference_once;
create unique index document_payment_reference_once
    on document (company_id, doc_type, payment_channel_id, lower(payment_reference))
 where payment_channel_id is not null and payment_reference is not null and status = 'POSTED'
   and doc_type in ('CUSTOMER_RECEIPT', 'CUSTOMER_REFUND');
