-- A document is found from its journal entry without reading every document.
--
-- Nothing indexed document.journal_entry_id, so every "which document posted
-- this entry" lookup scanned the whole table. The income statement's cost of
-- sales check asks that once per cost-of-sales line: on 12,000 documents it
-- took 15 seconds, and grew with every sale — found by the soak test.

create index if not exists document_journal_entry_id_idx on document (journal_entry_id);
