-- A voided goods receipt takes its handsets off the shelf.
--
-- An issue made by a reversal never counted (fn_serial_issue_stands): that is
-- what puts a phone back when a sale is voided. The reversal of a goods
-- receipt is the other way round — it takes the received units away — and
-- the void now records their issue (lib/posting.ts). That issue has to
-- count, or a voided receipt's IMEIs stay on sale with no stock behind them.
create or replace function fn_serial_issue_stands(p_movement uuid)
returns boolean language sql stable as $$
    select coalesce((
        select case
                 when d.reverses_document_id is not null
                   then (select o.doc_type from document o where o.id = d.reverses_document_id) = 'GOODS_RECEIPT'
                 else d.status <> 'REVERSED'
               end
          from stock_movement sm
          join document d on d.id = sm.document_id
         where sm.id = p_movement), true);
$$;
