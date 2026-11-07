-- An invoice raised before its goods leave books their cost with the sale.
--
-- Delivery first already worked: the delivery parks the cost in 14303 and
-- the invoice moves it to cost of sales. The other way round recognised the
-- sale on the invoice and the cost on the delivery, so an invoice on the
-- 31st and a delivery on the 2nd put a 100% margin in one month and a loss
-- in the next.
--
-- Now a deliver-later invoice debits cost of sales and credits 14303 at the
-- FIFO cost of the goods still to go (an estimate: nothing leaves yet). Each
-- delivery against it debits 14303 by its share of that estimate, and any
-- difference between estimate and the cost the goods actually left at goes
-- to cost of sales on the delivery. 14303 therefore reads both ways: a debit
-- balance is goods delivered and not invoiced, a credit balance goods
-- invoiced and not delivered.
--
-- One row per booking (the invoice, positive) and per release (each
-- delivery, negative), never updated: what is still booked ahead is the sum
-- over posted documents, so a voided invoice drops out with its entry.

create table if not exists sales_cost_booked (
    id               uuid primary key default gen_random_uuid(),
    company_id       uuid not null references company(id),
    invoice_line_id  uuid not null references document_line(id),
    -- The invoice that booked it, or the delivery that released part of it.
    document_id      uuid not null references document(id),
    qty              numeric(18,4) not null check (qty <> 0),
    amount           numeric(18,4) not null,
    created_at       timestamptz not null default now()
);

create index if not exists sales_cost_booked_line on sales_cost_booked (invoice_line_id);
create index if not exists sales_cost_booked_document on sales_cost_booked (document_id);

-- What each invoice line still has booked ahead of its goods.
create or replace view v_invoice_cost_booked_ahead as
select b.company_id, b.invoice_line_id, inv.id as invoice_id, inv.doc_no,
       inv.posting_date, inv.location_id, inv.partner_id, il.item_id,
       sum(b.qty) as qty_ahead, sum(b.amount) as value_ahead
  from sales_cost_booked b
  join document d on d.id = b.document_id and d.status = 'POSTED'
  join document_line il on il.id = b.invoice_line_id
  join document inv on inv.id = il.document_id and inv.status = 'POSTED'
 group by 1, 2, 3, 4, 5, 6, 7, 8
having sum(b.amount) <> 0 or sum(b.qty) <> 0;
