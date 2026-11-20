-- A broken phone waits apart: the quarantine location (docs/06, D-P7).
--
-- Ten phones arrive and one is broken. It is still ours until it goes back,
-- still stock at its cost on the balance sheet, and its IMEI has to be
-- found when the return is made — so it is received, but into a location
-- nobody can sell from. The same place takes a faulty phone a customer
-- brings back, until it goes to the supplier or is written off.
--
-- One quarantine location per branch, a warehouse under it, created the
-- first time it is needed (fn_quarantine_location). What it refuses is
-- enforced here rather than in each screen: a sales order, invoice or
-- delivery dated at it, and any goods leaving it on a sale or a delivery,
-- whichever path posted them. Reversals are left alone: a void puts back
-- exactly what its original moved.

alter table location add column if not exists is_quarantine boolean not null default false;

comment on column location.is_quarantine is
    'Stock held apart and not for sale: rejected on arrival or returned faulty. '
    'Still valued stock. One per branch, created by fn_quarantine_location.';

alter table location drop constraint if exists location_quarantine_is_a_warehouse;
alter table location add constraint location_quarantine_is_a_warehouse
    check (not is_quarantine or (is_stock_location and parent_id is not null));

create unique index if not exists location_one_quarantine_per_branch
    on location (company_id, parent_id) where is_quarantine;

-- The branch's quarantine location, made on first use. Named after the
-- branch so a stock list reads "Yangon Quarantine", coded after it so the
-- code is unique without anyone choosing one.
create or replace function fn_quarantine_location(p_location uuid)
returns uuid language plpgsql as $$
declare
    b      record;
    q      uuid;
    code_  text;
    n      int := 1;
begin
    select l.id, l.company_id, l.code, l.name, l.name_my
      into b
      from location l where l.id = fn_location_branch(p_location);
    if b.id is null then
        raise exception 'No branch found for location %', p_location;
    end if;

    select id into q from location
     where company_id = b.company_id and parent_id = b.id and is_quarantine;
    if q is not null then return q; end if;

    code_ := b.code || '-QRT';
    while exists (select 1 from location where company_id = b.company_id and code = code_) loop
        n := n + 1;
        code_ := b.code || '-QRT' || n;
    end loop;

    insert into location (company_id, parent_id, code, name, name_my, is_stock_location, is_quarantine)
    values (b.company_id, b.id, code_, b.name || ' Quarantine', null, true, true)
    on conflict (company_id, parent_id) where is_quarantine do nothing
    returning id into q;

    -- Another transaction made it first.
    if q is null then
        select id into q from location
         where company_id = b.company_id and parent_id = b.id and is_quarantine;
    end if;
    return q;
end $$;

comment on function fn_quarantine_location(uuid) is
    'The quarantine location of the branch a location sits in; created on first use.';

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
-- "can be sold" can leave them out while value totals keep them.
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
    l.is_quarantine
  from stock_movement sm
  join item     i on i.id = sm.item_id
  join location l on l.id = sm.location_id
 group by sm.company_id, sm.item_id, i.code, i.name, sm.location_id, l.code, l.is_quarantine
having sum(sm.qty) <> 0 or sum(sm.total_cost) <> 0;

-- Every branch that already holds stock gets its quarantine now, so a form
-- that offers "move to quarantine" or "release" always has it to offer.
-- A branch made later gets one with its first warehouse (lib/actions.ts),
-- and fn_quarantine_location makes one in any case on first use.
select fn_quarantine_location(b.id)
  from location b
 where b.parent_id is null
   and exists (select 1 from location w
                where w.parent_id = b.id and w.is_stock_location and not w.is_quarantine);
