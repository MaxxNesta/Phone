-- A debt in yuan is paid in yuan.
--
-- Phones are bought from China in yuan and sold here in kyat. The schema has
-- carried currency and rate on every document and journal line since 0001;
-- what was missing is the engine using them, and two readings that only
-- disagree once a rate moves.
--
-- The rule (docs/06-phone-retail.md, D-P6):
--
--   * Documents keep their totals in kyat, at the document's own rate, so
--     every report reads what it always read. The yuan figure is the kyat
--     figure over the document's rate — derived, never a second total that
--     could disagree.
--   * Inventory is valued at the rate on the day the goods arrive.
--   * The payable is carried at that rate until it is paid; paying it at a
--     different rate books the difference to FX gain or loss.
--   * Journal lines on a foreign payable carry the yuan amount, the rate and
--     the kyat base — `amount` in yuan, `base_amount` in kyat.
--
-- payment_allocation already has two columns that have always been equal:
-- `amount` and `base_amount`. A settlement in yuan relieves the invoice at
-- the invoice's rate and spends the payment at the payment's rate, so the
-- two now differ, and each view reads the side it is about:
--
--   amount       the invoice's side, in kyat at the invoice's rate
--                (v_open_item: what the invoice still owes)
--   base_amount  the payment's side, in kyat at the payment's rate
--                (v_partner_advance: what an advance has left)
--
-- Every row written before this has the two equal, so both views return
-- exactly what they did.

drop view if exists v_partner_advance;

create view v_partner_advance as
select
    d.company_id,
    d.partner_id,
    p.code  as partner_code,
    p.name  as partner_name,
    d.doc_type,
    d.id    as payment_id,
    d.doc_no,
    d.doc_date,
    d.location_id,
    d.gross_total                                as received,
    coalesce(al.applied, 0)                      as applied,
    d.gross_total - coalesce(al.applied, 0)      as available,
    d.currency,
    d.exchange_rate,
    -- What is left, in the money it was paid in.
    round((d.gross_total - coalesce(al.applied, 0)) / d.exchange_rate, 4) as fc_available
  from document d
  join business_partner p on p.id = d.partner_id
  left join (
        select pa.payment_id, sum(pa.base_amount) as applied
          from payment_allocation pa
          join document inv on inv.id = pa.invoice_id
          left join document app on app.id = pa.applied_by_document_id
         where inv.status = 'POSTED'
           and (pa.applied_by_document_id is null or app.status = 'POSTED')
         group by pa.payment_id
  ) al on al.payment_id = d.id
 where d.status = 'POSTED'
   and d.doc_type in ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT')
   and d.gross_total - coalesce(al.applied, 0) > 0.0001;

comment on view v_partner_advance is
    'Money received or paid that no invoice has claimed yet, per partner and '
    'per document, in kyat and in the currency it was paid in.';

-- What an invoice still owes, now also in its own currency. Appended
-- columns only, so everything selecting the existing ones is unaffected.
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
            ELSE CURRENT_DATE - d.due_date
        END AS days_overdue,
        CASE
            WHEN d.due_date IS NULL THEN 'NO_DUE_DATE'::text
            WHEN CURRENT_DATE <= d.due_date THEN 'CURRENT'::text
            WHEN (CURRENT_DATE - d.due_date) <= 30 THEN '1-30'::text
            WHEN (CURRENT_DATE - d.due_date) <= 60 THEN '31-60'::text
            WHEN (CURRENT_DATE - d.due_date) <= 90 THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket,
    COALESCE(r.returned, 0::numeric) AS returned,
    d.exchange_rate,
    round((d.gross_total - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric))
          / d.exchange_rate, 4) AS fc_outstanding
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
          GROUP BY (fn_current_document(rr.source_document_id))) r ON r.invoice_id = fn_current_document(d.id)
  WHERE d.status = 'POSTED'::text AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND d.reverses_document_id IS NULL AND (d.gross_total - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric)) <> 0::numeric;

-- The rate a supplier's documents default to, kept with the rates already
-- in exchange_rate. MARKET is what a phone shop buys yuan at.
comment on column business_partner.currency is
    'The currency this partner bills or pays in. Null is the company''s own.';
