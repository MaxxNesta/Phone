-- 0006_stock.sql
-- Append-only stock ledger.
--
-- On-hand quantity and value are DERIVED by summing this table. There is no
-- `qty_on_hand` column anywhere to drift out of step with reality, and no
-- UPDATE path that could silently rewrite history.

create table stock_movement (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id),

    item_id          uuid not null references item(id),
    location_id      uuid not null references location(id),

    movement_date    date not null,

    -- Signed, always in the item's base unit. Positive is a receipt into
    -- stock, negative is an issue out of it.
    qty              numeric(18,4) not null check (qty <> 0),

    -- Cost in company base currency. For issues this is the weighted average
    -- at the moment of the movement, resolved at posting time and frozen —
    -- recomputing it later would silently restate closed periods.
    unit_cost        numeric(18,4) not null default 0,
    total_cost       numeric(18,4) not null default 0,

    document_id      uuid references document(id),
    document_line_id uuid references document_line(id),

    batch_no         text,
    expiry_date      date,

    created_at       timestamptz not null default now()
);

create index on stock_movement (company_id, item_id, location_id);
create index on stock_movement (company_id, movement_date);
create index on stock_movement (document_id) where document_id is not null;
create index on stock_movement (company_id, item_id, expiry_date)
    where expiry_date is not null;

create or replace function fn_stock_movement_immutable() returns trigger
language plpgsql as $$
begin
    raise exception
        'Stock movements are append-only. Post a reversing movement instead.';
end;
$$;

create trigger trg_stock_movement_immutable
    before update or delete on stock_movement
    for each row execute function fn_stock_movement_immutable();

-- Location must actually be able to hold stock.
create or replace function fn_stock_location_guard() returns trigger
language plpgsql as $$
declare
    l location;
    i item;
begin
    select * into l from location where id = new.location_id;
    if not l.is_stock_location then
        raise exception
            'Location % (%) is not a stock location', l.code, l.name;
    end if;

    select * into i from item where id = new.item_id;
    if not i.is_stocked then
        raise exception
            'Item % (%) is not stocked and cannot have movements', i.code, i.name;
    end if;

    return new;
end;
$$;

create trigger trg_stock_location_guard
    before insert on stock_movement
    for each row execute function fn_stock_location_guard();

-- ------------------------------------------------------------- valuation --

-- Moving weighted average across all locations. Company-wide rather than
-- per-location, because a transfer must not change the valuation of stock
-- that hasn't been sold — see decision D2.
create or replace function fn_moving_average_cost(
    p_company uuid, p_item uuid, p_as_of date default null
) returns numeric language sql stable as $$
    select case
        when coalesce(sum(qty), 0) = 0 then 0
        else round(sum(total_cost) / sum(qty), 4)
    end
      from stock_movement
     where company_id = p_company
       and item_id    = p_item
       and (p_as_of is null or movement_date <= p_as_of);
$$;

create or replace function fn_qty_on_hand(
    p_company uuid, p_item uuid, p_location uuid default null, p_as_of date default null
) returns numeric language sql stable as $$
    select coalesce(sum(qty), 0)
      from stock_movement
     where company_id = p_company
       and item_id    = p_item
       and (p_location is null or location_id = p_location)
       and (p_as_of   is null or movement_date <= p_as_of);
$$;
