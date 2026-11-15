-- A retail shop can sell a service.
--
-- 0124 forced every retail item to be stocked: a phone shop then sold only
-- what sat on a shelf. Shops also charge for work — an Error Fee for fixing a
-- software fault, a screen wipe — which has no stock. Such an item is now
-- allowed: it is sold on the till and on invoices, posts revenue only (no
-- inventory, no cost of sales; lib/posting.ts issues stock for stocked items
-- alone), and its category decides the income account (account_determination,
-- e.g. Services & Charges → Other Incomes).
drop trigger if exists item_retail_stocked on item;
drop function if exists fn_item_retail_stocked();
