-- A free item given with a sale earns its share of the sale (IFRS 15).
--
-- A phone sold for 1,000 with a free case is one contract for two things.
-- The customer paid 1,000 for both, so revenue is allocated by what each
-- sells for on its own (its standalone selling price, the price list): a
-- 1,000 phone and a 50 case share 1,000 as 952.38 and 47.62. Total revenue
-- does not move; what moves is which product earned it, so the case's
-- margin is no longer a cost with nothing beside it.
--
-- revenue_amount is that allocated revenue, ex-tax, on each line of such an
-- invoice. The line's net_amount stays what the customer was charged for it
-- (the free case is still 0 on the printed invoice). Null on every other
-- line: product reports read coalesce(revenue_amount, net_amount).

alter table document_line add column if not exists revenue_amount numeric(18,4);
comment on column document_line.revenue_amount is
  'Sales invoice line with free items: revenue allocated by standalone selling price (IFRS 15), ex-tax. Null when no allocation applies.';
