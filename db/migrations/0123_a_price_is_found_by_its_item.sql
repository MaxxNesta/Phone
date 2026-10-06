-- A price is found by its item.
--
-- The retail price shown beside every unit on the IMEI list, and on the till,
-- is looked up per row: the newest price at or before today, for this item,
-- on the RETAIL level. item_price's only index leads with company_id, which
-- that lookup does not filter on, so each row would scan the table. Index
-- only: nothing reads or writes differently.

create index if not exists item_price_item_level_from_idx
    on item_price (item_id, price_level_id, valid_from desc);
