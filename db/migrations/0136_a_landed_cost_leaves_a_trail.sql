-- A landed cost leaves a trail
--
-- Two kinds of history the landed cost writes that the tables did not allow.
--
-- A phone's own history (stock_serial_event) gains COST_LAYER_SPLIT, when it
-- is moved off a shared cost layer onto one of its own, and LANDED_COST, when
-- a landed cost is put on it or taken off it — so the IMEI page can say why
-- its cost changed.
--
-- A document's history gains the steps a landed cost goes through before and
-- after it posts: created, edited, calculated, excluded lines acknowledged,
-- posted, reversed. Until now it recorded only voids and amendments, because
-- every other document is posted the moment it exists.

alter table stock_serial_event drop constraint if exists stock_serial_event_event_check;
alter table stock_serial_event add constraint stock_serial_event_event_check check (event = any (array[
  'RECEIVED', 'SOLD', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'TRANSFER', 'RESTORED',
  'WRITTEN_OFF', 'HOLD', 'RELEASE', 'COST_LAYER_SPLIT', 'LANDED_COST']));

alter table document_history drop constraint if exists document_history_action_check;
alter table document_history add constraint document_history_action_check check (action = any (array[
  'VOID', 'AMEND', 'CREATE', 'UPDATE', 'CALCULATE', 'ACKNOWLEDGE', 'POST', 'REVERSE']));
