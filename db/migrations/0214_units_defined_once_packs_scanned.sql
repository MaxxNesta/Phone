-- Units defined once, packs scanned, a buying unit, and whole units (Odoo 20's model).
--
-- A measurement is a fact about the unit, not the product: 1 FT = 0.3048 M
-- for every hose and cable. A unit may name a reference unit and how much of
-- it one of this unit is; any product counted in a unit of the same family
-- can then be bought or sold in the others with no setup. One level only: a
-- reference unit has no reference of its own (the app enforces it).
--
-- A pack stays the product's own (item_uom): a box of screws is not a box of
-- nails. A pack may carry its own barcode, so scanning the box adds a box.
alter table uom add column if not exists ref_uom_id uuid references uom(id);
alter table uom add column if not exists ref_qty numeric(18,6);
alter table uom drop constraint if exists uom_ref_pair;
alter table uom add constraint uom_ref_pair check ((ref_uom_id is null) = (ref_qty is null) and (ref_qty is null or ref_qty > 0));
alter table uom drop constraint if exists uom_ref_not_self;
alter table uom add constraint uom_ref_not_self check (ref_uom_id is distinct from id);
comment on column uom.ref_qty is 'One of this unit is ref_qty of ref_uom_id: FT is 0.3048 M. Null for a unit that is a reference or stands alone.';

-- Pieces, boxes and brake pads come whole; litres and metres do not.
alter table uom add column if not exists whole_numbers boolean not null default false;
comment on column uom.whole_numbers is 'Quantities in this unit must be whole: no 2.5 PCS. Enforced on every document line.';

alter table item_uom add column if not exists barcode text;
create unique index if not exists ux_item_uom_barcode on item_uom (company_id, barcode) where barcode is not null;

-- The unit a product is usually bought in (oil by the DRUM); purchase lines start in it.
alter table item add column if not exists purchase_uom_id uuid references uom(id);

/* Every unit a product can be bought or sold in, other than its own:
   its packs, and the units of its base unit's family (standard = true).
   A pack defined on the product wins over the family's unit of the same code. */
create or replace view v_item_pack as
with r as (
    select id, company_id, coalesce(ref_uom_id, id) as root, coalesce(ref_qty, 1) as q
      from uom where is_active
)
select iu.company_id, iu.item_id, iu.uom_id, iu.factor::numeric as factor, iu.sale_price, iu.barcode, false as standard
  from item_uom iu
union all
select i.company_id, i.id, u.id, round(u.q / b.q, 6), null::numeric, null::text, true
  from item i
  join r b on b.id = i.base_uom_id
  join r u on u.root = b.root and u.id <> b.id and u.company_id = i.company_id
 where not exists (select 1 from item_uom x where x.item_id = i.id and x.uom_id = u.id);

-- Whole units stay whole on every document, however the line was made.
create or replace function fn_document_line_whole_units() returns trigger
language plpgsql as $$
declare v_code text;
begin
    if new.entered_qty is not null and new.entered_qty <> trunc(new.entered_qty) then
        select code into v_code from uom where id = new.entered_uom_id and whole_numbers;
        if v_code is not null then
            raise exception '% is counted in whole units only: % cannot be split.', v_code, trim_scale(new.entered_qty)
                using errcode = 'P0001';
        end if;
    end if;
    return new;
end;
$$;
drop trigger if exists trg_document_line_whole_units on document_line;
create trigger trg_document_line_whole_units before insert on document_line
    for each row execute function fn_document_line_whole_units();
