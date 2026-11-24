-- Pack prices join the price list (2026-11-24).
--
-- A box and a pack each have a price at every price level, and a price that
-- changes is a new dated row, never an edit: last month's 10,000 stays
-- 10,000 beside this month's 12,000. item_price always had the unit for
-- this (item, level, unit, valid_from); until now only the stock unit used
-- it, and a pack carried one undated price of its own (item_uom.sale_price,
-- 0213) at no level, overwritten in place.
--
-- From here item_price is the only place a selling price lives. A pack's
-- price at the default level is what the product page shows as "Sells at";
-- other levels are set on the price list.

-- The level a product's own price is written to: Retail in a retail shop,
-- else the first by sort order. The same rule the product form has always
-- written the stock-unit price with (lib/actions.ts createItem).
create or replace function fn_default_price_level(p_company uuid) returns uuid
language sql stable as $$
    select l.id from price_level l
     where l.company_id = p_company
     order by (l.code = 'RETAIL' and (select c.retail_mode from company c where c.id = p_company)) desc,
              l.sort_order, l.code
     limit 1
$$;

-- Every pack price so far becomes that pack's price at the default level,
-- from today. Nothing is lost: the column stays, no longer written or read.
insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price, valid_from)
select iu.company_id, iu.item_id, fn_default_price_level(iu.company_id), iu.uom_id, 'MMK', iu.sale_price, fn_shop_today()
  from item_uom iu
 where iu.sale_price is not null
   and fn_default_price_level(iu.company_id) is not null
   and not exists (select 1 from item_price x where x.item_id = iu.item_id and x.uom_id = iu.uom_id)
on conflict do nothing;

comment on column item_uom.sale_price is
  'Retired 0236: a pack''s price is in item_price (per level, dated). Kept so nothing is lost; not written or read.';

-- The packs a product is bought and sold in, each with its price today at
-- the default level (other levels: item_price itself).
create or replace view v_item_pack as
with r as (
    select id, company_id, coalesce(ref_uom_id, id) as root, coalesce(ref_qty, 1) as q
      from uom where is_active
)
select iu.company_id, iu.item_id, iu.uom_id, iu.factor::numeric as factor,
       (select ip.price from item_price ip
         where ip.item_id = iu.item_id and ip.uom_id = iu.uom_id
           and ip.price_level_id = fn_default_price_level(iu.company_id)
           and ip.valid_from <= fn_shop_today()
         order by ip.valid_from desc limit 1)::numeric as sale_price,
       iu.barcode, false as standard
  from item_uom iu
union all
select i.company_id, i.id, u.id, round(u.q / b.q, 6), null::numeric, null::text, true
  from item i
  join r b on b.id = i.base_uom_id
  join r u on u.root = b.root and u.id <> b.id and u.company_id = i.company_id
 where not exists (select 1 from item_uom x where x.item_id = i.id and x.uom_id = u.id);
