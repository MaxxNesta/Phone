-- A sale is earned when the goods go.
--
-- An invoice raised before its goods leave ("deliver later") used to count
-- the sale at once: Cr Sales on the invoice, and the cost booked ahead against
-- 14303 at an estimate (0178). The goods were still on the shelf, so the
-- income statement showed a sale that had not happened yet.
--
-- From here the price waits in a liability until the goods leave:
--
--   invoice   Dr Receivable / Cr 21303 Billed Not Delivered / Cr Output tax
--   delivery  Dr 21303 / Cr Sales (and Dr Sales Discounts for its share)
--             Dr Cost of sales / Cr Inventory at the actual FIFO cost
--
-- Each delivery releases its share by quantity; the one that completes a line
-- releases whatever is left, so rounding never leaves a crumb. Tax stays at
-- the invoice: it is due when the customer is billed. Services on such an
-- invoice are earned at once, as nothing is delivered for them.
--
-- sales_revenue_deferred is the running account per invoice line: a positive
-- row from the invoice, a negative row from each delivery that released some.
-- A row belongs to a document, and only rows whose document still stands are
-- counted, so a voided delivery gives its release back without anyone
-- touching this table. Invoices posted before this keep their 0178 path.

insert into account (company_id, code, name, account_type, is_postable, parent_id)
select c.id, '21303', 'Billed Not Delivered (Unearned Revenue)', 'LIABILITY', true,
       coalesce(
         (select a.id from account a where a.company_id = c.id and a.code = '213'),
         (select a.id from account a
           where a.company_id = c.id and a.account_type = 'LIABILITY' and a.is_postable = false
           order by a.code limit 1))
  from company c
 where not exists (select 1 from account a where a.company_id = c.id and a.code = '21303');

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED']));

insert into system_account (company_id, role, account_id)
select a.company_id, 'BILLED_NOT_DELIVERED', a.id
  from account a
 where a.code = '21303'
   and not exists (select 1 from system_account s
                    where s.company_id = a.company_id and s.role = 'BILLED_NOT_DELIVERED');

create table if not exists sales_revenue_deferred (
    id              uuid primary key default gen_random_uuid(),
    company_id      uuid not null references company(id),
    invoice_line_id uuid not null references document_line(id),
    -- The invoice that deferred it (positive) or the delivery that released it (negative).
    document_id     uuid not null references document(id),
    qty             numeric(18,4) not null,
    -- Ex-tax, after discount: what sits in 21303 for this line.
    net             numeric(18,4) not null,
    -- The discount behind it, so Sales and Sales Discounts are recognised apart.
    discount        numeric(18,4) not null default 0,
    -- The revenue and discount accounts it is released to, fixed at the invoice.
    revenue_account_id  uuid not null references account(id),
    created_at      timestamptz not null default now()
);
create index if not exists sales_revenue_deferred_line on sales_revenue_deferred (invoice_line_id);
create index if not exists sales_revenue_deferred_document on sales_revenue_deferred (document_id);

comment on table sales_revenue_deferred is
  'Revenue on a deliver-later invoice held in 21303 until delivery: + from the invoice, - per delivery. Only rows of standing (POSTED) documents count.';
