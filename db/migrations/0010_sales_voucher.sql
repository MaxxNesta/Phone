-- 0010_sales_voucher.sql
-- Salesmen, promotions, and the voucher fields a counter sale actually needs.

-- ------------------------------------------------------------- salesmen --

create table salesman (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    code        text not null,
    name        text not null,
    name_my     text,
    phone       text,
    location_id uuid references location(id),

    -- Commission is reported on, not posted. Paying it is a payroll matter.
    commission_pct numeric(9,6) not null default 0 check (commission_pct >= 0),

    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),

    unique (company_id, code)
);

create index on salesman (company_id) where is_active;

-- ----------------------------------------------------------- promotions --

-- Scoped to an item, an item group, or the whole catalogue, and to a date
-- window. Applying one is a pricing decision made on the voucher; the
-- discount is netted into the line and posts nothing of its own.
create table promotion (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references company(id),
    code          text not null,
    name          text not null,
    name_my       text,

    item_id       uuid references item(id),
    item_group_id uuid references item_group(id),

    discount_pct  numeric(9,6) not null default 0
        check (discount_pct >= 0 and discount_pct <= 100),

    -- Buy N get M free, for the giveaway style that is common here.
    buy_qty       numeric(18,4),
    free_qty      numeric(18,4),

    valid_from    date not null,
    valid_to      date,

    is_active     boolean not null default true,
    created_at    timestamptz not null default now(),

    unique (company_id, code),
    check (valid_to is null or valid_to >= valid_from)
);

create index on promotion (company_id, valid_from, valid_to) where is_active;

-- --------------------------------------------------- voucher header fields --

alter table document
    -- COD or credit. Drives whether cash is expected at the counter.
    add column payment_type text not null default 'CREDIT'
        check (payment_type in ('CASH', 'CREDIT')),

    -- Who sold it. Reported on, and the basis for commission.
    add column salesman_id uuid references salesman(id),

    -- The customer's own order number, or a phone order reference. Free text
    -- on purpose: it points outside this system.
    add column reference text,

    -- Goods are leaving later. Stock has already moved and the sale is
    -- posted; this only tells the warehouse there is something to send.
    add column to_deliver boolean not null default false,
    add column delivered_at timestamptz;

create index on document (company_id, to_deliver)
    where to_deliver and delivered_at is null;

create index on document (company_id, salesman_id) where salesman_id is not null;

comment on column document.to_deliver is
    'A fulfilment flag, not an accounting one. The posting is identical either '
    'way — this exists so the warehouse can list what still has to go out.';

-- Pending deliveries: the warehouse worklist.
create view v_pending_delivery as
select d.company_id, d.id as document_id, d.doc_no, d.doc_type,
       d.posting_date, d.gross_total,
       p.name as partner_name, p.code as partner_code,
       l.code as location_code,
       s.name as salesman_name,
       current_date - d.posting_date as days_waiting
  from document d
  join business_partner p on p.id = d.partner_id
  left join location l on l.id = d.location_id
  left join salesman s on s.id = d.salesman_id
 where d.status = 'POSTED'
   and d.to_deliver
   and d.delivered_at is null;

-- ------------------------------------------------------- cash accounts --

-- Which accounts money can actually be taken into at the counter. Explicit
-- rather than inferred from the account type, because plenty of asset
-- accounts are not tills.
alter table account add column is_cash_account boolean not null default false;

create index on account (company_id) where is_cash_account;

-- ------------------------------------------------------------- backfill --

-- One-time sample data so existing companies have something to select.
-- Skipped where the company already has salesmen.
-- Cash and bank accounts in the standard chart. Harmless where absent.
update account set is_cash_account = true
 where is_postable and account_type = 'ASSET' and code in ('1110', '1120', '1130');

do $$
declare
    c record;
    loc uuid;
begin
    for c in select id from company loop
        if not exists (select 1 from salesman where company_id = c.id) then
            select id into loc from location
             where company_id = c.id and is_stock_location order by code limit 1;

            insert into salesman (company_id, code, name, name_my, location_id, commission_pct)
            values (c.id, 'SM-01', 'Ko Myat Thu',  'ကိုမြတ်သူ',   loc, 2),
                   (c.id, 'SM-02', 'Ma Thida Win', 'မသီတာဝင်း',  loc, 2),
                   (c.id, 'SM-03', 'Ko Zaw Lin',   null,          loc, 1.5),
                   (c.id, 'SM-04', 'Counter Sale', null,          loc, 0);
        end if;

        if not exists (select 1 from promotion where company_id = c.id) then
            insert into promotion (company_id, code, name, discount_pct, valid_from, valid_to)
            values (c.id, 'PROMO-THINGYAN', 'Thingyan 5% off', 5,
                    date_trunc('year', current_date)::date, null),
                   (c.id, 'PROMO-BULK', 'Bulk order 3% off', 3,
                    date_trunc('year', current_date)::date, null);

            insert into promotion (company_id, code, name, buy_qty, free_qty, valid_from, valid_to)
            values (c.id, 'PROMO-B10G1', 'Buy 10 get 1 free', 10, 1,
                    date_trunc('year', current_date)::date, null);
        end if;
    end loop;
end
$$;
