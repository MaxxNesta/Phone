-- A fault found after the receipt was posted (docs/06 D-P7).
--
-- A phone refused at the door is a receipt line of its own (0219). One that
-- passed the door and failed the next day's test cannot be: the receipt is
-- posted and its lines do not change. So the finding is written down beside
-- it — which receipt line the unit came in on, what is wrong, whether the
-- supplier replaces or credits it, and the transfer that took it into the
-- warehouse's quarantine bin (0218). From there it goes back exactly as a
-- unit refused at the door does.

create table if not exists fault_report (
    id                    uuid primary key default gen_random_uuid(),
    company_id            uuid not null references company(id),
    receipt_line_id       uuid not null references document_line(id),
    serial_id             uuid references stock_serial(id),
    qty                   numeric(18,4) not null check (qty > 0),
    reason                text not null check (length(trim(reason)) > 0),
    outcome               text not null check (outcome in ('REPLACE', 'CREDIT')),
    bin_location_id       uuid not null references location(id),
    transfer_document_id  uuid not null references document(id),
    created_by            uuid references app_user(id),
    created_at            timestamptz not null default now()
);

create index if not exists fault_report_line on fault_report (receipt_line_id);
create unique index if not exists fault_report_one_per_unit
    on fault_report (serial_id) where serial_id is not null;

comment on table fault_report is
    'A fault found after its receipt was posted: the unit, its receipt line, what is wrong, '
    'replace or credit, and the transfer into quarantine.';

-- A return line that sends a unit back for replacement says so, whether the
-- unit was refused at the door or found faulty later, and the order it was
-- ordered on expects it again.
alter table document_line add column if not exists for_replacement boolean not null default false;

comment on column document_line.for_replacement is
    'Purchase return: this line goes back for replacement, so its order expects it again (0224).';

update document_line retl set for_replacement = true
  from document_line rl
 where rl.id = retl.source_line_id and rl.reject_outcome = 'REPLACE'
   and exists (select 1 from document d where d.id = retl.document_id and d.doc_type = 'PURCHASE_RETURN');

create or replace view v_order_outstanding as
with ord as (
    select o.company_id,
           o.id        as order_id,
           o.doc_type,
           o.due_date,
           ol.id       as order_line_id,
           ol.item_id,
           ol.base_qty as ordered
      from document o
      join document_line ol on ol.document_id = o.id
     where o.doc_type in ('PURCHASE_ORDER', 'SALES_ORDER')
       and o.status = 'POSTED'
),
-- Every fulfilment of every order line, each line appearing once.
done as (
    -- Linked: authoritative, because it can be partial.
    select fn_current_document(ol.document_id) as order_id,
           ol.item_id,
           fl.fulfilment_line_id,
           fl.qty
      from fulfilment_link fl
      join document_line ol on ol.id = fl.order_line_id
      join document_line dl on dl.id = fl.fulfilment_line_id
      join document dd on dd.id = dl.document_id
     where dd.status = 'POSTED'

    union all

    -- Named on the line, and only where no link already speaks for it.
    select fn_current_document(coalesce(ol.document_id, dd.source_document_id)) as order_id,
           dl.item_id,
           dl.id,
           dl.base_qty
      from document_line dl
      join document dd on dd.id = dl.document_id
      left join document_line ol on ol.id = dl.source_line_id
     where dd.doc_type in ('GOODS_RECEIPT', 'DELIVERY')
       and dd.status = 'POSTED'
       and coalesce(ol.document_id, dd.source_document_id) is not null
       and not exists (
             select 1 from fulfilment_link fl2
              where fl2.fulfilment_line_id = dl.id
                and fl2.order_line_id is not distinct from dl.source_line_id)

    union all

    -- A unit sent back for replacement (0220, 0224): the order expects it
    -- again — refused at the door or found faulty later, the return line
    -- says so. It names the receipt line the unit came in on, which answered
    -- an order line by name or by link. A credit is not here.
    select fn_current_document(ol.document_id) as order_id,
           rl.item_id,
           retl.id,
           -retl.base_qty
      from document_line retl
      join document rd on rd.id = retl.document_id
      join document_line rl on rl.id = retl.source_line_id
      join document_line ol on ol.id = coalesce(
             (select fl3.order_line_id from fulfilment_link fl3
               where fl3.fulfilment_line_id = rl.id limit 1),
             rl.source_line_id)
      join document o on o.id = ol.document_id
     where rd.doc_type = 'PURCHASE_RETURN'
       and rd.status = 'POSTED'
       and rd.reverses_document_id is null
       and retl.for_replacement
       and o.doc_type = 'PURCHASE_ORDER'
),
fulfilled as (
    select order_id, item_id, sum(qty) as qty
      from done
     group by order_id, item_id
),
closed as (
    select distinct on (c.order_id) c.order_id, c.is_open
      from (
        select fn_current_document(oc.document_id) as order_id,
               oc.is_open, oc.closed_at
          from order_closure oc
      ) c
     order by c.order_id, c.closed_at desc
)
select ord.order_id,
       ord.company_id,
       ord.doc_type,
       ord.due_date,
       ord.item_id,
       sum(ord.ordered) as ordered,
       least(sum(ord.ordered), coalesce(max(fulfilled.qty), 0)) as fulfilled,
       case
         when coalesce(bool_and(coalesce(closed.is_open, true)), true)
           then greatest(sum(ord.ordered) - coalesce(max(fulfilled.qty), 0), 0)
         else 0
       end as outstanding,
       bool_or(coalesce(closed.order_id is not null and not closed.is_open, false)) as is_closed
  from ord
  left join fulfilled on fulfilled.order_id = ord.order_id
                     and fulfilled.item_id = ord.item_id
  left join closed on closed.order_id = ord.order_id
 group by ord.order_id, ord.company_id, ord.doc_type, ord.due_date, ord.item_id;

