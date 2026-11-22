-- A phone we sold coming back as a secondhand purchase is recorded on its
-- own history as REACQUIRED (0209): the same unit, a new acquisition.
alter table stock_serial_event drop constraint if exists stock_serial_event_event_check;
alter table stock_serial_event add constraint stock_serial_event_event_check check (event = any (array[
  'RECEIVED', 'SOLD', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'TRANSFER', 'RESTORED', 'WRITTEN_OFF',
  'HOLD', 'RELEASE', 'COST_LAYER_SPLIT', 'LANDED_COST', 'REACQUIRED']));
