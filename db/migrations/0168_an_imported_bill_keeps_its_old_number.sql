-- An imported bill keeps its old number
--
-- Purchase invoices imported from the old system now post as real
-- documents (with their goods receipt and any payment) through the same
-- engine as a bill typed in by hand. The old system's document id
-- (s126010003) is kept on each as source_ref: searchable, shown beside the
-- ERP's own number, and the guard against posting the same old bill twice —
-- a second import of it is refused here even if every check above missed it.
--
-- Null on everything entered by hand.

alter table document add column if not exists source_ref text;

create unique index if not exists document_purchase_source_ref_key
    on document (company_id, lower(source_ref))
 where doc_type = 'PURCHASE_INVOICE' and source_ref is not null and status = 'POSTED';

create index if not exists document_source_ref_idx
    on document (company_id, source_ref) where source_ref is not null;

comment on column document.source_ref is
  'The old system''s document id this was imported from (Docid), or null when entered here.';
