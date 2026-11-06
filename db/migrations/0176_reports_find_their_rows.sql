-- Indexes for what the big reports filter on and had nothing for.
--
-- The reports pick documents by type and document date (sales, purchases,
-- supplier performance, aging), but the only dated index was on the posting
-- date; a branch picks documents and ledger lines by location, which had
-- none; and a landed cost reads its charges, a reversal its original, and a
-- schedule its invoice, all by columns nothing indexed.

create index if not exists document_company_type_doc_date_idx
    on document (company_id, doc_type, doc_date);
create index if not exists document_location_idx
    on document (location_id) where location_id is not null;
create index if not exists journal_line_company_location_idx
    on journal_line (company_id, location_id) where location_id is not null;
create index if not exists landed_cost_charge_landed_cost_idx
    on landed_cost_charge (landed_cost_id);
create index if not exists landed_cost_allocation_receipt_line_idx
    on landed_cost_allocation (receipt_line_id) where receipt_line_id is not null;
create index if not exists journal_entry_reverses_idx
    on journal_entry (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists payment_schedule_invoice_idx
    on payment_schedule (invoice_id) where invoice_id is not null;
