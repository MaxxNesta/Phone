-- A document's handsets are found by the document.
--
-- The IMEIs card on a document page reads stock_serial_event by document_id
-- (lib/phone.ts serialsOnDocument): the document itself, and since a sales
-- invoice now shows the handsets its composed delivery recorded, the documents
-- composed for it too. Only serial_id was indexed, so every document page
-- scanned the whole event history — fine at a few hundred handsets, not at a
-- shop's tens of thousands.

create index if not exists stock_serial_event_document_idx
    on stock_serial_event (document_id)
 where document_id is not null;
