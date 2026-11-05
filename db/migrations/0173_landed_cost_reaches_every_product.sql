-- Landed cost reaches every product, not only the phones.
--
-- A phone is still costed one by one: a row per IMEI, as before. Anything
-- without an IMEI or serial number — a case, a charger, a SIM — is fungible
-- inside its receipt line, so its share is kept per receipt line instead: one
-- row carrying the line's units (qty) at their cost each (original_cost).
--
-- Posting such a line puts its share on the line's cost layer and follows the
-- goods the way a supplier bill's price correction does: what is still on the
-- shelf is revalued, what has been sold goes to cost of sales, what was moved
-- goes with it to the other warehouse. A posting row is kept per account that
-- took a part, so the reversal and the receipt's summary both know.

alter table landed_cost_allocation alter column serial_id drop not null;
alter table landed_cost_allocation add column if not exists qty numeric(18,4) not null default 1
    check (qty > 0);
alter table landed_cost_allocation drop constraint if exists landed_cost_allocation_unit_or_line;
alter table landed_cost_allocation add constraint landed_cost_allocation_unit_or_line
    check (serial_id is not null or receipt_line_id is not null);
create unique index if not exists landed_cost_allocation_line_key
    on landed_cost_allocation (charge_id, receipt_line_id) where serial_id is null;

alter table landed_cost_posting alter column serial_id drop not null;
alter table landed_cost_posting add column if not exists receipt_line_id uuid references document_line(id);
alter table landed_cost_posting drop constraint if exists landed_cost_posting_unit_or_line;
alter table landed_cost_posting add constraint landed_cost_posting_unit_or_line
    check (serial_id is not null or receipt_line_id is not null);
create index if not exists landed_cost_posting_line_idx on landed_cost_posting (receipt_line_id)
    where receipt_line_id is not null;
