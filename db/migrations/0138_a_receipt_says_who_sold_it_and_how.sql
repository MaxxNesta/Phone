-- A receipt says who sold it, and how it looks is the shop's choice
--
-- The till has printed one fixed receipt. This lets a shop choose its paper
-- (58 mm, 80 mm thermal, or A4), what the receipt shows, and how it is laid
-- out — and keeps every receipt already printed exactly as it was.
--
-- Nothing here touches a sale. A template decides how a posted sale is drawn;
-- the figures always come from the sale itself, which is immutable.
--
-- 1. Master data the receipt needs and the system did not hold: the company's
--    address, phone and logo, and each branch's address and phone. Kept on the
--    company and the branch, not copied into templates, so they are changed in
--    one place.
--
-- 2. Templates, owned by the company and optionally by one branch. Each has a
--    draft (what is being edited) and a published version (what sales use).
--    Publishing writes an immutable version row.
--
-- 3. sale_receipt pins each sale to the template version, and the business
--    details, it was first printed with. A reprint draws the sale the same way
--    even after the template or the address has changed.
--
-- 4. An audit row for every save, publish and default change.

alter table company add column if not exists address text;
alter table company add column if not exists phone text;
alter table company add column if not exists logo bytea;
alter table company add column if not exists logo_mime text;
alter table company drop constraint if exists company_logo_mime_check;
alter table company add constraint company_logo_mime_check
    check (logo_mime is null or logo_mime in ('image/png', 'image/jpeg'));

alter table location add column if not exists address text;
alter table location add column if not exists phone text;

create table if not exists receipt_template (
    id                uuid primary key default gen_random_uuid(),
    company_id        uuid not null references company(id),
    -- A branch's own template; null is the company's.
    branch_id         uuid references location(id),
    name              text not null,
    paper             text not null check (paper in ('58', '80', 'A4')),
    is_active         boolean not null default true,
    -- The template sales use when nothing more specific applies: one per
    -- company (branch_id null) and one per branch.
    is_default        boolean not null default false,
    draft_config      jsonb not null,
    published_version int,
    published_at      timestamptz,
    published_by      uuid references app_user(id),
    created_at        timestamptz not null default now(),
    created_by        uuid references app_user(id),
    updated_at        timestamptz not null default now(),
    updated_by        uuid references app_user(id),
    unique (company_id, name)
);

create unique index if not exists receipt_template_one_default
    on receipt_template (company_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
 where is_default;

create table if not exists receipt_template_version (
    template_id  uuid not null references receipt_template(id),
    version      int not null,
    paper        text not null check (paper in ('58', '80', 'A4')),
    config       jsonb not null,
    published_at timestamptz not null default now(),
    published_by uuid references app_user(id),
    primary key (template_id, version)
);

create or replace function fn_receipt_template_version_immutable() returns trigger
language plpgsql as $$
begin
    raise exception 'A published receipt template version is never changed; publish a new one.';
end $$;
drop trigger if exists trg_receipt_template_version_immutable on receipt_template_version;
create trigger trg_receipt_template_version_immutable
    before update or delete on receipt_template_version
    for each row execute function fn_receipt_template_version_immutable();

create table if not exists receipt_template_audit (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references company(id),
    template_id uuid not null references receipt_template(id),
    action      text not null check (action in
                  ('CREATE', 'SAVE_DRAFT', 'PUBLISH', 'SET_DEFAULT', 'ACTIVATE', 'DEACTIVATE')),
    acted_by    uuid references app_user(id),
    acted_at    timestamptz not null default now(),
    detail      jsonb
);
create index if not exists receipt_template_audit_template_idx on receipt_template_audit (template_id, acted_at);

-- Which template version a sale was first printed with, and the business
-- details as they stood then. Written once, never rewritten.
create table if not exists sale_receipt (
    document_id      uuid primary key references document(id),
    company_id       uuid not null references company(id),
    template_id      uuid references receipt_template(id),
    template_version int,
    identity         jsonb not null,
    created_at       timestamptz not null default now()
);

create or replace function fn_sale_receipt_immutable() returns trigger
language plpgsql as $$
begin
    raise exception 'A sale''s receipt is fixed once printed.';
end $$;
drop trigger if exists trg_sale_receipt_immutable on sale_receipt;
create trigger trg_sale_receipt_immutable
    before update or delete on sale_receipt
    for each row execute function fn_sale_receipt_immutable();

-- One default per company, published at version 1, drawing the receipt the
-- till prints today: 80 mm, every line it shows now. The settings are written
-- out in full, not left to the code's defaults, so a later change to those
-- defaults cannot redraw a receipt printed under this version. Seeded only
-- where the company has none.
insert into receipt_template (company_id, name, paper, is_default, draft_config, published_version, published_at)
select c.id, 'Retail Receipt', '80', true, '{"general":{"showAfterSale":true,"autoPrint":false,"showPrintButton":true,"allowReprint":true,"allowPdf":true,"printableWidthMm":72,"language":"en"},"identity":{"showLogo":true,"displayName":"","showBranchName":true,"showAddress":true,"showPhone":true,"extraContact":""},"transaction":{"showCashier":true,"showSalesman":true,"showCustomer":true,"showPaymentMethod":true,"showPaymentBreakdown":true,"showSubtotal":true,"showDiscounts":true,"showTaxWhenZero":true},"product":{"showVariant":true,"showQuantity":true,"showUnitPrice":false,"showDiscount":true,"showLineTotal":true,"showImei":true,"imeiMode":"full"},"warranty":{"show":true,"showPeriod":true,"showDates":false,"policyText":""},"custom":{"headerText":"","thankYou":"Thank you for your purchase.","returnPolicy":"","footerText":""},"style":{"fontSize":"normal","headerAlign":"center","lineStyle":"dashed","density":"normal"}}'::jsonb, 1, now()
  from company c
 where not exists (select 1 from receipt_template t where t.company_id = c.id);

insert into receipt_template_version (template_id, version, paper, config)
select t.id, 1, t.paper, t.draft_config
  from receipt_template t
 where t.published_version = 1
   and not exists (select 1 from receipt_template_version v where v.template_id = t.id);
