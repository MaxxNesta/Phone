-- Open items and invoice status: resolve versions only where there is one.
--
-- Both views match returns and credit notes to their invoice with
-- fn_current_document(d.id) on every invoice row. The function is a recursive
-- query and cannot be inlined, so a list of 28,000 invoices made 28,000 calls:
-- 340 ms of a 430 ms scan, on every page that reads open items (the
-- Executive dashboard, aging, the invoice lists).
--
-- The function returns the document itself whenever nothing supersedes it,
-- which is every invoice that was never corrected. So it is asked only for
-- the ones that were; the answer is the same for every row. Each definition
-- below is the live one (pg_get_viewdef, identical on DEV and local at 0215)
-- with that one join condition changed and nothing else.

create or replace view v_open_item as
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(al.allocated, 0::numeric) AS allocated,
    d.gross_total - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric) AS outstanding,
        CASE
            WHEN d.due_date IS NULL THEN NULL::integer
            ELSE fn_shop_today() - d.due_date
        END AS days_overdue,
        CASE
            WHEN d.due_date IS NULL THEN 'NO_DUE_DATE'::text
            WHEN fn_shop_today() <= d.due_date THEN 'CURRENT'::text
            WHEN (fn_shop_today() - d.due_date) <= 30 THEN '1-30'::text
            WHEN (fn_shop_today() - d.due_date) <= 60 THEN '31-60'::text
            WHEN (fn_shop_today() - d.due_date) <= 90 THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket,
    COALESCE(r.returned, 0::numeric) AS returned,
    d.exchange_rate,
    round((d.gross_total - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric)) / d.exchange_rate, 4) AS fc_outstanding
   FROM document d
     JOIN business_partner p ON p.id = d.partner_id
     LEFT JOIN ( SELECT pa.invoice_id,
            sum(pa.amount) AS allocated
           FROM payment_allocation pa
             JOIN document pay ON pay.id = pa.payment_id
             LEFT JOIN document app ON app.id = pa.applied_by_document_id
          WHERE pay.status = 'POSTED'::text AND pay.reversed_by_document_id IS NULL AND (pa.applied_by_document_id IS NULL OR app.status = 'POSTED'::text)
          GROUP BY pa.invoice_id) al ON al.invoice_id = d.id
     LEFT JOIN ( SELECT fn_current_document(rr.source_document_id) AS invoice_id,
            sum(rr.gross_total) AS returned
           FROM document rr
          WHERE (rr.doc_type = ANY (ARRAY['SALES_RETURN'::text, 'PURCHASE_RETURN'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text])) AND rr.status = 'POSTED'::text AND rr.reversed_by_document_id IS NULL AND rr.reverses_document_id IS NULL AND rr.source_document_id IS NOT NULL
          GROUP BY (fn_current_document(rr.source_document_id))) r ON r.invoice_id = CASE WHEN d.superseded_by_document_id IS NULL THEN d.id ELSE fn_current_document(d.id) END
  WHERE d.status = 'POSTED'::text AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND d.reverses_document_id IS NULL AND (d.gross_total - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric)) <> 0::numeric;

create or replace view v_invoice_status as
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(a.paid, 0::numeric) AS paid,
    d.gross_total - COALESCE(a.paid, 0::numeric) - COALESCE(r.returned, 0::numeric) AS outstanding,
        CASE
            WHEN COALESCE(a.paid, 0::numeric) = 0::numeric AND COALESCE(r.returned, 0::numeric) < d.gross_total THEN 'OPEN'::text
            WHEN COALESCE(a.paid, 0::numeric) >= (d.gross_total - COALESCE(r.returned, 0::numeric)) THEN 'PAID'::text
            ELSE 'PARTIALLY_PAID'::text
        END AS payment_status,
        CASE
            WHEN d.due_date IS NULL THEN NULL::integer
            ELSE fn_shop_today() - d.due_date
        END AS days_overdue,
    COALESCE(r.returned, 0::numeric) AS returned
   FROM document d
     JOIN business_partner p ON p.id = d.partner_id
     LEFT JOIN ( SELECT pa.invoice_id,
            sum(pa.amount) AS paid
           FROM payment_allocation pa
             JOIN document pay ON pay.id = pa.payment_id
             LEFT JOIN document app ON app.id = pa.applied_by_document_id
          WHERE pay.status = 'POSTED'::text AND pay.reversed_by_document_id IS NULL AND (pa.applied_by_document_id IS NULL OR app.status = 'POSTED'::text)
          GROUP BY pa.invoice_id) a ON a.invoice_id = d.id
     LEFT JOIN ( SELECT fn_current_document(rr.source_document_id) AS invoice_id,
            sum(rr.gross_total) AS returned
           FROM document rr
          WHERE (rr.doc_type = ANY (ARRAY['SALES_RETURN'::text, 'PURCHASE_RETURN'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text])) AND rr.status = 'POSTED'::text AND rr.reversed_by_document_id IS NULL AND rr.reverses_document_id IS NULL AND rr.source_document_id IS NOT NULL
          GROUP BY (fn_current_document(rr.source_document_id))) r ON r.invoice_id = CASE WHEN d.superseded_by_document_id IS NULL THEN d.id ELSE fn_current_document(d.id) END
  WHERE d.status = 'POSTED'::text AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND d.reverses_document_id IS NULL;

