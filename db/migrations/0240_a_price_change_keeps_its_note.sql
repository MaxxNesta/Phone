-- A price change keeps its note (2026-11-28).
--
-- Prices are raised and lowered many at once ("Change prices" on the price
-- list: +10,000 or 1% at the levels and units chosen), and the owner wants to
-- see later why they moved — "November price rise", "supplier cut". The note
-- sits on each dated price the change wrote; one typed by hand on a single
-- price works the same way. Empty means none was given.
alter table item_price add column if not exists note text;
