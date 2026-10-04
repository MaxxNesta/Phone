-- A phone is followed from the box to the customer, and back.
--
-- 0075 gave each handset an identity and a record of leaving. It left three
-- holes a phone shop falls into on its first day:
--
--   * The cost of a sale was the oldest layer at the location, not the layer
--     the scanned handset arrived on. Sell the dearer of two IMEIs and the
--     margin was computed off the cheaper one.
--   * A handset that came back from a customer stayed "gone": its issue row
--     still stood, so it never reappeared on the shelf.
--   * A transferred handset stayed at the old branch: the destination got a
--     new lot, and the serial still pointed at the source lot.
--
-- The fix is one idea. A serial points at the layer it is in NOW, and an
-- issue records the layer it was drawn from. A unit is out when a standing
-- issue was drawn from its current layer. Anything that brings it back on to
-- a shelf — a customer return, a transfer arriving, a void — puts it on a new
-- layer, and the old issue stops describing where it is. stock_serial_event
-- keeps the history the re-pointing would otherwise lose.

-- ------------------------------------------------------------ retail mode --

alter table company
  add column if not exists retail_mode boolean not null default true;

comment on column company.retail_mode is
    'Counter retail: the sales invoice moves the stock and recognises cost of '
    'sales in its own entry. No delivery, no goods-shipped-not-invoiced. Off '
    'means the trading flow (order, delivery, invoice) and its screens.';

-- ---------------------------------------------------------------- warranty --

alter table item
  add column if not exists warranty_months int
      check (warranty_months is null or warranty_months between 0 and 120),
  add column if not exists supplier_warranty_months int
      check (supplier_warranty_months is null or supplier_warranty_months between 0 and 120);

comment on column item.warranty_months is
    'Warranty the shop gives the customer, copied onto each sale line so a '
    'later change to the model does not rewrite what was promised.';

alter table document_line
  add column if not exists warranty_months int
      check (warranty_months is null or warranty_months between 0 and 120);

-- ----------------------------------------------------------- unit details --

alter table stock_serial
  add column if not exists imei2 text,
  add column if not exists device_serial text,
  add column if not exists supplier_warranty_months int
      check (supplier_warranty_months is null or supplier_warranty_months between 0 and 120),
  add column if not exists notes text;

comment on column stock_serial.serial_no is
    'The identity scanned at the counter: IMEI 1 for a phone.';
comment on column stock_serial.stock_lot_id is
    'The layer this unit is in now. Re-pointed when it comes back on to a '
    'shelf (return, transfer, void); stock_serial_event keeps where it was.';

create unique index if not exists stock_serial_imei2_idx
    on stock_serial (company_id, imei2) where imei2 is not null;
create unique index if not exists stock_serial_device_idx
    on stock_serial (company_id, device_serial) where device_serial is not null;

-- IMEI 1 of one handset may not be IMEI 2 of another. Two unique indexes
-- cannot see across columns, so a trigger does.
create or replace function fn_stock_serial_identity_unique() returns trigger
language plpgsql as $$
begin
    if exists (
        select 1 from stock_serial o
         where o.company_id = new.company_id and o.id <> new.id
           and (o.serial_no = new.imei2 or o.imei2 = new.serial_no
                or (new.imei2 is not null and o.imei2 = new.imei2))
    ) or new.imei2 = new.serial_no then
        raise exception '% / % is already recorded against another unit',
            new.serial_no, coalesce(new.imei2, '-');
    end if;
    return new;
end;
$$;

drop trigger if exists trg_stock_serial_identity_unique on stock_serial;
create trigger trg_stock_serial_identity_unique
    before insert or update of serial_no, imei2 on stock_serial
    for each row execute function fn_stock_serial_identity_unique();

-- --------------------------------------------- an issue knows its layer --

alter table stock_serial_issue
  add column if not exists lot_id uuid references stock_lot(id),
  add column if not exists consumption_id uuid references stock_lot_consumption(id);

create index if not exists stock_serial_issue_consumption_idx
    on stock_serial_issue (consumption_id) where consumption_id is not null;

-- Whether an issue still stands: its document has not been voided. Where the
-- movement has no document nothing can undo it.
create or replace function fn_serial_issue_stands(p_movement uuid) returns boolean
language sql stable as $$
    select coalesce((
        select d.status <> 'REVERSED' and d.reverses_document_id is null
          from stock_movement sm
          join document d on d.id = sm.document_id
         where sm.id = p_movement), true);
$$;

-- The last line of defence for "two tills sold one phone". The engine locks
-- the serial and checks; this holds even for a caller that forgot to.
create or replace function fn_stock_serial_issue_guard() returns trigger
language plpgsql as $$
declare
    cur uuid;
    sn  text;
begin
    select stock_lot_id, serial_no into cur, sn
      from stock_serial where id = new.serial_id for update;
    if new.lot_id is not null and new.lot_id <> cur then
        raise exception '% is not on the layer this issue draws from', sn;
    end if;
    if exists (
        select 1 from stock_serial_issue si
         where si.serial_id = new.serial_id
           and coalesce(si.lot_id, cur) = cur
           and fn_serial_issue_stands(si.stock_movement_id)
    ) then
        raise exception '% has already gone out', sn;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_stock_serial_issue_guard on stock_serial_issue;
create trigger trg_stock_serial_issue_guard
    before insert on stock_serial_issue
    for each row execute function fn_stock_serial_issue_guard();

-- ------------------------------------------------------------- history ----

create table if not exists stock_serial_event (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id),
    serial_id        uuid not null references stock_serial(id),
    event            text not null check (event in (
                       'RECEIVED', 'SOLD', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN',
                       'TRANSFER', 'RESTORED', 'WRITTEN_OFF', 'HOLD', 'RELEASE')),
    document_id      uuid references document(id),
    from_location_id uuid references location(id),
    to_location_id   uuid references location(id),
    lot_id           uuid references stock_lot(id),
    note             text,
    acted_by         uuid references app_user(id),
    created_at       timestamptz not null default now()
);

create index if not exists stock_serial_event_serial_idx
    on stock_serial_event (serial_id, created_at);

-- --------------------------------------------------------------- holds ----
--
-- RESERVED and REPAIR move no stock, so they cannot be derived from
-- movements. One open hold per unit; released, never deleted. A repair
-- module would hang its ticket off document_id here.

create table if not exists stock_serial_hold (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    serial_id    uuid not null references stock_serial(id),
    kind         text not null check (kind in ('RESERVED', 'REPAIR')),
    note         text,
    partner_id   uuid references business_partner(id),
    document_id  uuid references document(id),
    created_by   uuid references app_user(id),
    created_at   timestamptz not null default now(),
    released_by  uuid references app_user(id),
    released_at  timestamptz
);

create unique index if not exists stock_serial_hold_open_idx
    on stock_serial_hold (serial_id) where released_at is null;

-- --------------------------------------------------------------- views ----

create or replace view v_stock_serial_available as
select s.company_id,
       s.id as serial_id,
       s.serial_no,
       s.item_id,
       i.code as item_code,
       i.name as item_name,
       l.location_id,
       s.stock_lot_id,
       l.unit_cost,
       d.doc_no as received_on,
       d.id     as received_document_id
  from stock_serial s
  join item i on i.id = s.item_id
  join stock_lot l on l.id = s.stock_lot_id
  join stock_movement sm on sm.id = s.stock_movement_id
  left join document d on d.id = sm.document_id
 where not exists (
         select 1 from stock_serial_issue si
          where si.serial_id = s.id
            and coalesce(si.lot_id, s.stock_lot_id) = s.stock_lot_id
            and fn_serial_issue_stands(si.stock_movement_id))
   and not exists (
         select 1 from stock_serial_hold h
          where h.serial_id = s.id and h.released_at is null);

-- Every unit, with one status derived from what happened to it.
create or replace view v_stock_serial as
select s.company_id,
       s.id               as serial_id,
       s.serial_no        as imei,
       s.imei2,
       s.device_serial,
       s.notes,
       s.item_id,
       i.code             as item_code,
       i.name             as item_name,
       i.parent_item_id,
       coalesce(p.name, i.name) as model_name,
       b.name             as brand_name,
       i.barcode,
       l.location_id,
       loc.name           as location_name,
       s.stock_lot_id,
       l.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a
                                where a.lot_id = l.id), 0) as unit_cost,
       rd.id              as received_document_id,
       rd.doc_no          as received_on,
       rd.posting_date    as received_date,
       rd.partner_id      as supplier_id,
       sup.name           as supplier_name,
       coalesce(s.supplier_warranty_months, i.supplier_warranty_months) as supplier_warranty_months,
       out_.document_id   as out_document_id,
       out_.doc_no        as out_doc_no,
       out_.doc_type      as out_doc_type,
       out_.posting_date  as out_date,
       out_.partner_id    as customer_id,
       cust.name          as customer_name,
       out_.warranty_months,
       case when out_.warranty_months is not null
            then (out_.posting_date + make_interval(months => out_.warranty_months))::date
       end                as warranty_expiry,
       h.kind             as hold_kind,
       case
         when out_.document_id is not null then
           case out_.doc_type
             when 'SALES_INVOICE'    then 'SOLD'
             when 'DELIVERY'         then 'SOLD'
             when 'PURCHASE_RETURN'  then 'RETURNED_TO_SUPPLIER'
             when 'STOCK_ADJUSTMENT' then 'WRITTEN_OFF'
             else 'ISSUED'
           end
         when h.kind is not null then h.kind
         else 'IN_STOCK'
       end                as status,
       exists (select 1 from stock_serial_event e
                where e.serial_id = s.id and e.event = 'CUSTOMER_RETURN') as was_returned,
       exists (select 1 from stock_serial_event e
                where e.serial_id = s.id and e.event = 'TRANSFER')        as was_transferred,
       s.created_at
  from stock_serial s
  join item i on i.id = s.item_id
  left join item p on p.id = i.parent_item_id
  left join brand b on b.id = coalesce(p.brand_id, i.brand_id)
  join stock_lot l on l.id = s.stock_lot_id
  left join location loc on loc.id = l.location_id
  join stock_movement rsm on rsm.id = s.stock_movement_id
  left join document rd on rd.id = rsm.document_id
  left join business_partner sup on sup.id = rd.partner_id
  left join lateral (
        select d.id as document_id, d.doc_no, d.doc_type, d.posting_date, d.partner_id,
               dl.warranty_months
          from stock_serial_issue si
          join stock_movement sm on sm.id = si.stock_movement_id
          join document d on d.id = sm.document_id
          left join document_line dl on dl.id = sm.document_line_id
         where si.serial_id = s.id
           and coalesce(si.lot_id, s.stock_lot_id) = s.stock_lot_id
           and fn_serial_issue_stands(si.stock_movement_id)
         order by si.created_at desc
         limit 1
  ) out_ on true
  left join business_partner cust on cust.id = out_.partner_id
  left join stock_serial_hold h on h.serial_id = s.id and h.released_at is null;

comment on view v_stock_serial is
    'Every serial-tracked unit with a derived status: IN_STOCK, RESERVED, '
    'REPAIR, SOLD, RETURNED_TO_SUPPLIER, WRITTEN_OFF. Location and cost are '
    'the layer it is on now.';
