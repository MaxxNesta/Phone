-- An imported sale keeps its old number
--
-- Sales invoices from the old system's report post as real invoices, each with
-- its delivery, through the same engine as one typed in at the counter. The old
-- document id (c226010001) is kept as source_ref, as a bill's is (0168), and the
-- same guard holds: one posted sales invoice per old id, so a second import of it
-- is refused here even if every check above missed it.

create unique index if not exists document_sales_source_ref_key
    on document (company_id, lower(source_ref))
 where doc_type = 'SALES_INVOICE' and source_ref is not null and status = 'POSTED';
