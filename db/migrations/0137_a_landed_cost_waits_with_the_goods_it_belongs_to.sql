-- A landed cost waits with the goods it belongs to
--
-- Cost of sales is recognised when the sales invoice posts (D8). Goods that
-- have left on a delivery but not been invoiced carry their cost in 1090
-- Goods Shipped Not Invoiced. A landed cost on such a phone therefore belongs
-- in 1090 too, not in cost of sales: putting it there early would move profit
-- into a period the sale has not reached. Wherever a phone's own cost sits —
-- inventory, 1090 or cost of sales — its landed cost sits with it, and moves
-- when it moves.
--
-- Three changes make that true.
--
-- 1. landed_cost_posting records a third treatment, HOLDING: the amount went
--    to 1090 because the phone was delivered and not yet invoiced.
--
-- 2. A claim records the landed cost it carried from 1090 to cost of sales,
--    so voiding that invoice can tell what its own entry moved from what was
--    added to cost of sales after it (a landed cost posted once the phone was
--    invoiced). Both go back to 1090 with the void.
--
-- 3. A customer return of goods delivered and never invoiced takes their cost
--    — landed cost included — out of 1090, not out of cost of sales, which
--    never had it. delivery_cost_return records what each return took, so the
--    goods stop waiting for an invoice that will not come, and
--    v_delivery_cost_unclaimed (the figure 1090 must equal) counts them out.
--    It also counts in the landed cost still waiting there.

alter table landed_cost_posting drop constraint if exists landed_cost_posting_treatment_check;
alter table landed_cost_posting add constraint landed_cost_posting_treatment_check
    check (treatment in ('INVENTORY', 'HOLDING', 'COGS'));

alter table sales_cost_allocation add column if not exists landed_amount numeric(18,4) not null default 0;
comment on column sales_cost_allocation.landed_amount is
    'Landed cost this claim moved from 1090 to cost of sales with the goods, '
    'negated on the row that releases it.';

create table if not exists delivery_cost_return (
    id                 uuid primary key default gen_random_uuid(),
    company_id         uuid not null references company(id),
    consumption_id     uuid not null references stock_lot_consumption(id),
    return_line_id     uuid not null references document_line(id),
    return_document_id uuid not null references document(id),
    qty                numeric(18,4) not null check (qty > 0),
    unit_cost          numeric(18,4) not null,
    landed_amount      numeric(18,4) not null default 0,
    created_at         timestamptz not null default now()
);
create index if not exists delivery_cost_return_consumption_idx on delivery_cost_return (consumption_id);

create or replace view v_delivery_cost_unclaimed as
with base as (
    select c.id as consumption_id,
           c.company_id,
           c.stock_movement_id,
           sm.document_id,
           sm.document_line_id,
           sm.item_id,
           d.doc_no,
           d.posting_date,
           d.location_id,
           d.partner_id,
           c.unit_cost,
           c.qty as qty_delivered,
           c.qty
             - coalesce((select sum(a.qty) from sales_cost_allocation a where a.consumption_id = c.id), 0)
             -- A return counts while the return stands.
             - coalesce((select sum(x.qty) from delivery_cost_return x
                           join document rd on rd.id = x.return_document_id
                          where x.consumption_id = c.id and rd.status = 'POSTED'
                            and rd.reverses_document_id is null), 0) as qty_unclaimed,
           coalesce((select sum(p.amount) from landed_cost_posting p where p.consumption_id = c.id), 0) as landed
      from stock_lot_consumption c
      join stock_movement sm on sm.id = c.stock_movement_id
      join document_line dl on dl.id = sm.document_line_id
      join document d on d.id = dl.document_id
     where d.doc_type = 'DELIVERY'
       and d.status = 'POSTED'
       and dl.foc_reason_id is null
       and coalesce(dl.is_consignment, false) = false
)
select consumption_id, company_id, stock_movement_id, document_id, document_line_id, item_id,
       doc_no, posting_date, location_id, partner_id, unit_cost, qty_delivered, qty_unclaimed,
       qty_unclaimed * unit_cost + landed * qty_unclaimed / qty_delivered as value_unclaimed,
       landed * qty_unclaimed / qty_delivered as landed_unclaimed
  from base
 where qty_unclaimed > 0.0001;

comment on view v_delivery_cost_unclaimed is
  'Delivered cost no sales invoice has claimed and no return has taken back: posted deliveries only, excluding free-of-charge and consignment lines, with any landed cost put on those goods while they wait. What account 1090 must equal — see docs/03-decisions.md D8.';
