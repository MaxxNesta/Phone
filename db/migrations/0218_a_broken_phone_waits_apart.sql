-- A broken phone waits apart: the quarantine location (docs/06, D-P7).
--
-- Ten phones arrive and one is broken. It is still ours until it goes back,
-- still stock at its cost on the balance sheet, and its IMEI has to be
-- found when the return is made — so it is received, but into a location
-- nobody can sell from. The same place takes a faulty phone a customer
-- brings back, until it goes to the supplier or is written off.
--
-- A quarantine bin inside every warehouse — "Main Warehouse / Quarantine" —
-- so the stock in a building is all counted there, while anything that sells
-- or picks leaves the bin out. Made with the warehouse, and in any case the
-- first time it is needed (fn_quarantine_location). What it refuses is
-- enforced here rather than in each screen: a sales order, invoice or
-- delivery dated at it, and any goods leaving it on a sale or a delivery,
-- whichever path posted them. Reversals are left alone: a void puts back
-- exactly what its original moved.

alter table location add column if not exists is_quarantine boolean not null default false;

comment on column location.is_quarantine is
    'A bin inside a warehouse holding stock that is not for sale: rejected on arrival or '
    'returned faulty. Still valued stock, counted in its warehouse. One per warehouse, '
    'made by fn_quarantine_location.';

alter table location drop constraint if exists location_quarantine_is_a_bin;
alter table location add constraint location_quarantine_is_a_bin
    check (not is_quarantine or (is_stock_location and parent_id is not null));

create unique index if not exists location_one_quarantine_per_warehouse
    on location (company_id, parent_id) where is_quarantine;

-- The warehouse's quarantine bin, made on first use. Named and coded after
-- the warehouse, so a stock list reads "Main Warehouse / Quarantine" and the
-- code is unique without anyone choosing one.
create or replace function fn_quarantine_location(p_location uuid)
returns uuid language plpgsql as $$
declare
    w      record;
    q      uuid;
    code_  text;
    n      int := 1;
begin
    select l.id, l.company_id, l.code, l.name, l.name_my, l.is_stock_location, l.is_quarantine
      into w
      from location l where l.id = p_location;
    if w.id is null then
        raise exception 'No location %', p_location;
    end if;
    if w.is_quarantine then return w.id; end if;
    if not w.is_stock_location then
        raise exception 'Quarantine is a bin inside a warehouse; % is not one.', w.name;
    end if;

    select id into q from location
     where company_id = w.company_id and parent_id = w.id and is_quarantine;
    if q is not null then return q; end if;

    code_ := w.code || '-QRT';
    while exists (select 1 from location where company_id = w.company_id and code = code_) loop
        n := n + 1;
        code_ := w.code || '-QRT' || n;
    end loop;

    insert into location (company_id, parent_id, code, name, name_my, is_stock_location, is_quarantine)
    values (w.company_id, w.id, code_, w.name || ' / Quarantine',
            case when w.name_my is not null then w.name_my || ' / ချို့ယွင်းပစ္စည်းထားရာ' end, true, true)
    on conflict (company_id, parent_id) where is_quarantine do nothing
    returning id into q;

    -- Another transaction made it first.
    if q is null then
        select id into q from location
         where company_id = w.company_id and parent_id = w.id and is_quarantine;
    end if;
    return q;
end $$;

comment on function fn_quarantine_location(uuid) is
    'The quarantine bin inside a warehouse (the bin itself if given one); made on first use.';

-- The warehouse a location counts in: itself, or for a quarantine bin the
-- warehouse it sits in. Stock reports group by this, so a building's stock
-- is one figure with its quarantine share beside it.
create or replace function fn_stock_home(p_location uuid)
returns uuid language sql stable as $$
    select case when l.is_quarantine then l.parent_id else l.id end
      from location l where l.id = p_location
$$;

-- Nothing is sold from quarantine: no sales document is dated there.
create or replace function fn_document_not_from_quarantine() returns trigger
language plpgsql as $$
begin
    if new.doc_type in ('SALES_ORDER', 'SALES_INVOICE', 'DELIVERY')
       and new.reverses_document_id is null
       and exists (select 1 from location where id = new.location_id and is_quarantine) then
        raise exception 'Nothing can be sold from quarantine. Choose a shop or warehouse location.';
    end if;
    return new;
end $$;

drop trigger if exists trg_document_not_from_quarantine on document;
create trigger trg_document_not_from_quarantine
    before insert on document
    for each row execute function fn_document_not_from_quarantine();

-- And no goods leave it on a sale or a delivery, whatever location the
-- document itself names — a line may carry its own.
create or replace function fn_stock_not_sold_from_quarantine() returns trigger
language plpgsql as $$
begin
    if new.qty < 0
       and exists (select 1 from location where id = new.location_id and is_quarantine)
       and exists (select 1 from document d
                    where d.id = new.document_id
                      and d.doc_type in ('SALES_INVOICE', 'DELIVERY')
                      and d.reverses_document_id is null) then
        raise exception 'This stock is in quarantine and cannot be sold. Release it to a shop or warehouse first.';
    end if;
    return new;
end $$;

drop trigger if exists trg_stock_not_sold_from_quarantine on stock_movement;
create trigger trg_stock_not_sold_from_quarantine
    before insert on stock_movement
    for each row execute function fn_stock_not_sold_from_quarantine();

-- Stock on hand says which rows are in quarantine, so a figure meant as
-- "can be sold" can leave them out while value totals keep them, and which
-- warehouse each row counts in (warehouse_id: a bin's is its parent's), so
-- a building's stock is one figure.
create or replace view v_stock_on_hand as
select
    sm.company_id,
    sm.item_id,
    i.code as item_code,
    i.name as item_name,
    sm.location_id,
    l.code as location_code,
    sum(sm.qty)        as qty_on_hand,
    sum(sm.total_cost) as value_on_hand,
    l.is_quarantine,
    case when l.is_quarantine then l.parent_id else l.id end as warehouse_id
  from stock_movement sm
  join item     i on i.id = sm.item_id
  join location l on l.id = sm.location_id
 group by sm.company_id, sm.item_id, i.code, i.name, sm.location_id, l.id, l.code, l.is_quarantine, l.parent_id
having sum(sm.qty) <> 0 or sum(sm.total_cost) <> 0;

-- Every warehouse gets its bin now, so a form that offers "move to
-- quarantine" or "release" always has it to offer. A warehouse made later
-- gets one with it (lib/actions.ts, lib/setup.ts); fn_quarantine_location
-- makes one in any case on first use. Bins of bins are not made: a stock
-- location inside another stock location counts in that one.
select fn_quarantine_location(w.id)
  from location w
 where w.is_stock_location and not w.is_quarantine
   and not exists (select 1 from location p where p.id = w.parent_id and p.is_stock_location);
