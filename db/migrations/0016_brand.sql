-- 0016_brand.sql
-- Brand as its own flat master, not a rung on the category ladder — a Toyota
-- brake pad and an Advics brake pad both file under Brake System, so brand
-- has to cut across categories rather than nest inside them.

create table brand (
    id         uuid primary key default gen_random_uuid(),
    company_id uuid not null references company(id),
    code       text not null,
    name       text not null,
    name_my    text,
    is_active  boolean not null default true,

    unique (company_id, code)
);

alter table item add column brand_id uuid references brand(id);

create index on item (company_id, brand_id);
