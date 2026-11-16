-- A supplier's discount lowers what the goods cost (IAS 2.11), and free units
-- share the cost of the ones paid for.
--
-- Until now the engine posted only the GROSS method: stock at the price before
-- the discount, the discount credited to Purchase Discounts. The owner chose
-- the NET method (2026-11-16): the discount comes off the FIFO cost of the
-- phones, so it reaches profit as each phone is sold rather than the day the
-- bill is posted. Bills already posted under GROSS keep their postings; the
-- policy decides only what is posted from now on.
--
-- stock_cost is what a purchase invoice line puts on stock: its net under
-- NET (gross under GROSS), plus its share of any free units on the same bill.
-- Ten phones bought for 10,000,000 with one free is eleven phones that cost
-- 10,000,000, so the free line carries 909,090.91 and the paid line the rest.
-- A receipt posted after its bill is valued from it, and a later supplier
-- discount is spread by it. Null on lines posted before this, which were all
-- GROSS — readers fall back to net plus the discounts for those.

alter table document_line add column if not exists stock_cost numeric(18,4);
comment on column document_line.stock_cost is
  'Purchase invoice line: what it puts on stock — net or gross of the supplier discount by company policy, plus its share of free units. Null before 0204.';

alter table company alter column purchase_discount_policy set default 'NET';
update company set purchase_discount_policy = 'NET' where purchase_discount_policy = 'GROSS';
