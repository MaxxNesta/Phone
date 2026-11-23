-- A delivery charge is earned when the goods go, as the sale is (0191).
--
-- An invoice raised "deliver later" held the price of its goods in Billed Not
-- Delivered (2230) until the delivery, but credited its delivery charge to
-- Delivery Income at once, before anything had been carried. From here the
-- charge waits in 2230 with the goods and the first delivery against the
-- invoice releases it to Delivery Income:
--
--   invoice   Dr Receivable / Cr 2230 (goods and charge)
--   delivery  Dr 2230 / Cr Sales, and Dr 2230 / Cr Delivery Income (charge)
--
-- One row per document, as sales_revenue_deferred keeps it: positive from the
-- invoice, negative from the delivery that released it. Only rows whose
-- document still stands count, so voiding the delivery holds the charge again
-- without anyone editing this table. Invoices posted before this keep the
-- charge where it was.

create table if not exists sales_fee_deferred (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    invoice_id   uuid not null references document(id),
    document_id  uuid not null references document(id),
    amount       numeric(18,4) not null,
    created_at   timestamptz not null default now()
);
create index if not exists sales_fee_deferred_invoice on sales_fee_deferred (invoice_id);
