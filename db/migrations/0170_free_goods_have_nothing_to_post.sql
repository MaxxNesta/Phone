-- Free goods have nothing to post
--
-- A goods receipt or purchase invoice of nothing but a supplier's free goods
-- (FOC) is worth nothing: the stock arrives at zero cost and the supplier is
-- owed nothing. journal_line forbids a zero amount, so there is no entry to
-- write, and the engine now writes none. This permits that for a receipt or
-- bill whose every line, and whose total, is worth nothing — the same narrow
-- allowance 0112 made for a delivery worth nothing.
--
-- A receipt or bill with any value still requires its entry, so a genuinely
-- missing posting is still caught.

create or replace function fn_document_posting_required() returns trigger
language plpgsql as $$
declare
    d document;
    v_all_consigned boolean;
    v_value numeric;
begin
    select * into d from document where id = new.id;
    if not found then
        return null;
    end if;

    if d.status <> 'POSTED' or d.journal_entry_id is not null then
        return null;
    end if;

    if d.doc_type = 'DELIVERY' then
        -- A delivery moving only consigned stock has nothing owned to
        -- relieve, so a missing journal entry is correct rather than a sign
        -- something was skipped.
        select coalesce(bool_and(dl.is_consignment), false) into v_all_consigned
          from document_line dl where dl.document_id = d.id;
        if v_all_consigned then
            return null;
        end if;

        -- Nor has a delivery worth nothing. net_amount on a delivery line
        -- holds the cost the goods left at, free-of-charge lines included,
        -- so this is the whole value of the movement.
        select coalesce(sum(abs(dl.net_amount)), 0) into v_value
          from document_line dl where dl.document_id = d.id;
        if v_value = 0 then
            return null;
        end if;

        raise exception
            'Document % (%) is posted but has no journal entry', d.doc_no, d.doc_type;
    end if;

    -- Free goods from a supplier: a receipt or bill worth nothing at all.
    if d.doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE') then
        select coalesce(sum(abs(dl.net_amount) + abs(coalesce(dl.tax_amount, 0))), 0) + abs(coalesce(d.gross_total, 0))
          into v_value
          from document_line dl where dl.document_id = d.id;
        if v_value = 0 then
            return null;
        end if;
    end if;

    if d.doc_type in (
            'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
            'SUPPLIER_PAYMENT', 'SALES_INVOICE',
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
