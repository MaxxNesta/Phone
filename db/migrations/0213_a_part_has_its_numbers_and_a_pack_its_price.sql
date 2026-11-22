-- A pack has its own selling price, and a part has the numbers people ask for it by.
--
-- Pack price: a box of ten is often cheaper than ten pieces. The price sits on
-- the pack (item_uom), not in item_price: every price lookup there reads one
-- price per item and level, and a box price among them would be quoted as a
-- piece price. Null means "piece price times the pack size". One price for
-- every level; a wholesale pack price can come later as item_price rows.
alter table item_uom add column if not exists sale_price numeric(18,4);
alter table item_uom drop constraint if exists item_uom_sale_price_check;
alter table item_uom add constraint item_uom_sale_price_check check (sale_price is null or sale_price >= 0);
comment on column item_uom.sale_price is
  'Selling price of one of this pack. Null: the piece price times the factor.';

-- Part numbers: the maker's OEM number, other brands' equivalents, and the
-- supplier's own code. A counter types any of them; the picker finds the part.
-- Matched on the number with spaces, dashes and dots taken out, so
-- "04465-0K240" and "044650k240" are the same part.
create table if not exists item_part_number (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    item_id    uuid not null references item(id) on delete cascade,
    part_no    text not null check (length(trim(part_no)) > 0),
    kind       text not null default 'OEM' check (kind in ('OEM', 'EQUIVALENT', 'SUPPLIER')),
    maker      text,
    norm       text generated always as (upper(regexp_replace(part_no, '[^A-Za-z0-9]', '', 'g'))) stored,
    created_at timestamptz not null default now(),
    unique (item_id, kind, norm)
);
create index if not exists ix_item_part_number_norm on item_part_number (company_id, norm);

comment on table item_part_number is
  'Numbers a part is known by: OEM (the vehicle maker''s), EQUIVALENT (another brand''s), SUPPLIER (the supplier''s code). Searched by norm.';
