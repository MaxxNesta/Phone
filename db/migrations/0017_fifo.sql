-- 0017_fifo.sql
-- Switches inventory costing from company-wide moving average to FIFO,
-- tracked per warehouse.
--
-- Two new append-only tables, same philosophy as stock_movement: nothing is
-- ever updated in place, everything derives from summing immutable rows.
--
--   stock_lot            one row per receipt — what arrived, at what cost.
--   stock_lot_consumption one row per (issue, lot) pair — what was drawn
--                         from that lot, and at the lot's own cost, frozen.
--
-- A lot's remaining quantity is never stored; it is qty_received less the
-- sum of its consumption rows, same pattern as qty_on_hand.
--
-- fn_moving_average_cost is left in place rather than dropped — it is what
-- the backfill below uses to value opening lots, and removing a function
-- gains nothing a migration can't just stop calling.

create table stock_lot (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references company(id),
    item_id           uuid not null references item(id),
    location_id       uuid not null references location(id),

    received_date     date not null,
    unit_cost         numeric(18,4) not null,
    qty_received      numeric(18,4) not null check (qty_received > 0),

    -- Null only for the opening lots this migration backfills below — a
    -- real receipt always has the movement that created it.
    stock_movement_id uuid references stock_movement(id),

    created_at        timestamptz not null default now()
);

create index on stock_lot (company_id, item_id, location_id, received_date, created_at);
create index on stock_lot (stock_movement_id) where stock_movement_id is not null;

create table stock_lot_consumption (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references company(id),
    lot_id            uuid not null references stock_lot(id),
    stock_movement_id uuid not null references stock_movement(id),

    qty               numeric(18,4) not null check (qty > 0),
    unit_cost         numeric(18,4) not null,

    created_at        timestamptz not null default now()
);

create index on stock_lot_consumption (company_id, lot_id);
create index on stock_lot_consumption (stock_movement_id);

create or replace function fn_stock_lot_immutable() returns trigger
language plpgsql as $$
begin
    raise exception 'Stock lots are append-only. Post a reversing movement instead.';
end;
$$;

create trigger trg_stock_lot_immutable
    before update or delete on stock_lot
    for each row execute function fn_stock_lot_immutable();

create or replace function fn_stock_lot_consumption_immutable() returns trigger
language plpgsql as $$
begin
    raise exception 'Lot consumption is append-only. Post a reversing movement instead.';
end;
$$;

create trigger trg_stock_lot_consumption_immutable
    before update or delete on stock_lot_consumption
    for each row execute function fn_stock_lot_consumption_immutable();

-- Open lots with what's left in them, oldest first — the query every FIFO
-- draw and every "what's this warehouse actually holding" report both want.
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

-- ---------------------------------------------------------- opening lots --

-- Whatever is on hand right now, per item and warehouse, becomes one lot
-- dated today, valued at that item's moving-average cost as of this cutover
-- — the best cost basis available for stock that predates lot tracking.
-- Nothing about existing stock_movement history is touched.
insert into stock_lot (company_id, item_id, location_id, received_date, unit_cost, qty_received, stock_movement_id)
select sm.company_id, sm.item_id, sm.location_id, current_date,
       fn_moving_average_cost(sm.company_id, sm.item_id),
       sum(sm.qty),
       null
  from stock_movement sm
 group by sm.company_id, sm.item_id, sm.location_id
having sum(sm.qty) > 0.0001;
