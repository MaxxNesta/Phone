-- 0019_event_time.sql
-- When things actually happened, and in which timezone to say so.
--
-- Business dates stay dates. posting_date decides which fiscal period a
-- transaction belongs to, and the period-lock trigger compares it against
-- period boundaries; making it a timestamp would mean a sale at 00:30 in
-- Yangon on the 1st is 18:00 UTC on the 30th, and lands in last month.
-- Accounting dates are dates on purpose.
--
-- What was missing is the event time alongside them: the moment stock
-- physically moved, as distinct from the day it is booked to.

alter table company
    add column timezone text not null default 'Asia/Yangon';

comment on column company.timezone is
    'IANA zone used to render timestamps. Myanmar is UTC+06:30, an offset '
    'that is easy to get wrong, and the server runs in UTC — without this '
    'anything happening before 06:30 local displays as the previous day.';

-- When the goods moved. movement_date remains the accounting date.
alter table stock_movement
    add column occurred_at timestamptz;

-- Backfilling trips trg_stock_movement_immutable, which refuses any UPDATE.
-- That guard exists to stop the application rewriting history, and a schema
-- migration adding a column is the one controlled case it should yield to.
-- Disabled for this statement only, inside the migration's transaction.
alter table stock_movement disable trigger trg_stock_movement_immutable;

update stock_movement set occurred_at = created_at where occurred_at is null;

alter table stock_movement enable trigger trg_stock_movement_immutable;

alter table stock_movement
    alter column occurred_at set not null,
    alter column occurred_at set default now();

comment on column stock_movement.occurred_at is
    'The moment the movement was recorded. movement_date is the accounting '
    'date it is booked to; these differ whenever stock is entered late.';

create index on stock_movement (company_id, occurred_at);

-- Movements with both the accounting date and the moment they happened,
-- which is what a stock card needs to read in true order.
create or replace view v_stock_movement_detail as
select
    sm.id,
    sm.company_id,
    sm.item_id,
    i.code             as item_code,
    i.name             as item_name,
    sm.location_id,
    l.code             as location_code,
    sm.movement_date,
    sm.occurred_at,
    sm.qty,
    sm.unit_cost,
    sm.total_cost,
    sm.batch_no,
    sm.expiry_date,
    d.id               as document_id,
    d.doc_no,
    d.doc_type,
    p.name             as partner_name,
    sum(sm.qty) over (
        partition by sm.company_id, sm.item_id, sm.location_id
        order by sm.movement_date, sm.occurred_at, sm.id
        rows between unbounded preceding and current row
    ) as running_qty
  from stock_movement sm
  join item i on i.id = sm.item_id
  join location l on l.id = sm.location_id
  left join document d on d.id = sm.document_id
  left join business_partner p on p.id = d.partner_id;

comment on view v_stock_movement_detail is
    'Stock card: every movement in true order with a running quantity. '
    'Ordered by accounting date then event time, so several movements on one '
    'day still read in the sequence they were actually recorded.';
