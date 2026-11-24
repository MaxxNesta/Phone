-- A removed price keeps its history (2026-11-24).
--
-- "Remove price" used to delete every price a unit ever had at that level,
-- so last month's 10,000 vanished with it. Now it adds one more dated row
-- with no price: from that day the unit has no price at the level, and every
-- earlier price stays where it was. A price set again later is the next row.
alter table item_price alter column price drop not null;
comment on column item_price.price is
  'The price from valid_from. Null: no price from that day (removed); the rows before it stay as history (0237).';
