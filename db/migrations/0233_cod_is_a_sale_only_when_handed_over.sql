-- Cash on delivery is a sale only when the parcel is handed over and paid.
--
-- A customer may refuse a COD parcel, and owes nothing until they accept it.
-- So a COD invoice (ar_on_handover) posts nothing when it is raised: no
-- receivable, no sale, no cost. Its stock lines are recorded as held
-- (sales_revenue_deferred, sales_fee_deferred), as a deliver-later invoice's
-- are, but nothing reaches the ledger.
--
--   dispatch    the phone moves from the warehouse to its "Out for delivery"
--               bin: still company stock at its cost, not for sale, and the
--               same IMEI on the same layer cost (a stock transfer naming the
--               invoice, the driver or courier carrying it).
--   handover    paid at the door: a delivery from the bin issues the phone at
--               its cost to cost of sales and bills the customer for what was
--               handed over (Dr Receivable / Cr Sales, Delivery Income, tax),
--               and the receipt clears it into whoever holds the money now:
--               Cash with Drivers, a verified bank or wallet, or COD
--               Receivable under the courier.
--   refused     the parcel comes back: a transfer from the bin to the
--               warehouse once the same IMEI is scanned in. Nothing to undo.
--
-- What the customer owes on a COD invoice is what was handed over
-- (sales_billed_on_handover), never the invoice total, so a parcel still out
-- is in no receivable and no aging bucket.

-- 1. The Out for delivery bin, one per warehouse.
alter table location add column if not exists is_transit boolean not null default false;
comment on column location.is_transit is
    'A bin inside a warehouse holding stock out for delivery on cash on delivery: '
    'company stock at its cost, not for sale. Made by fn_transit_location.';
alter table location drop constraint if exists location_transit_is_a_bin;
alter table location add constraint location_transit_is_a_bin
    check (not is_transit or (is_stock_location and parent_id is not null and not is_quarantine));
create unique index if not exists location_one_transit_per_warehouse
    on location (company_id, parent_id) where is_transit;

create or replace function fn_transit_location(p_location uuid)
returns uuid language plpgsql as $$
declare
    w      record;
    t      uuid;
    code_  text;
    n      int := 1;
begin
    select l.id, l.company_id, l.code, l.name, l.name_my, l.is_stock_location, l.is_transit, l.is_quarantine
      into w from location l where l.id = p_location;
    if w.id is null then raise exception 'No location %', p_location; end if;
    if w.is_transit then return w.id; end if;
    if not w.is_stock_location or w.is_quarantine then
        raise exception 'Out for delivery is a bin inside a warehouse; % is not one.', w.name;
    end if;
    select id into t from location where company_id = w.company_id and parent_id = w.id and is_transit;
    if t is not null then return t; end if;
    code_ := w.code || '-OUT';
    while exists (select 1 from location where company_id = w.company_id and code = code_) loop
        n := n + 1;
        code_ := w.code || '-OUT' || n;
    end loop;
    insert into location (company_id, parent_id, code, name, name_my, is_stock_location, is_transit)
    values (w.company_id, w.id, code_, w.name || ' / Out for delivery',
            case when w.name_my is not null then w.name_my || ' / ပို့ဆောင်ဆဲ' end, true, true)
    on conflict (company_id, parent_id) where is_transit do nothing
    returning id into t;
    if t is null then
        select id into t from location where company_id = w.company_id and parent_id = w.id and is_transit;
    end if;
    return t;
end $$;

-- The warehouse a bin counts in, for transit bins as for quarantine.
create or replace function fn_stock_home(p_location uuid)
returns uuid language sql stable as $$
    select case when l.is_quarantine or l.is_transit then l.parent_id else l.id end
      from location l where l.id = p_location
$$;

-- Nothing is sold from Out for delivery but the handover of a COD invoice.
create or replace function fn_document_not_from_transit() returns trigger
language plpgsql as $$
begin
    if new.doc_type in ('SALES_ORDER', 'SALES_INVOICE', 'DELIVERY')
       and new.reverses_document_id is null
       and exists (select 1 from location where id = new.location_id and is_transit)
       and not (new.doc_type = 'DELIVERY'
                and exists (select 1 from document i where i.id = new.source_document_id and i.ar_on_handover)) then
        raise exception 'Stock out for delivery is not for sale. Hand it over on its invoice, or receive it back first.';
    end if;
    return new;
end $$;

alter table document add column if not exists ar_on_handover boolean not null default false;
comment on column document.ar_on_handover is
    'A cash-on-delivery invoice: owed and earned only as parcels are handed over and paid (0233).';
alter table document add column if not exists driver_id uuid references driver(id);
create index if not exists document_driver on document (driver_id) where driver_id is not null;

drop trigger if exists trg_document_not_from_transit on document;
create trigger trg_document_not_from_transit
    before insert on document
    for each row execute function fn_document_not_from_transit();

create or replace function fn_stock_not_sold_from_transit() returns trigger
language plpgsql as $$
begin
    if new.qty < 0
       and exists (select 1 from location where id = new.location_id and is_transit)
       and exists (select 1 from document d
                    where d.id = new.document_id
                      and d.doc_type in ('SALES_INVOICE', 'DELIVERY')
                      and d.reverses_document_id is null
                      and not (d.doc_type = 'DELIVERY'
                               and exists (select 1 from document i where i.id = d.source_document_id and i.ar_on_handover))) then
        raise exception 'This stock is out for delivery and cannot be sold. Hand it over on its invoice, or receive it back first.';
    end if;
    return new;
end $$;

drop trigger if exists trg_stock_not_sold_from_transit on stock_movement;
create trigger trg_stock_not_sold_from_transit
    before insert on stock_movement
    for each row execute function fn_stock_not_sold_from_transit();

-- 2. What a COD invoice has billed: one row per handover, positive. Only rows
-- whose document stands count, so voiding a handover un-bills it.
create table if not exists sales_billed_on_handover (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    invoice_id   uuid not null references document(id),
    document_id  uuid not null references document(id),
    amount       numeric(18,4) not null,
    created_at   timestamptz not null default now()
);
create index if not exists sales_billed_on_handover_invoice on sales_billed_on_handover (invoice_id);

-- 3. What happened to a parcel at the door. The parcel is the dispatch (a
-- stock transfer to the Out for delivery bin, or a delivery on credit).
create table if not exists dispatch_event (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    parcel_id    uuid not null references document(id),
    invoice_id   uuid references document(id),
    kind         text not null check (kind in ('NOT_HOME', 'REFUSED', 'RETURNED', 'HANDED_OVER', 'DELIVERED')),
    reason       text,
    retry_on     date,
    holder       text,
    document_id  uuid references document(id),
    acted_by     uuid,
    created_at   timestamptz not null default now()
);
create index if not exists dispatch_event_parcel on dispatch_event (parcel_id);
create index if not exists dispatch_event_invoice on dispatch_event (invoice_id);

-- 4. Cash a driver collected and has not handed in, and which collections a
-- hand-in covered.
create table if not exists driver_handin_item (
    id           uuid primary key default gen_random_uuid(),
    company_id   uuid not null references company(id),
    handin_id    uuid not null references document(id),
    receipt_id   uuid not null references document(id),
    created_at   timestamptz not null default now()
);
create index if not exists driver_handin_item_receipt on driver_handin_item (receipt_id);

alter table system_account drop constraint if exists system_account_role_check;
alter table system_account add constraint system_account_role_check check (role = any (array[
  'GRIR_CLEARING', 'PURCHASE_PRICE_VARIANCE', 'PURCHASE_DISCOUNT_RECEIVED', 'SALES_DISCOUNT_ALLOWED',
  'STOCK_ADJUSTMENT', 'PROMOTION_EXPENSE', 'FX_GAIN', 'FX_LOSS', 'ROUNDING_DIFFERENCE',
  'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'DELIVERY_INCOME', 'CUSTOMER_ADVANCE',
  'SUPPLIER_ADVANCE', 'OUTPUT_TAX', 'INPUT_TAX', 'SHIPPED_NOT_INVOICED', 'LANDED_COST_CLEARING',
  'OTHER_PAYABLE', 'CARRIAGE_INWARD', 'BILLED_NOT_DELIVERED', 'TRADE_IN_CLEARING',
  'FX_UNREALISED_GAIN', 'FX_UNREALISED_LOSS', 'FX_REVALUATION_CASH', 'FX_REVALUATION_AP',
  'INVENTORY_DAMAGE', 'LANDED_COST_VARIANCE', 'COD_RECEIVABLE', 'CARRIAGE_OUTWARD',
  'CASH_WITH_DRIVERS']));

-- 1113 Cash with Drivers, under 11 Cash and Bank. Not a till: nobody pays
-- from it; the cashier receives it from the driver.
insert into account (company_id, code, name, account_type, is_postable, parent_id)
select p.company_id, '1113', 'Cash with Drivers', 'ASSET', true, p.id
  from account p
 where p.code = '11'
   and not exists (select 1 from account a where a.company_id = p.company_id and a.code = '1113');

insert into system_account (company_id, role, account_id)
select a.company_id, 'CASH_WITH_DRIVERS', a.id from account a
 where a.code = '1113' and a.is_postable
   and not exists (select 1 from system_account s where s.company_id = a.company_id and s.role = 'CASH_WITH_DRIVERS');

-- 5. A posted COD invoice has no entry until a parcel is handed over.
create or replace function fn_document_posting_required() returns trigger
language plpgsql as $$
declare
    d document;
    v_all_consigned boolean;
    v_value numeric;
begin
    select * into d from document where id = new.id;
    if not found then
        return null;
    end if;

    if d.status <> 'POSTED' or d.journal_entry_id is not null then
        return null;
    end if;

    if d.doc_type = 'SALES_INVOICE' and d.ar_on_handover then
        return null;
    end if;

    if d.doc_type = 'DELIVERY' then
        select coalesce(bool_and(dl.is_consignment), false) into v_all_consigned
          from document_line dl where dl.document_id = d.id;
        if v_all_consigned then
            return null;
        end if;
        select coalesce(sum(abs(dl.net_amount)), 0) into v_value
          from document_line dl where dl.document_id = d.id;
        if v_value = 0 then
            return null;
        end if;
        raise exception
            'Document % (%) is posted but has no journal entry', d.doc_no, d.doc_type;
    end if;

    if d.doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE') then
        select coalesce(sum(abs(dl.net_amount) + abs(coalesce(dl.tax_amount, 0))), 0) + abs(coalesce(d.gross_total, 0))
          into v_value
          from document_line dl where dl.document_id = d.id;
        if v_value = 0 then
            return null;
        end if;
    end if;

    if d.doc_type in (
            'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN',
            'SUPPLIER_PAYMENT', 'SALES_INVOICE',
            'SALES_RETURN', 'CUSTOMER_RECEIPT', 'STOCK_ADJUSTMENT',
            'OPENING_BALANCE', 'CASH_VOUCHER', 'BANK_VOUCHER',
            'JOURNAL_VOUCHER', 'CASH_TRANSFER')
    then
        raise exception
            'Document % (%) is posted but has no journal entry',
            d.doc_no, d.doc_type;
    end if;

    return null;
end;
$$;

-- 6. Open items and invoice status: a COD invoice owes what was handed over.
-- Each view is 0216's with "billed" in place of the invoice total.
create or replace view v_open_item as
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(al.allocated, 0::numeric) AS allocated,
    b.billed - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric) AS outstanding,
        CASE
            WHEN d.due_date IS NULL THEN NULL::integer
            ELSE fn_shop_today() - d.due_date
        END AS days_overdue,
        CASE
            WHEN d.due_date IS NULL THEN 'NO_DUE_DATE'::text
            WHEN fn_shop_today() <= d.due_date THEN 'CURRENT'::text
            WHEN (fn_shop_today() - d.due_date) <= 30 THEN '1-30'::text
            WHEN (fn_shop_today() - d.due_date) <= 60 THEN '31-60'::text
            WHEN (fn_shop_today() - d.due_date) <= 90 THEN '61-90'::text
            ELSE '90+'::text
        END AS aging_bucket,
    COALESCE(r.returned, 0::numeric) AS returned,
    d.exchange_rate,
    round((b.billed - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric)) / d.exchange_rate, 4) AS fc_outstanding
   FROM document d
     JOIN business_partner p ON p.id = d.partner_id
     CROSS JOIN LATERAL ( SELECT CASE WHEN d.ar_on_handover THEN COALESCE((
                SELECT sum(h.amount) FROM sales_billed_on_handover h
                  JOIN document hd ON hd.id = h.document_id
                 WHERE h.invoice_id = d.id AND hd.status = 'POSTED'::text), 0::numeric)
              ELSE d.gross_total END AS billed) b
     LEFT JOIN ( SELECT pa.invoice_id,
            sum(pa.amount) AS allocated
           FROM payment_allocation pa
             JOIN document pay ON pay.id = pa.payment_id
             LEFT JOIN document app ON app.id = pa.applied_by_document_id
          WHERE pay.status = 'POSTED'::text AND pay.reversed_by_document_id IS NULL AND (pa.applied_by_document_id IS NULL OR app.status = 'POSTED'::text)
          GROUP BY pa.invoice_id) al ON al.invoice_id = d.id
     LEFT JOIN ( SELECT fn_current_document(rr.source_document_id) AS invoice_id,
            sum(rr.gross_total) AS returned
           FROM document rr
          WHERE (rr.doc_type = ANY (ARRAY['SALES_RETURN'::text, 'PURCHASE_RETURN'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text])) AND rr.status = 'POSTED'::text AND rr.reversed_by_document_id IS NULL AND rr.reverses_document_id IS NULL AND rr.source_document_id IS NOT NULL
          GROUP BY (fn_current_document(rr.source_document_id))) r ON r.invoice_id = CASE WHEN d.superseded_by_document_id IS NULL THEN d.id ELSE fn_current_document(d.id) END
  WHERE d.status = 'POSTED'::text AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND d.reverses_document_id IS NULL AND (b.billed - COALESCE(al.allocated, 0::numeric) - COALESCE(r.returned, 0::numeric)) <> 0::numeric;

create or replace view v_invoice_status as
 SELECT d.company_id,
    d.id AS document_id,
    d.doc_type,
    d.doc_no,
    d.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    d.posting_date,
    d.due_date,
    d.currency,
    d.gross_total,
    COALESCE(a.paid, 0::numeric) AS paid,
    b.billed - COALESCE(a.paid, 0::numeric) - COALESCE(r.returned, 0::numeric) AS outstanding,
        CASE
            WHEN d.ar_on_handover AND b.billed = 0::numeric AND COALESCE(a.paid, 0::numeric) = 0::numeric THEN 'OPEN'::text
            WHEN COALESCE(a.paid, 0::numeric) = 0::numeric AND COALESCE(r.returned, 0::numeric) < b.billed THEN 'OPEN'::text
            WHEN COALESCE(a.paid, 0::numeric) >= (b.billed - COALESCE(r.returned, 0::numeric)) THEN 'PAID'::text
            ELSE 'PARTIALLY_PAID'::text
        END AS payment_status,
        CASE
            WHEN d.due_date IS NULL THEN NULL::integer
            ELSE fn_shop_today() - d.due_date
        END AS days_overdue,
    COALESCE(r.returned, 0::numeric) AS returned
   FROM document d
     JOIN business_partner p ON p.id = d.partner_id
     CROSS JOIN LATERAL ( SELECT CASE WHEN d.ar_on_handover THEN COALESCE((
                SELECT sum(h.amount) FROM sales_billed_on_handover h
                  JOIN document hd ON hd.id = h.document_id
                 WHERE h.invoice_id = d.id AND hd.status = 'POSTED'::text), 0::numeric)
              ELSE d.gross_total END AS billed) b
     LEFT JOIN ( SELECT pa.invoice_id,
            sum(pa.amount) AS paid
           FROM payment_allocation pa
             JOIN document pay ON pay.id = pa.payment_id
             LEFT JOIN document app ON app.id = pa.applied_by_document_id
          WHERE pay.status = 'POSTED'::text AND pay.reversed_by_document_id IS NULL AND (pa.applied_by_document_id IS NULL OR app.status = 'POSTED'::text)
          GROUP BY pa.invoice_id) a ON a.invoice_id = d.id
     LEFT JOIN ( SELECT fn_current_document(rr.source_document_id) AS invoice_id,
            sum(rr.gross_total) AS returned
           FROM document rr
          WHERE (rr.doc_type = ANY (ARRAY['SALES_RETURN'::text, 'PURCHASE_RETURN'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text])) AND rr.status = 'POSTED'::text AND rr.reversed_by_document_id IS NULL AND rr.reverses_document_id IS NULL AND rr.source_document_id IS NOT NULL
          GROUP BY (fn_current_document(rr.source_document_id))) r ON r.invoice_id = CASE WHEN d.superseded_by_document_id IS NULL THEN d.id ELSE fn_current_document(d.id) END
  WHERE d.status = 'POSTED'::text AND (d.doc_type = ANY (ARRAY['SALES_INVOICE'::text, 'PURCHASE_INVOICE'::text])) AND d.reverses_document_id IS NULL;

-- 7. Arrival was not tracked before this: every delivery already posted is
-- taken as delivered, so history does not read as out for delivery. From here
-- a delivery proves only that the goods left; a counter pickup, a COD
-- handover, a confirmed arrival or a trip stop marked delivered says they
-- arrived.
insert into dispatch_event (company_id, parcel_id, invoice_id, kind, reason, created_at)
select d.company_id, d.id, d.source_document_id, 'DELIVERED', 'Delivered before arrival was tracked (0233)', d.posted_at
  from document d
 where d.doc_type = 'DELIVERY' and d.status = 'POSTED' and d.reverses_document_id is null
   and not exists (select 1 from dispatch_event e where e.parcel_id = d.id);
