-- A refused unit sent back for replacement reopens its order (docs/06 D-P7).
--
-- Ten ordered, ten arrive, one broken and marked "the supplier replaces it"
-- (0219). The order reads ten of ten received, which is true. When that unit
-- goes back on a purchase return, the order expects one again, so the
-- replacement is received against it like any other delivery, and the order
-- reads ten of ten once more when it arrives. A unit refused for credit does
-- not reopen anything: the order is finished with it.
--
-- A return line now names the receipt line it sends back (source_line_id,
-- written by lib/posting.ts), which is how this finds them. Voided returns
-- stop counting with their status.

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

    -- A refused unit sent back for replacement (0220): the order expects it
    -- again. The return names the receipt line it sends back; that line was
    -- marked REPLACE when it was refused, and answered an order line by name
    -- or by link. A credit is not here: the order is done with that unit.
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
       and rl.reject_outcome = 'REPLACE'
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

