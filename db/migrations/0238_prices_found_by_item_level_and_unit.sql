-- Prices are looked up by product, level and unit (0236): the index carries the unit too.
--
-- Every reader now asks for one unit's latest price at a level (the till, the
-- price guard, the invoice, the price list, v_item_pack). The old index
-- (item_id, price_level_id, valid_from) had to read every unit's rows to find
-- one; this one goes straight to it. The price list counts prices per level,
-- so price_level_id gets one of its own.
drop index if exists item_price_item_level_from_idx;
create index if not exists ix_item_price_item_level_unit_from
    on item_price (item_id, price_level_id, uom_id, valid_from desc);
create index if not exists ix_item_price_level on item_price (price_level_id);
