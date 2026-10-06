-- A phone is chosen the way it is sold.
--
-- A counter clerk does not say "PH-IP16-256-BK". They say Apple, iPhone 16,
-- 256 GB, Black — and, since the iPhone 14, which kind of SIM it takes,
-- because the US model is eSIM only and a customer who needs a physical SIM
-- cannot use it. The receipt and the till now pick a phone in exactly that
-- order: brand, model, then one choice per variant attribute.
--
-- Storage, Colour and SIM are ordinary variant attributes (migration 0107):
-- master data, edited under Settings > Catalogue > Variants. This only
-- seeds them, so a new phone shop starts with the lists it needs:
--
--   * SIM is added to every company that does not have one.
--   * Storage and Colour are added only where a company has no attributes at
--     all — a company that already named its own (pilot has "storage" and
--     "Color") keeps them, rather than getting a second, competing list.
--
-- The SIM labels are what a customer understands, not the carrier's terms.

create or replace function fn_seed_phone_attributes(p_company uuid) returns void
language plpgsql as $$
declare
    a uuid;
    had_any boolean;
begin
    select exists (select 1 from variant_attribute where company_id = p_company) into had_any;

    if not had_any then
        insert into variant_attribute (company_id, code, name, sort_order)
        values (p_company, 'STO', 'Storage', 0) returning id into a;
        insert into variant_option (company_id, attribute_id, code, name, sort_order)
        select p_company, a, v.code, v.name, v.n
          from (values ('64', '64 GB', 0), ('128', '128 GB', 1), ('256', '256 GB', 2),
                       ('512', '512 GB', 3), ('1T', '1 TB', 4), ('2T', '2 TB', 5)) v(code, name, n);

        insert into variant_attribute (company_id, code, name, sort_order)
        values (p_company, 'COL', 'Colour', 1) returning id into a;
        insert into variant_option (company_id, attribute_id, code, name, sort_order)
        select p_company, a, v.code, v.name, v.n
          from (values ('BK', 'Black', 0), ('WH', 'White', 1), ('BL', 'Blue', 2),
                       ('PK', 'Pink', 3), ('GN', 'Green', 4), ('NT', 'Natural Titanium', 5),
                       ('DT', 'Desert Titanium', 6), ('SV', 'Silver', 7), ('OR', 'Cosmic Orange', 8),
                       ('DB', 'Deep Blue', 9)) v(code, name, n);
    end if;

    if not exists (select 1 from variant_attribute where company_id = p_company and code = 'SIM') then
        insert into variant_attribute (company_id, code, name, sort_order)
        values (p_company, 'SIM', 'SIM',
                coalesce((select max(sort_order) + 1 from variant_attribute where company_id = p_company), 0))
        returning id into a;
        insert into variant_option (company_id, attribute_id, code, name, sort_order)
        values (p_company, a, 'PE', '1 physical + eSIM', 0),
               (p_company, a, 'PP', '2 physical', 1),
               (p_company, a, 'E',  'eSIM only', 2);
    end if;
end $$;

comment on function fn_seed_phone_attributes(uuid) is
    'Storage, Colour and SIM variant attributes for a phone shop. Idempotent.';

select fn_seed_phone_attributes(id) from company;
