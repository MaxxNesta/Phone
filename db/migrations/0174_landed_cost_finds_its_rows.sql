-- Indexes for what landed cost and a bill's price correction look up.
--
-- A receipt line's stock is found by the line (adjustReceiptCost, a landed
-- cost on goods without an IMEI, and the "puts nothing in stock" check), and a
-- landed cost's own rows by the landed cost — none of which had an index, so
-- each read scanned the whole table.

create index if not exists stock_movement_document_line_idx
    on stock_movement (document_line_id) where document_line_id is not null;
create index if not exists landed_cost_allocation_landed_cost_idx
    on landed_cost_allocation (landed_cost_id);
create index if not exists landed_cost_posting_landed_cost_idx
    on landed_cost_posting (landed_cost_id, document_id);
