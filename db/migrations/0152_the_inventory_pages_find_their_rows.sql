-- The inventory pages find their rows
--
-- Measured at shop scale on DEV (1,917 items, 10,080 IMEIs): every list the
-- inventory pages read already has the index its join or filter uses, with
-- two exceptions, both added here.
--
-- stock_serial(stock_lot_id). The units on a layer. fn_lot_named_on_hand
-- (0150) asks it for every layer an Optional-serial issue considers, and with
-- no index each ask read the whole of stock_serial.
--
-- landed_cost_allocation(receipt_id, item_id). What a receipt's units
-- received from landed costs — the Stock page's cost card, per unit.

create index if not exists stock_serial_lot_idx on stock_serial (stock_lot_id);
create index if not exists landed_cost_allocation_receipt_idx on landed_cost_allocation (receipt_id, item_id);
