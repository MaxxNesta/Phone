-- 0018_lot_timestamp.sql
-- FIFO consumption already breaks same-day ties by created_at (the row's
-- actual insertion moment) — but that's data-entry order, not necessarily
-- the order stock physically arrived in. If an afternoon delivery gets
-- entered before a morning one, FIFO would draw them backwards with no way
-- to see or correct it, since nothing shown a time at all.
--
-- Widens stock_lot.received_date from date to timestamptz so a real
-- time-of-day can be captured (and edited) at the point of receipt, not just
-- inferred from insertion order. Existing rows cast to midnight on their
-- existing date — their relative ordering against each other is unchanged;
-- only newly-created lots gain real time precision.

-- v_stock_lot_open reads this column, and Postgres won't widen a column's
-- type while a view depends on it — drop and recreate around the alter.
drop view v_stock_lot_open;

alter table stock_lot
  alter column received_date type timestamptz using received_date::timestamptz;

create view v_stock_lot_open as
select
    l.id as lot_id, l.company_id, l.item_id, l.location_id,
    l.received_date, l.unit_cost, l.qty_received,
    l.qty_received - coalesce(sum(c.qty), 0) as qty_remaining
  from stock_lot l
  left join stock_lot_consumption c on c.lot_id = l.id
 group by l.id, l.company_id, l.item_id, l.location_id,
          l.received_date, l.unit_cost, l.qty_received
having l.qty_received - coalesce(sum(c.qty), 0) > 0.0001;
