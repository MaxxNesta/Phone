-- A box of phones is counted before it is received.
--
-- A goods receipt for phones cannot post until every unit in it has its IMEI:
-- posting says "these exact handsets are now ours", and stock that cannot say
-- which handsets it is would be on the books without being on the shelf in
-- any way anybody could check. Scanning fifty phones is not always one
-- sitting, so the receipt can be kept half-scanned as a draft, like an
-- invoice or an order. A draft moves no stock and posts nothing.

alter table document_draft drop constraint if exists document_draft_doc_type_check;
alter table document_draft add constraint document_draft_doc_type_check
    check (doc_type in ('SALES_INVOICE', 'PURCHASE_INVOICE',
                        'SALES_ORDER',   'PURCHASE_ORDER', 'GOODS_RECEIPT'));
